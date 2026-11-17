// Auto-translate never leaves a page untranslated while you look at it (2.11.1).
// The race that left one: auto-translate starts the page you stopped at; you scroll far
// away before Claude is asked, so the worker cancels it; you come back before the
// cancellation reaches the page. Auto-translate only reacted to a page *entering* the
// zone ahead of the screen, and this page never left it, so it sat untranslated until
// you pressed Translate. Here, every round of that race must end with the page translated
// and nothing clicked.
//   node browser/autostall.mjs [--ext path] [--out dir] [--rounds 3]
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
const out = arg("--out", "/tmp/gyt-browser/autostall"); fs.mkdirSync(out, { recursive: true });
const ROUNDS = Number(arg("--rounds", 3));
const PORT = Number(arg("--port", 8798)), PAGES = 12;
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const { srv } = await startMock(PORT, pageImage, { truth: pageImage.replace(/-page\.png$/, "-truth.json"), delayMs: 1500 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const ext = extensionCopy(extSrc, { apiUrl: `http://127.0.0.1:${PORT}/v1/messages` });
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-")), {
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1200,900"],
  viewport: { width: 1200, height: 900 },
});
const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
await agree(sw);
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], autoSites: ["127.0.0.1"], debugOverlay: true, useContext: false, includeSource: false });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await wait(300);

const page = await context.newPage();
const done = new Set(); const cancelled = [];
page.on("console", async (m) => {
  if (!m.text().startsWith("Gytakusub debug")) return;
  try { const d = await m.args()[1].jsonValue(); done.add(Number(new URL(d.src).searchParams.get("i"))); } catch { /* not ours */ }
});
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=${PAGES}`);
await page.waitForLoadState("load");
const top = (i) => page.evaluate((i) => document.getElementById("p" + i).getBoundingClientRect().top + scrollY, i);
const centre = async (i) => { const y = await top(i); await page.evaluate((y) => scrollTo(0, y - 60), y); };

// rounds on pages 4, 7, 10 (far enough apart that each starts untouched)
for (const [k, i] of [4, 7, 10].slice(0, ROUNDS).entries()) {
  await centre(i); await wait(700);                                  // settled: auto-translate starts page i
  await page.evaluate(() => scrollTo(0, 0)); await wait(i > 5 ? 450 : 250); // far away: the worker is told to cancel it
  if (Math.abs((await top(i)) - 0) < 3000 && i <= 4) await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); // page 4 is near the top: go to the end instead
  await wait(200);
  await centre(i);                                                  // back before the cancellation lands
  let ok = false;
  for (let t = 0; t < 600 && !ok; t++) { await wait(100); ok = done.has(i); }
  check(`round ${k + 1}: page ${i} is translated without pressing Translate`, ok, ok ? "" : `done: ${[...done].sort((a, b) => a - b).join(",")}`);
}
await page.screenshot({ path: path.join(out, "end.png") });
await context.close(); srv.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
