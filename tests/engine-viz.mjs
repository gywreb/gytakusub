// Draws what engine/analyze.js sees: bubbles (red), free text blocks (blue),
// blocks inside bubbles (thin blue), region ids and letter sizes.
//   node engine-viz.mjs <page.png> <out.png> [--trace]   (--trace prints why candidates were rejected)
import fs from "node:fs";
import { createCanvas, loadImage } from "canvas";
import { cv, detector } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";

const img = await loadImage(process.argv[2]);
const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, W, H);
const t0 = Date.now();
if (process.argv.includes("--trace")) globalThis.GYT_TRACE = (kind, box, why, extra) => { if (box.w * box.h > 60) console.log(`  ${why === "accepted" ? "accepted" : "rejected"} ${kind} ${JSON.stringify(box)}: ${why} ${JSON.stringify(extra, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v))}`); };
const an = analyze(cv, ctx.getImageData(0, 0, W, H), { detector });
const ms = Date.now() - t0;
ctx.lineWidth = 2; ctx.font = `bold ${Math.round(W / 70)}px sans-serif`;
for (const b of an.blocks) { ctx.strokeStyle = b.bubble ? "rgba(37,99,235,.5)" : "rgba(37,99,235,.95)"; ctx.lineWidth = b.bubble ? 1 : 2; ctx.strokeRect(b.box.x, b.box.y, b.box.w, b.box.h); }
for (const r of an.regions) {
  ctx.lineWidth = 2; ctx.strokeStyle = r.kind === "bubble" ? "rgba(220,38,38,.95)" : "rgba(37,99,235,.95)";
  ctx.strokeRect(r.box.x, r.box.y, r.box.w, r.box.h);
  ctx.fillStyle = ctx.strokeStyle; ctx.fillText(`#${r.id} ${r.letter.toFixed(0)}px${r.dark ? " dark" : ""}`, r.box.x + 2, r.box.y - 3);
}
fs.writeFileSync(process.argv[3], c.toBuffer("image/png"));
console.log(`${process.argv[2]}: ${W}x${H} ${ms}ms — ${an.bubbles.length} bubbles, ${an.regions.length - an.bubbles.length} free blocks, page letter ${an.letter.toFixed(1)}px`);
an.dispose();
