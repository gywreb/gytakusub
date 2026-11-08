// Render the synthetic demo page through the real web pipeline (mocked model
// response; tags assigned by geometry) and compose Chrome Web Store assets.
// Usage: node make-store-assets.mjs ../store/assets
import { createCanvas, loadImage, Image, registerFont } from "canvas";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2] || "../store/assets";
fs.mkdirSync(OUT, { recursive: true });
registerFont("../extension/fonts/ComicNeue-Bold.ttf", { family: "Gytakusub Comic", weight: "bold" });
registerFont("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", { family: "DemoSans", weight: "bold" });
registerFont("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", { family: "DemoSans", weight: "normal" });

// Render the synthetic page through the real engine (same code the extension runs).
import { cv } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";
new Function(fs.readFileSync("../extension/vendor/hyphen-en.js", "utf8"))();
new Function(fs.readFileSync("../extension/text.js", "utf8"))();
const page = await loadImage("fixtures/demo-page.png");
const truth = JSON.parse(fs.readFileSync("fixtures/demo-truth.json", "utf8"));
const demoItems = JSON.parse(fs.readFileSync("fixtures/demo-items.json", "utf8"));
const scale = 1600 / Math.max(page.width, page.height);
const W = Math.round(page.width * scale), H = Math.round(page.height * scale);
const original = createCanvas(W, H); original.getContext("2d").drawImage(page, 0, 0, W, H);
const pixels = original.getContext("2d").getImageData(0, 0, W, H);
const an = analyze(cv, pixels);
const iou = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); const i = ix * iy; return i / (a.w * a.h + b.w * b.h - i); };
const regionFor = (t) => an.regions.find((r) => iou(r.box, { x: t.box[0] * scale, y: t.box[1] * scale, w: t.box[2] * scale, h: t.box[3] * scale }) >= 0.6);
const items = demoItems.map((it, i) => ({ tag: regionFor(truth.find((t) => t.items.includes(i)))?.id ?? null, box: null, text: it.text, size: it.size, kind: it.kind }));
const { placements, regionIds } = layout(an, items);
const translated = createCanvas(W, H); const tctx = translated.getContext("2d");
tctx.putImageData(erase(cv, pixels, an, regionIds).image, 0, 0);
const drawn = globalThis.GyText.draw(tctx, placements, {});
an.dispose();
console.log("items", items.length, "drawn", drawn);

// --- Screenshot 1: before / after (1280x800) ---
function frame(w, h, title, subtitle) {
  const c = createCanvas(w, h); const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#15171c"); g.addColorStop(1, "#262a33");
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  x.fillStyle = "#fff"; x.font = "bold 34px DemoSans"; x.fillText(title, 40, 58);
  x.fillStyle = "#b4bac6"; x.font = "normal 20px DemoSans"; x.fillText(subtitle, 40, 92);
  return { c, x };
}
function fitInto(ctx, img, x, y, w, h) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(dx + 6, dy + 8, dw, dh);
  ctx.drawImage(img, dx, dy, dw, dh);
  return { dx, dy, dw, dh };
}
{
  const { c, x } = frame(1280, 800, "Translate manga pages in place", "Original on the left — Gytakusub's overlay on the right. Bubbles are refilled and re-lettered; artwork is untouched.");
  const a = fitInto(x, original, 40, 115, 580, 620);
  const b = fitInto(x, translated, 660, 115, 580, 620);
  x.fillStyle = "#e5e7eb"; x.font = "bold 18px DemoSans"; x.fillText("BEFORE", a.dx, a.dy + a.dh + 28); x.fillText("AFTER", b.dx, b.dy + b.dh + 28);
  fs.writeFileSync(path.join(OUT, "screenshot-1-before-after.png"), c.toBuffer("image/png"));
}
// --- Screenshot 2: close-up of the typesetting (1280x800) ---
{
  const { c, x } = frame(1280, 800, "Text sized from the original lettering", "Bubbles are detected locally; the model only says which numbered bubble each line belongs to.");
  const crop = createCanvas(1200, 640); const cx = crop.getContext("2d");
  cx.drawImage(translated, 0, 20, 1200, 640, 0, 0, 1200, 640);
  fitInto(x, crop, 40, 120, 1200, 640);
  fs.writeFileSync(path.join(OUT, "screenshot-2-closeup.png"), c.toBuffer("image/png"));
}
// --- Screenshot 3: how it works (1280x800) ---
{
  const { c, x } = frame(1280, 800, "Your key, your browser, no server", "Pages go straight from your browser to the Claude API with your own key. Nothing is stored or sent anywhere else.");
  const steps = [
    ["1", "Hover a page, or press Alt+T", "Works on sites you enable; stays dormant elsewhere."],
    ["2", "Bubbles detected locally", "Closed, flat regions with text — found by pixels, not by a model."],
    ["3", "Claude reads and translates", "Names and recent lines are carried across pages for consistency."],
    ["4", "Overlay painted in place", "Original lettering erased inside the bubble; English typeset to fit."],
  ];
  steps.forEach(([n, t, s], i) => {
    const y = 150 + i * 150;
    x.fillStyle = "#e11d48"; x.beginPath(); x.arc(90, y + 30, 30, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#fff"; x.font = "bold 28px DemoSans"; x.fillText(n, 80, y + 40);
    x.font = "bold 28px DemoSans"; x.fillText(t, 150, y + 26);
    x.fillStyle = "#b4bac6"; x.font = "normal 20px DemoSans"; x.fillText(s, 150, y + 62);
  });
  const t = fitInto(x, translated, 820, 120, 420, 640);
  fs.writeFileSync(path.join(OUT, "screenshot-3-how-it-works.png"), c.toBuffer("image/png"));
}
// --- Small promo tile 440x280 ---
{
  const c = createCanvas(440, 280); const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 440, 280); g.addColorStop(0, "#15171c"); g.addColorStop(1, "#2b303a");
  x.fillStyle = g; x.fillRect(0, 0, 440, 280);
  const icon = await loadImage("../extension/icons/icon512.png");
  x.drawImage(icon, 40, 70, 140, 140);
  x.fillStyle = "#fff"; x.font = "bold 40px DemoSans"; x.fillText("Gytakusub", 205, 130);
  x.fillStyle = "#b4bac6"; x.font = "normal 19px DemoSans"; x.fillText("Manga translation in place.", 205, 165); x.fillText("Your own Claude key.", 205, 192);
  fs.writeFileSync(path.join(OUT, "promo-small-440x280.png"), c.toBuffer("image/png"));
}
fs.writeFileSync(path.join(OUT, "demo-translated.png"), translated.toBuffer("image/png"));
console.log("assets written to", OUT);
process.exit(0);
