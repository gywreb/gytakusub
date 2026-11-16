// Store screenshot 5: the real popup and the Claude usage panel, in the same 1280x800 frame
// as screenshots 1–4 (make-store-assets.mjs). Demo data: a usage log of Sonnet answers today
// and Haiku ones earlier this month, Claude Max 5x renewing in 23 days, a site named
// reader.example (a reserved name, no real site) mapped to a local page.
// Usage: node browser/store-shot.mjs [../../store/assets]
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.resolve(here, "../../extension");
const out = path.resolve(process.argv[2] || path.join(here, "../../store/assets"));
const PORT = 8823, HOST = "reader.example";
const { addCall, emptyLog } = await import(path.join(ext, "usage.js"));

const now = Date.now();
let log = emptyLog();
for (let i = 0; i < 34; i++) log = addCall(log, { model: "claude-sonnet-5-5", usage: { input_tokens: 2400, output_tokens: 520 }, at: now - i * 60e3 });
for (let i = 0; i < 120; i++) log = addCall(log, { model: "claude-haiku-5-5", usage: { input_tokens: 2300, output_tokens: 480 }, at: now - 3 * 864e5 - i * 60e3 });
log = addCall(log, { model: "claude-sonnet-5-5", usage: { input_tokens: 2400, output_tokens: 500 }, at: now, limits: { requests: { limit: 50, remaining: 47 }, inputTokens: { limit: 40000, remaining: 36000 }, outputTokens: { limit: 8000, remaining: 7400 } } });

const srv = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html" }); r.end("<title>Chapter 12</title><h1>Chapter 12</h1>"); });
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "gyt-store-")), {
  channel: "chromium", headless: false, colorScheme: "dark", deviceScaleFactor: 2,
  args: ["--headless=new", "--no-sandbox", `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const id = new URL(sw.url()).host;
await sw.evaluate(async ({ log, host }) => {
  await chrome.storage.local.set({ apiKey: "sk-ant-demo", claudeUsage: log });
  await chrome.storage.sync.set({ enabled: true, enabledSites: [host], autoSites: [host], model: "claude-sonnet-5-5", creditPlan: "max5x", creditRenews: new Date(Date.now() + 23 * 864e5).toISOString().slice(0, 10) });
}, { log, host: HOST });
const site = await ctx.newPage(); await site.goto(`http://${HOST}:${PORT}/`);

// the popup, as opened on that site
const pop = await ctx.newPage(); await pop.setViewportSize({ width: 340, height: 640 });
await pop.addInitScript((url) => { const q = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = (o) => (o && o.active ? q({ url }) : q(o)); }, `http://${HOST}/*`);
await pop.goto(`chrome-extension://${id}/popup.html`); await pop.waitForTimeout(800);
const popH = await pop.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
const popPng = await pop.screenshot({ clip: { x: 0, y: 0, width: 340, height: Math.min(640, popH) } });
// Options → Claude usage
const op = await ctx.newPage(); await op.setViewportSize({ width: 1100, height: 1000 });
await op.goto(`chrome-extension://${id}/options.html#sec-usage`); await op.waitForTimeout(800);
// the top of the card (credit, today, this month, per model): the notes and fields below would be too small to read in 1280x800
await op.addStyleTag({ content: "#cuModels ~ * { display: none !important; }" });
const usagePng = await op.locator("#sec-usage").screenshot();

// compose, in the frame the other screenshots use
const frame = await ctx.newPage(); await frame.setViewportSize({ width: 1280, height: 800 });
const img = (png) => `data:image/png;base64,${png.toString("base64")}`;
await frame.setContent(`<!doctype html><style>
  body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: "DejaVu Sans", sans-serif; background: linear-gradient(135deg, #15171c, #262a33); color: #fff; }
  h1 { position: absolute; left: 40px; top: 18px; margin: 0; font-size: 34px; }
  p { position: absolute; left: 40px; top: 72px; margin: 0; font-size: 20px; color: #b4bac6; }
  .shot { position: absolute; border-radius: 12px; box-shadow: 6px 8px 0 rgba(0,0,0,.35); }
  .cap { position: absolute; font-weight: bold; font-size: 18px; color: #e5e7eb; }
</style>
<h1>Your switches, your costs</h1>
<p>On or off per site, one-click translation, and an estimate of what Claude costs you, with your plan's credit left.</p>
<img class="shot" id="pop" src="${img(popPng)}"><img class="shot" id="use" src="${img(usagePng)}">
<div class="cap" id="popCap">POPUP</div><div class="cap" id="useCap">OPTIONS → CLAUDE USAGE</div>`);
await frame.evaluate(() => {
  // fit both into the area under the title, side by side, at the same scale
  // (captured at 2x, so up to 1.25x larger still looks sharp); centred under the title, captions included
  const areaTop = 118, areaBottom = 780, capH = 40, area = { x: 40, w: 1200, h: areaBottom - areaTop - capH };
  const pop = document.getElementById("pop"), use = document.getElementById("use");
  const pw = pop.naturalWidth / 2, ph = pop.naturalHeight / 2, uw = use.naturalWidth / 2, uh = use.naturalHeight / 2, gap = 48;
  const s = Math.min(1.25, (area.w - gap) / (pw + uw), area.h / Math.max(ph, uh));
  const total = (pw + uw) * s + gap, x0 = area.x + (area.w - total) / 2;
  const top = areaTop + (area.h - Math.max(ph, uh) * s) / 2;
  Object.assign(pop.style, { left: `${x0}px`, top: `${top}px`, width: `${pw * s}px` });
  Object.assign(use.style, { left: `${x0 + pw * s + gap}px`, top: `${top}px`, width: `${uw * s}px` });
  Object.assign(document.getElementById("popCap").style, { left: `${x0}px`, top: `${top + ph * s + 14}px` });
  Object.assign(document.getElementById("useCap").style, { left: `${x0 + pw * s + gap}px`, top: `${top + uh * s + 14}px` });
});
await frame.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
fs.mkdirSync(out, { recursive: true });
await frame.screenshot({ path: path.join(out, "screenshot-5-controls.png"), scale: "css" }); // 1280x800, as the store asks
console.log(`popup ${popH}px tall; written ${path.join(out, "screenshot-5-controls.png")}`);
await ctx.close(); srv.close();
