// Real-browser test of the page order (extension/content.js queue, extension/lane.js):
// auto-translate on a 14-page chapter, a fast scroll from the top to the last page, a
// model that takes 2.5 s per answer. The page you stop at must be translated first, and
// the pages you flung past must never reach Claude (no tokens spent on them).
// Usage: node queue.mjs [--ext ../../extension] [--out /tmp/gyt-queue]
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
const out = arg("--out", "/tmp/gyt-queue"); fs.mkdirSync(out, { recursive: true });
const PORT = 8788, PAGES = 14, MODEL_MS = 2500;

const ext = extensionCopy(extSrc, { apiUrl: `http://127.0.0.1:${PORT}/v1/messages` });

const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const { srv, calls, fetches } = await startMock(PORT, pageImage, { truth: pageImage.replace(/-page\.png$/, "-truth.json"), delayMs: MODEL_MS });
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
await new Promise((r) => setTimeout(r, 300)); // let syncRegistration run

const page = await context.newPage();
const done = []; // { i, t } in the order pages finished
page.on("console", async (m) => {
  const t = Date.now(); // when the page logged it, before the round trip below
  if (!m.text().startsWith("Gytakusub debug")) { if (/Gytakusub/.test(m.text())) console.log("  [page]", m.text().slice(0, 200)); return; }
  try { const d = await m.args()[1].jsonValue(); const i = Number(new URL(d.src).searchParams.get("i")); done.push({ i, t, timing: d.timing }); } catch { /* not ours */ }
});
const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=${PAGES}`);
await page.waitForLoadState("load");
await page.waitForTimeout(400); // auto-translate picks up the first pages

// fling to the end: 600 px every 100 ms, like a fast wheel or a swipe
const tScroll = Date.now();
for (;;) {
  const atEnd = await page.evaluate(() => { window.scrollBy(0, 600); return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2; });
  if (atEnd) break;
  await page.waitForTimeout(100);
}
const tStop = Date.now();
const onScreenAtStop = await page.evaluate(() => [...document.images].filter((im) => { const r = im.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).map((im) => +im.id.slice(1)));
const last = Math.max(...onScreenAtStop);

// wait for the page on screen, then until nothing is queued or in progress (2 minutes at most:
// a page that never finishes is a stuck queue, not a slow machine)
for (let k = 0; k < 900 && !done.some((d) => d.i === last); k++) await page.waitForTimeout(100);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:*/*" }))[0]?.id);
const stateOf = () => sw.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: "GET_STATE" }), tabId);
let state = await stateOf();
while (state?.working && Date.now() - tStop < 120000) { await page.waitForTimeout(500); state = await stateOf(); }
console.log(`at the end: ${state?.done} translated, ${state?.working} queued or in progress`);
await page.screenshot({ path: path.join(out, "queue-stop.png") });
await page.evaluate(() => window.scrollTo(0, 5 * 1032)); await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, "queue-skipped.png") }); // a page flung past: left as it is

// the worker's downloads only (the page loading its own images says Sec-Fetch-Dest: image)
const fetched = [...new Set(fetches.filter((f) => f.dest !== "image").map((f) => Number(new URL(f.url, "http://x").searchParams.get("i"))).filter(Boolean))].sort((a, b) => a - b);
const rendered = done.map((d) => d.i);
const lastDone = done.find((d) => d.i === last);
console.log(`scrolled ${((tStop - tScroll) / 1000).toFixed(1)} s, on screen at the stop: ${onScreenAtStop.join(",")}`);
console.log(`finished, in order: ${done.map((d) => `p${d.i}@${((d.t - t0) / 1000).toFixed(1)}s`).join(" ")}`);
for (const d of done) console.log(`  p${d.i}: ${JSON.stringify(d.timing)}`);
console.log(`page p${last} ready ${lastDone ? ((lastDone.t - tStop) / 1000).toFixed(1) + " s after the stop" : "never"}; Claude calls: ${calls.length}; image fetches: ${fetched.join(",")}`);

let failures = 0;
const fail = (m) => { failures++; console.log("FAIL: " + m); };
if (!lastDone) fail(`the page on screen (p${last}) was never translated`);
if (state?.working) fail(`${state.working} page(s) still queued or in progress 2 minutes after the stop`);
// the page you stopped at goes before every other page picked up after the stop
const afterStop = done.filter((d) => d.t >= tStop && d.i !== last);
const before = afterStop.filter((d) => lastDone && d.t < lastDone.t && d.i !== last && !onScreenAtStop.includes(d.i));
if (before.length) fail(`pages finished before the one on screen: ${before.map((d) => "p" + d.i).join(",")}`);
// pages flung past (not near the start or the end) are never translated, fetched or sent
const skipped = Array.from({ length: PAGES }, (_, k) => k + 1).filter((i) => i >= 5 && i <= last - 4);
const touched = skipped.filter((i) => rendered.includes(i) || fetched.includes(i));
if (touched.length) fail(`pages flung past were still worked on: ${touched.map((i) => "p" + i).join(",")}`);
// one slice per page: every call to Claude belongs to a page that was translated
if (calls.length !== new Set(rendered).size) fail(`${calls.length} Claude calls for ${new Set(rendered).size} translated pages: a page that was put back still cost tokens`);
console.log(failures ? `QUEUE TEST FAILED (${failures})` : "QUEUE TEST PASSED");
process.exitCode = failures ? 1 : 0;
await context.close(); srv.close(); fs.rmSync(ext, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
