// Auto-translate's spending guard (content.js AUTO_BUDGET): after the budget, auto-translate
// pauses with a Continue button that only a real click releases, and pages you ask for yourself
// still go through. Run with a budget of 3 on an 8-page chapter (the real budget is 100).
// Also: the content script's world can't read the API key from extension storage.
// Usage: node browser/budget.mjs [--out dir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extensionCopy, agree } from "./ext-copy.mjs";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/budget"); fs.mkdirSync(out, { recursive: true });
const PORT = 8792, BUDGET = 3, PAGES = 8;

const ext = extensionCopy(path.resolve(here, "../../extension"), { apiUrl: `http://127.0.0.1:${PORT}/v1/messages`, autoBudget: BUDGET });
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const { srv, calls } = await startMock(PORT, pageImage, { truth: pageImage.replace(/-page\.png$/, "-truth.json") });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1200,900"],
  viewport: { width: 1200, height: 900 },
});
const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
await agree(sw);
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], autoSites: ["127.0.0.1"], useContext: false, includeSource: false, model: "claude-sonnet-5-5" });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await new Promise((r) => setTimeout(r, 400));

const results = [];
const check = (name, pass, detail = "") => { results.push(!!pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await sleep(250); } return false; };

const page = await context.newPage();
await page.bringToFront();
await page.goto(`http://127.0.0.1:${PORT}/chapter?n=${PAGES}`);
await page.waitForLoadState("load");
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1/*" }))[0]?.id);

// 1. the content script's world can't read extension storage (the API key lives there)
const leak = await sw.evaluate(async (tabId) => {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: async () => {
    try { const v = await chrome.storage.local.get("apiKey"); return { read: JSON.stringify(v) }; } catch (e) { return { error: String(e.message || e) }; }
  } });
  return r?.result;
}, tabId);
check("the content script can't read the API key from storage", leak && !(leak.read || "").includes("sk-ant"), JSON.stringify(leak));

// the pause sits in the extension's closed shadow root: find it through the DevTools protocol, which sees inside
const cdp = await context.newCDPSession(page);
const findPause = async () => {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  let found = { text: null, button: null };
  const walk = (n) => {
    const attrs = n.attributes || [];
    if (n.nodeName === "DIV" && attrs.join(" ").includes("toast pause")) {
      if (!attrs.includes("hidden")) {
        const span = n.children?.find((c) => c.nodeName === "SPAN"), btn = n.children?.find((c) => c.nodeName === "BUTTON");
        found = { text: span?.children?.[0]?.nodeValue || null, button: btn?.nodeId || null };
      }
      return;
    }
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c);
  };
  walk(root);
  return found;
};

// 2. the first pages near the top use up the budget; scrolling on finds auto-translate paused
// the three pages near the top (the look-ahead reaches the third) run together; wait until they're done
const state = () => sw.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: "GET_STATE" }), tabId).catch(() => null);
await until(async () => { const st = await state(); return st && st.done >= BUDGET && !st.working; }, 150000);
for (let y = 0; y <= PAGES * 1032; y += 400) { await page.evaluate((y) => scrollTo(0, y), y); await sleep(500); }
await until(async () => !!(await findPause()).text, 30000);
const atPause = calls.length;
await sleep(8000); // time for any page beyond the budget to (wrongly) start
check(`Claude asked about ${BUDGET} pages (up to ${BUDGET + 2} with pages already in progress), then nothing more`, atPause >= BUDGET && atPause <= BUDGET + 2 && calls.length === atPause, `${atPause} at the pause, ${calls.length} 8 s later`);
const pause = await findPause();
check("the pause says why and offers Continue", /paused after 3 pages in 10 minutes/.test(pause.text || "") && pause.button, pause.text || "(not found)");
await page.screenshot({ path: path.join(out, "pause.png") });

// 3. a page script can't press Continue (the root is closed, and the button wants a real click)
await page.evaluate(() => { for (const el of document.querySelectorAll("*")) el.shadowRoot?.querySelector?.("button")?.click(); });
await sleep(3000);
check("a script can't release the pause", calls.length === atPause && !!(await findPause()).text, `${calls.length} calls`);

// 4. pages you ask for yourself still go through
const r = await sw.evaluate(async (tabId) => chrome.tabs.sendMessage(tabId, { type: "TRANSLATE_VISIBLE" }), tabId);
const asked = await until(() => calls.length > atPause, 60000);
check("Translate visible still works while paused", r?.ok && asked, `${atPause} → ${calls.length} calls`);

// 5. a real click on Continue lets auto-translate go on
await page.evaluate(() => scrollTo(0, 2 * 1032)); await sleep(1500); // pages not translated yet come near
const before = calls.length;
const btn = (await findPause()).button;
let clicked = false;
if (btn) {
  const { model } = await cdp.send("DOM.getBoxModel", { nodeId: btn });
  const [x1, y1, , , x3, y3] = model.border;
  await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2); clicked = true;
}
const resumed = await until(() => calls.length > before, 60000);
check("Continue (a real click) resumes auto-translate", clicked && resumed && !(await findPause()).text, `${before} → ${calls.length} calls`);

await context.close(); srv.close();
fs.rmSync(ext, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
const failed = results.filter((p) => !p).length;
console.log(`\nbudget: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
