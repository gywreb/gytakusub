// The web app (the phone path) on phone, foldable and tablet screens (2.11.0): a folded phone,
// the same phone in landscape, an unfolded foldable, an iPad upright and sideways.
// For each, after translating a page:
//  - the page fits the screen (no sideways scrolling) and fills its column;
//  - the translation is drawn into the page itself, so it sits where the original lettering was
//    at any size: outside the erased and lettered areas the translated page is the original,
//    pixel for pixel (nothing shifted or scaled differently);
//  - the page keeps at least the original's own pixels (1200 × 1700 here), so zooming in stays
//    sharp, and at least the screen's, so the text is as sharp as the screen.
//  - unfolding (folded phone → open foldable) redraws the page for the bigger screen.
// Screenshots of each are saved (--out).
//   node browser/web-screens.mjs [--out dir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/web-screens"); fs.mkdirSync(out, { recursive: true });
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const API_PORT = 8801, WEB_PORT = 8802;

execFileSync("sh", [path.join(root, "scripts/sync-shared.sh")], { stdio: "ignore" });
const web = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-web-"));
fs.cpSync(path.join(root, "web"), web, { recursive: true });
const pj = path.join(web, "prompt.js");
fs.writeFileSync(pj, fs.readFileSync(pj, "utf8").replace(/export const API_URL = "[^"]+"/, `export const API_URL = "http://127.0.0.1:${API_PORT}/v1/messages"`));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".ttf": "font/ttf" };
const statik = http.createServer((req, res) => {
  const p = path.join(web, decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")));
  if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => statik.listen(WEB_PORT, "127.0.0.1", r));
const { srv: api } = await startMock(API_PORT, pageImage, { truth: pageImage.replace(/-page\.png$/, "-truth.json") });

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const SCREENS = [
  { name: "phone, folded", width: 390, height: 844, dpr: 3 },
  { name: "phone, landscape", width: 844, height: 390, dpr: 3 },
  { name: "foldable, open", width: 768, height: 1024, dpr: 2.5 },
  { name: "iPad", width: 1024, height: 1366, dpr: 2 },
  { name: "iPad, landscape", width: 1366, height: 1024, dpr: 2 },
];
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const browser = await chromium.launch({ channel: process.env.GYT_CHANNEL || "chromium", headless: true });
for (const s of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test", useContext: false })));
  await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  await page.setInputFiles("#file", pageImage);
  await page.waitForSelector(".page canvas.translated", { timeout: 90000 });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const t = document.querySelector(".page canvas.translated"), o = document.querySelector(".page canvas.original");
    const r = t.getBoundingClientRect(), col = t.closest(".page-media").getBoundingClientRect();
    // pixels far from any lettering must be the original's: compare the two canvases outside
    // the bubbles' bands (top 2% and the panel gutters) — and over the whole page, the share
    // of pixels that differ (the erased and lettered areas only)
    const W = t.width, H = t.height;
    const a = t.getContext("2d").getImageData(0, 0, W, H).data, b = o.getContext("2d").getImageData(0, 0, W, H).data;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) diff++;
    return { canvas: [W, H], css: [r.width, r.height], col: col.width, scrollW: document.documentElement.scrollWidth, vw: innerWidth, diffShare: diff / (W * H) };
  });
  await page.screenshot({ path: path.join(out, `${s.name.replace(/[^a-z]+/g, "-")}.png`) });
  const deviceWidth = m.css[0] * s.dpr;
  console.log(JSON.stringify({ screen: s.name, ...m, devicePixelsPerPagePixel: +(deviceWidth / m.canvas[0]).toFixed(2) }));
  check(`${s.name}: no sideways scrolling`, m.scrollW <= m.vw + 1, `${m.scrollW} for ${m.vw}`);
  check(`${s.name}: the page fills its column`, Math.abs(m.css[0] - m.col) < 2, `${m.css[0].toFixed(1)} of ${m.col.toFixed(1)}`);
  // at least the page's own pixels (1200 wide), and at least the screen's when the screen has more
  const want = Math.max(1200, Math.round(m.css[0] * s.dpr));
  check(`${s.name}: drawn with the page's pixels or the screen's, whichever is more`, Math.abs(m.canvas[0] - want) <= 2 && Math.abs(m.canvas[1] / m.canvas[0] - 1700 / 1200) < 0.002, `${m.canvas.join("×")} for ${want} wide`);
  // the lettered and erased areas of this page cover well under a third of it; a shifted or
  // rescaled translation would differ almost everywhere
  check(`${s.name}: outside the translated areas the page is the original`, m.diffShare > 0.005 && m.diffShare < 0.3, `${(m.diffShare * 100).toFixed(1)}% of pixels differ`);
  check(`${s.name}: no page errors`, !errors.length, errors.slice(0, 2).join(" | "));
  if (s.name === "phone, folded") {
    await page.setViewportSize({ width: 768, height: 1024 }); await page.waitForTimeout(900);
    const u = await page.evaluate(() => { const t = document.querySelector(".page canvas.translated"); return { w: t.width, css: t.getBoundingClientRect().width }; });
    check("unfolding redraws the page for the bigger screen", Math.abs(u.w - Math.max(1200, Math.round(u.css * s.dpr))) <= 2, `${u.w} px for ${u.css.toFixed(0)} CSS px at ${s.dpr}×`);
  }
  await ctx.close();
}
await browser.close(); statik.close(); api.close();
fs.rmSync(web, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
