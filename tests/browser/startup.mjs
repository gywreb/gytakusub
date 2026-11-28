// Real-browser test of a page's start and end in the extension, with a model that takes 3 s:
//  1. the worker turns away the page's first two requests for its settings (a worker that is
//     starting, or busy with another page): the page asks again, and auto-translate starts on
//     its own, no reload (2.12.0 kept its defaults: raw message keys, auto-translate off)
//  2. the reader leaves while pages wait in the worker: those not yet sent to Claude never are
//  3. the reader reloads while a page is with Claude: the reloaded page waits for that answer
//     instead of asking (and paying) again
//  4. loaded unpacked, as here: the folder's dev-reload.txt changing reloads the extension, once
//     (2.15.0, devreload.js)
//  5. the worker stops while pages are with Claude: they're asked again by themselves (2.12.0:
//     they stayed failed until the reader pressed Translate)
// Usage: node startup.mjs [--ext ../../extension] [--out /tmp/gyt-startup]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extensionCopy, agree } from "./ext-copy.mjs";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const extSrc = path.resolve(here, arg("--ext", "../../extension"));
const out = arg("--out", "/tmp/gyt-startup"); fs.mkdirSync(out, { recursive: true });
const PORT = 8790, MODEL_MS = 3000;

const ext = extensionCopy(extSrc, { apiUrl: `http://127.0.0.1:${PORT}/v1/messages` });
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const { srv, calls, arrived } = await startMock(PORT, pageImage, { truth: pageImage.replace(/-page\.png$/, "-truth.json"), delayMs: MODEL_MS });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1200,900"],
  viewport: { width: 1200, height: 900 },
});
const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
await agree(sw);
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], autoSites: ["127.0.0.1"], debugOverlay: true, useContext: false, includeSource: false, model: "claude-sonnet-5-5" });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await new Promise((r) => setTimeout(r, 300));

let failures = 0;
const fail = (m) => { failures++; console.log("FAIL:", m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await context.newPage();
const done = new Set(); // pages translated (their addresses)
page.on("console", async (m) => {
  if (!m.text().startsWith("Gytakusub debug")) return;
  try { done.add((await m.args()[1].jsonValue()).src); } catch { /* not ours */ }
});

// 1. settings turned away twice: the page must ask again and start auto-translating by itself
await sw.evaluate(() => {
  globalThis.__turnAway = 2;
  // answers first (synchronously), so the worker's own answer to these two is never seen
  chrome.runtime.onMessage.addListener((m, _s, send) => {
    if (m?.type === "GET_SETTINGS" && globalThis.__turnAway > 0) { globalThis.__turnAway--; send({ error: "busy (test)" }); }
    return false;
  });
});
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=4&ch=1`);
const t1 = Date.now();
while (!done.size && Date.now() - t1 < 25000) await wait(250);
const left = await sw.evaluate(() => globalThis.__turnAway);
if (left !== 0) fail(`the page asked for its settings only ${2 - left} time(s)`);
if (!done.size) fail("auto-translate did not start after the settings were turned away twice (it needed a reload)");
else console.log(`1. settings turned away twice: first page translated after ${((Date.now() - t1) / 1000).toFixed(1)} s, no reload`);

// 2. leaving while pages wait: no question reaches Claude after the page is gone
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=8&ch=2`);
const t2 = Date.now();
// the first question arrives; the next pages are still in the worker (their analysis, their turn)
while (!arrived.some((a) => a >= t2) && Date.now() - t2 < 20000) await wait(100);
await wait(300);
await page.goto(`http://127.0.0.1:${PORT}/blank`);
const gone = Date.now();
await wait(MODEL_MS + 9000); // long enough for the waiting pages' analyses and questions, had they gone on
const late = arrived.filter((a) => a > gone + 500).length;
if (late) fail(`${late} question(s) reached Claude after the reader had left the chapter`);
else console.log(`2. left the chapter: no question reached Claude after (${arrived.filter((a) => a >= t2).length} asked while it was open)`);

// 3. reloading while a page is with Claude: the reloaded page waits for that answer
done.clear();
const t3 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=3&ch=3`);
while (!arrived.some((a) => a >= t3) && Date.now() - t3 < 20000) await wait(100); // a question is on its way (not answered yet)
console.log(`   (reload at ${((Date.now() - t3) / 1000).toFixed(1)} s)`);
await page.reload();
const t3r = Date.now();
while (done.size < 3 && Date.now() - t3r < 60000) await wait(250); // all three pages, one question each
await wait(1000);
const asked3 = arrived.filter((a) => a >= t3).length;
console.log("   (questions at", arrived.filter((a) => a >= t3).map((a) => ((a - t3) / 1000).toFixed(1) + " s").join(", "), "— translated:", [...done].map((u) => u.split("?")[1]).join(", ") + ")");
if (done.size < 3) fail(`only ${done.size} of 3 pages were translated after the reload`);
if (asked3 > 3) fail(`${asked3} questions for 3 pages: a page was asked twice across the reload`);
else console.log(`3. reloaded mid-answer: ${asked3} question(s) for ${done.size} page(s) translated`);

// 4. loaded unpacked, as here: dev-reload.txt written into the extension's folder makes the next page
// that asks reload the extension, once. A test browser can't show the reload itself: an unpacked
// extension that reloads in one comes back turned off, which no real Chrome does (github.com/
// dominic-lam/ext-reload; the same seen here). So the worker's chrome.runtime.reload is a stand-in
// that counts, and empties session storage as a reload does.
await sw.evaluate(() => {
  globalThis.__reloads = 0;
  chrome.runtime.reload = () => { globalThis.__reloads++; chrome.storage.session.remove("devReloadMark"); };
});
const reloads = () => sw.evaluate(() => globalThis.__reloads);
// (the worker answers the next page's request once it's free: the pages before are still being
// translated, and how long that takes depends on the engine and the machine. So the count is
// awaited, up to 30 s, rather than read after a fixed wait)
const reloadsBy = async (ms) => { const t = Date.now(); let n = await reloads(); while (n < 1 && Date.now() - t < ms) { await wait(250); n = await reloads(); } return n; };
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=1&ch=5`); await wait(2500);
const before5 = await reloads();
fs.writeFileSync(path.join(ext, "dev-reload.txt"), "test 1\n");
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=1&ch=6`);
const after5 = await reloadsBy(30000);
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=1&ch=7`); await wait(2500); // the new start takes the mark
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=1&ch=8`); await wait(2500);
const again5 = await reloads();
if (before5 !== 0) fail(`no dev-reload.txt: the extension reloaded itself ${before5} time(s)`);
else if (after5 !== 1) fail(`dev-reload.txt written: ${after5} reload(s), not 1`);
else if (again5 !== 1) fail(`the same dev-reload.txt: reloaded again (${again5} in all)`);
else console.log("4. no dev-reload.txt: no reload; written: the next page's request reloaded the extension, once");

// 5. the worker stops while pages are with Claude (Chrome stopped or restarted it; a user's report
// showed the last two pages of a chapter failing so): the pages are asked again by themselves
done.clear();
const t4 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=3&ch=4`);
while (!arrived.some((a) => a >= t4) && Date.now() - t4 < 20000) await wait(100); // a question is on its way
const cdp = await context.newCDPSession(page);
const { targetInfos } = await cdp.send("Target.getTargets");
const worker = targetInfos.find((x) => x.type === "service_worker" && x.url.startsWith("chrome-extension://"));
await cdp.send("Target.closeTarget", { targetId: worker.targetId });
const stopped = Date.now();
console.log(`   (worker stopped at ${((stopped - t4) / 1000).toFixed(1)} s)`);
while (done.size < 3 && Date.now() - stopped < 120000) await wait(250);
if (done.size < 3) fail(`after the worker stopped, ${done.size} of 3 pages were translated without the reader doing anything`);
else console.log(`5. worker stopped mid-chapter: all 3 pages translated by themselves, ${((Date.now() - stopped) / 1000).toFixed(1)} s later`);

await Promise.race([context.close(), wait(10000)]); srv.close();
console.log(failures ? `\n${failures} FAILED` : "\nSTARTUP TEST PASSED");
process.exit(failures ? 1 : 0);
