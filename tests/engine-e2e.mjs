// Whole engine in Node: analyze → layout → erase → draw, on a page with given
// items (demo-items.json: pixel boxes on the 1600-scaled page, tag null).
//   node engine-e2e.mjs <page.png> <items.json> <out.png>
import fs from "node:fs";
import { createCanvas, loadImage, registerFont } from "canvas";
import { cv, detector } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";
registerFont("../extension/fonts/ComicNeue-Bold.ttf", { family: "Gytakusub Comic", weight: "bold" });
new Function(fs.readFileSync("../extension/vendor/hyphen-en.js", "utf8"))();
new Function(fs.readFileSync("../extension/text.js", "utf8"))();
const GyText = globalThis.GyText;

const [,, pagePath, itemsPath, outPath] = process.argv;
const img = await loadImage(pagePath);
const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, W, H);
const pixels = ctx.getImageData(0, 0, W, H);
const t0 = Date.now();
const an = analyze(cv, pixels, { detector });
const t1 = Date.now();
// items: pixel boxes → fractions; assign tags by overlap like a model reading stamps would
const raw = JSON.parse(fs.readFileSync(itemsPath, "utf8")); // boxes in natural-page pixels
const items = raw.map((it) => {
  if (it.box) it.box = it.box.map((v) => v * scale);
  const box = it.box ? [it.box[0] / W, it.box[1] / H, it.box[2] / W, it.box[3] / H] : null;
  let tag = it.tag ?? null;
  if (tag == null && box) { const cx = it.box[0] + it.box[2] / 2, cy = it.box[1] + it.box[3] / 2; const r = an.regions.find((r) => cx >= r.box.x && cx <= r.box.x + r.box.w && cy >= r.box.y && cy <= r.box.y + r.box.h); if (r) tag = r.id; }
  return { tag, box, text: it.text, size: it.size || "normal", kind: it.kind || "bubble" };
});
const { placements, regionIds } = layout(an, items);
const t2 = Date.now();
const clean = erase(cv, pixels, an, regionIds).image;
const t3 = Date.now();
ctx.putImageData(clean, 0, 0);
const drawn = GyText.draw(ctx, placements, {});
const t4 = Date.now();
fs.writeFileSync(outPath, c.toBuffer("image/png"));
console.log(`${W}x${H}: regions ${an.regions.length} (${an.bubbles.length} bubbles) letter ${an.letter}px; items ${items.length} → placed ${placements.length}, drawn ${drawn}; analyze ${t1 - t0}ms layout ${t2 - t1}ms erase ${t3 - t2}ms draw ${t4 - t3}ms`);
for (const p of placements) console.log(`  #${p.tag} ${JSON.stringify(p.rect)} letter ${p.letter} "${p.text.slice(0, 30)}"`);
an.dispose();
