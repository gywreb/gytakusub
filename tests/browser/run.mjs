// Real-browser test: loads the actual extension in Chrome (headless), translates a
// page through the mock API, screenshots, then forces a Redo and screenshots again.
// Usage: node run.mjs [--ext ../../extension] [--page ../fixtures/demo-page.png] [--out /tmp/gyt-browser]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage } from "canvas";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const extSrc = path.resolve(here, arg("--ext", "../../extension"));
const pageImage = path.resolve(here, arg("--page", "../fixtures/demo-page.png"));
const out = arg("--out", "/tmp/gyt-browser"); fs.mkdirSync(out, { recursive: true });
const PORT = 8787;

// Test copy of the extension pointed at the mock API (the product code is untouched).
const ext = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-ext-"));
fs.cpSync(extSrc, ext, { recursive: true });
const pj = path.join(ext, "prompt.js");
fs.writeFileSync(pj, fs.readFileSync(pj, "utf8").replace(/export const API_URL = "[^"]+"/, `export const API_URL = "http://127.0.0.1:${PORT}/v1/messages"`));

const { srv, calls } = await startMock(PORT, pageImage, { badBoxes: process.argv.includes("--bad-boxes"), truth: pageImage.replace(/-page\.png$/, "-truth.json") });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-"));
const context = await chromium.launchPersistentContext(profile, {
  // Branded Google Chrome ≥137 ignores --load-extension; Playwright's Chromium and
  // Chrome for Testing keep it. CI installs chromium; set GYT_CHANNEL=chrome locally.
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1200,900"],
  viewport: { width: 1200, height: 900 },
});
let sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], debugOverlay: true, useContext: false, includeSource: false });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await new Promise((r) => setTimeout(r, 300)); // let syncRegistration run

const page = await context.newPage();
const debugLogs = [];
page.on("console", async (m) => { if (m.text().startsWith("Gytakusub debug")) { try { debugLogs.push(await m.args()[1].jsonValue()); } catch {} } else if (/Gytakusub/.test(m.text())) console.log("  [page]", m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForLoadState("load");
await page.waitForTimeout(500);

const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:*/*" }))[0]?.id);
const translate = (force) => sw.evaluate(async ({ tabId, force }) => chrome.tabs.sendMessage(tabId, { type: "TRANSLATE_VISIBLE", force }), { tabId, force });
const waitLogs = async (n) => { for (let i = 0; i < 100 && debugLogs.length < n; i++) await page.waitForTimeout(100); if (debugLogs.length < n) throw new Error(`timeout waiting for render ${n}`); await page.waitForTimeout(400); };

const r = await translate(false); if (!r?.ok) throw new Error("content script did not answer: " + JSON.stringify(r));
await waitLogs(1);
await page.screenshot({ path: path.join(out, "1-first.png") });
await translate(true); await waitLogs(2);
await page.screenshot({ path: path.join(out, "2-redo.png") });
// A third render from the warm cache (e.g. reload page) — what a returning user sees.
await page.reload(); await page.waitForLoadState("load"); await page.waitForTimeout(500);
await translate(false); await waitLogs(3);
await page.screenshot({ path: path.join(out, "3-cached.png") });

// ---- peek + edit (first scenario only) ----
let peekChanged = null, editOk = null, persisted = null;
if (!process.argv.includes("--bad-boxes")) {
  const d = debugLogs[2]; // state after the reload: placements in work px
  const img = await page.$eval("#p1", (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const toClient = (x, y) => ({ x: img.left + x / d.work.W * img.width, y: img.top + y / d.work.H * img.height });
  const target = d.placements.find((p) => p.tag != null && p.item != null);
  const c = toClient(target.rect.x + target.rect.w / 2, target.rect.y + target.rect.h / 2);
  const region = (() => { const a = toClient(target.rect.x, target.rect.y), b = toClient(target.rect.x + target.rect.w, target.rect.y + target.rect.h); return { x: Math.floor(a.x), y: Math.floor(a.y), width: Math.ceil(b.x - a.x), height: Math.ceil(b.y - a.y) }; })();
  const before = await page.screenshot({ clip: region });
  await page.mouse.move(c.x - 40, c.y - 40); await page.waitForTimeout(50);
  await page.mouse.move(c.x, c.y); await page.waitForTimeout(600); // dwell → peek
  const peeking = await page.screenshot({ clip: region });
  await page.screenshot({ path: path.join(out, "4-peek.png") });
  peekChanged = !before.equals(peeking);
  await page.mouse.dblclick(c.x, c.y); await page.waitForTimeout(200);
  await page.keyboard.press("Control+a"); await page.keyboard.type("EDITED LINE");
  await page.screenshot({ path: path.join(out, "5-editor.png") });
  await page.keyboard.press("Control+Enter"); await page.waitForTimeout(300);
  await page.mouse.move(5, 5); await page.waitForTimeout(400);
  const after = await page.screenshot({ clip: region });
  editOk = !after.equals(before);
  // the edit survives a reload (cache hit re-applies it)
  await page.reload(); await page.waitForLoadState("load"); await page.waitForTimeout(500);
  await translate(false); await waitLogs(4);
  persisted = debugLogs[3].placements.find((p) => p.item === target.item)?.text === "EDITED LINE";
  await page.screenshot({ path: path.join(out, "6-after-edit-reload.png") });
}

// ---- diagnostic report (what the user sends when something is off) ----
const rep = await sw.evaluate(async ({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "DEBUG_REPORT" }), { tabId });
const reportOk = rep && !rep.error && Array.isArray(rep.placements) && Array.isArray(rep.regions) && rep.work && rep.gytakusub;
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(rep, null, 1));
// one-click export: a .zip with original + debug render + json per page
const [download, exp] = await Promise.all([
  page.waitForEvent("download", { timeout: 30000 }),
  sw.evaluate(async ({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "EXPORT_REPORT" }), { tabId }),
]);
const zipPath = path.join(out, "report.zip"); await download.saveAs(zipPath);
let zipOk = false;
try {
  const listing = execFileSync("unzip", ["-l", zipPath]).toString();
  zipOk = exp?.ok && /summary\.json/.test(listing) && /page-01\.json/.test(listing) && /page-01\.debug\.png/.test(listing) && /page-01\.original\./.test(listing);
  execFileSync("unzip", ["-tq", zipPath]); // CRCs
} catch (e) { console.log("zip check:", e.message); zipOk = false; }

// pixel diff between renders
async function diff(a, b, name) {
  const [A, B] = await Promise.all([loadImage(a), loadImage(b)]);
  const c = createCanvas(A.width, A.height), ctx = c.getContext("2d");
  ctx.drawImage(A, 0, 0); const pa = ctx.getImageData(0, 0, A.width, A.height).data;
  ctx.drawImage(B, 0, 0); const pb = ctx.getImageData(0, 0, A.width, A.height).data;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const outImg = ctx.createImageData(A.width, A.height);
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
    const g = Math.round((pa[i] + pa[i + 1] + pa[i + 2]) / 3) * 0.3 + 160;
    outImg.data[i] = d > 30 ? 255 : g; outImg.data[i + 1] = d > 30 ? 0 : g; outImg.data[i + 2] = d > 30 ? 0 : g; outImg.data[i + 3] = 255;
    if (d > 30) { n++; const p = i / 4, x = p % A.width, y = (p / A.width) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  ctx.putImageData(outImg, 0, 0); fs.writeFileSync(path.join(out, name), c.toBuffer("image/png"));
  return { changedPx: n, pct: +(100 * n / (A.width * A.height)).toFixed(3), bbox: n ? [x0, y0, x1 - x0, y1 - y0] : null };
}
console.log("API calls:", JSON.stringify(calls));
console.log("render 1 vs redo:", JSON.stringify(await diff(path.join(out, "1-first.png"), path.join(out, "2-redo.png"), "diff-first-redo.png")));
console.log("redo vs cached:  ", JSON.stringify(await diff(path.join(out, "2-redo.png"), path.join(out, "3-cached.png"), "diff-redo-cached.png")));
fs.writeFileSync(path.join(out, "debug-logs.json"), JSON.stringify(debugLogs, null, 1));

// Assertions: every tagged translation must sit inside its own detected bubble,
// whatever the model said about pixel coordinates; renders must be deterministic.
let failures = 0;
for (const [i, d] of debugLogs.entries()) {
  const byId = new Map(d.regions.map((r) => { const pad = r.kind === "block" ? r.letter : 0; return [r.id, { x: r.box.x - pad, y: r.box.y - pad, w: r.box.w + 2 * pad, h: r.box.h + 2 * pad }]; })); // free text keeps its footprint plus half a letter of air
  const tagged = d.items.filter((it) => it.tag != null && byId.has(it.tag)).length;
  const placed = d.placements.filter((p) => p.tag != null);
  if (placed.length < tagged) { failures++; console.log(`FAIL render ${i + 1}: ${tagged} tagged items but only ${placed.length} placed by tag`); }
  for (const p of placed) {
    const b = byId.get(p.tag); const tol = 0.05;
    const inside = p.rect.x >= b.x - b.w * tol && p.rect.y >= b.y - b.h * tol && p.rect.x + p.rect.w <= b.x + b.w * (1 + tol) && p.rect.y + p.rect.h <= b.y + b.h * (1 + tol);
    if (!inside) { failures++; console.log(`FAIL render ${i + 1}: text for #${p.tag} at ${JSON.stringify(p.rect)} is outside bubble ${JSON.stringify(b)}`); }
  }
}
if (!debugLogs.length) { failures++; console.log("FAIL: no render happened"); }
if (!reportOk) { failures++; console.log("FAIL: diagnostic report incomplete: " + JSON.stringify(rep).slice(0, 200)); }
if (!zipOk) { failures++; console.log("FAIL: export zip missing files or corrupt: " + JSON.stringify(exp).slice(0, 200)); }
if (peekChanged === false) { failures++; console.log("FAIL: hovering a bubble did not reveal the original"); }
if (editOk === false) { failures++; console.log("FAIL: editing a line did not change the overlay"); }
if (persisted === false) { failures++; console.log("FAIL: the edited line did not survive a reload"); }
if (peekChanged !== null) console.log(`peek: ${peekChanged} edit: ${editOk} persisted: ${persisted}`);
console.log(failures ? `BROWSER TEST FAILED (${failures})` : "BROWSER TEST PASSED");
process.exitCode = failures ? 1 : 0;
for (const [i, d] of debugLogs.entries()) console.log(`render ${i + 1}: work=${d.work.W}x${d.work.H} natural=${d.natural} items=${d.items.length} regions=${d.regions.length} placed=${d.placements.length} tags=${d.items.map((it) => it.tag).join(",")}`);
await context.close(); srv.close(); fs.rmSync(ext, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
