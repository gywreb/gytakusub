// Core-quality audit on real debug reports (2.11.0; the measurements behind the 3.0 plan).
// For every page: analyse, lay out the report's items, erase, then measure
//  - items drawn over unerased original text (untagged: placed by box only)
//  - residual lettering inside each erased bubble (ink left vs ink before)
// and write renders + a crop sheet of the worst bubbles for visual review.
//   npm run audit -- <report.zip> <outdir>   (reports stay local: they hold the pages)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage } from "canvas";
import { cv, analyzePage } from "./cv-node.mjs";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";
import { loadLettering } from "./lettering-setup.mjs";

const [,, zipPath, out] = process.argv;
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-audit-"));
execFileSync("unzip", ["-oq", zipPath, "-d", tmp]);
loadLettering();
const GyText = globalThis.GyText;
const summary = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8"));

function rematch(an, rep, it) {
  if (it.tag == null) return null;
  const then = rep.regions.find((r) => r.id === it.tag);
  if (!then) return null;
  const cx = then.box.x + then.box.w / 2, cy = then.box.y + then.box.h / 2;
  let best = null;
  for (const r of an.regions) if (cx >= r.box.x && cy >= r.box.y && cx <= r.box.x + r.box.w && cy <= r.box.y + r.box.h && (!best || r.box.w * r.box.h < best.box.w * best.box.h)) best = r;
  return best ? best.id : null;
}
const lum = (d, p) => (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3;

const rows = [];
const crops = [];
for (const pg of summary.pages) {
  const rep = JSON.parse(fs.readFileSync(path.join(tmp, `page-${pg.id}.json`), "utf8"));
  const orig = fs.readdirSync(tmp).find((f) => f.startsWith(`page-${pg.id}.original.`));
  if (!orig || !rep.work || !rep.items?.length) continue;
  const img = await loadImage(path.join(tmp, orig));
  const { W, H } = rep.work;
  const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
  const pixels = ctx.getImageData(0, 0, W, H);
  const before = new Uint8ClampedArray(pixels.data);
  const an = await analyzePage(pixels);
  // report items are in fractions of the full image in 2.x reports, pixels of work in 1.x
  // layout reads item boxes as [x, y, w, h] fractions of the page (as the extension sends them)
  const items = rep.items.map((it, index) => {
    let box = it.box;
    if (Array.isArray(box) && !box.every((v) => v <= 1.0001)) box = [box[0] / W, box[1] / H, box[2] / W, box[3] / H];
    return { tag: rematch(an, rep, it), box, text: it.text, size: it.size, kind: it.kind, index };
  });
  const { placements, regionIds } = layout(an, items);
  const clean = erase(cv, pixels, an, regionIds).image;
  const after = clean.data;

  const untagged = placements.filter((p) => p.tag == null).length;
  let bubbles = 0, inkBefore = 0, inkAfter = 0, dirty = 0;
  for (const r of an.regions) {
    if (!regionIds.has(r.id) || r.kind !== "bubble") continue;
    bubbles++;
    const inside = an.insideOf(r.id);
    const { x, y, w, h } = r.box;
    // surface = median lum of interior in the original
    const vals = [];
    for (let yy = y; yy < y + h; yy += 2) for (let xx = x; xx < x + w; xx += 2) if (inside(xx, yy)) vals.push(lum(before, yy * W + xx));
    vals.sort((a, b) => a - b);
    const surf = vals[vals.length >> 1] ?? 255;
    // only the lettering's window (detected lines grown by half a letter), away from the outline
    const e = 3, L = Math.max(4, r.letter || 8);
    const wins = (r.ref.blocks || []).map((b) => ({ x0: b.gbox.x - L / 2, y0: b.gbox.y - L / 2, x1: b.gbox.x + b.gbox.w + L / 2, y1: b.gbox.y + b.gbox.h + L / 2 }));
    const inWin = (xx, yy) => wins.some((q) => xx >= q.x0 && xx < q.x1 && yy >= q.y0 && yy < q.y1);
    let b0 = 0, b1 = 0, area = 0;
    for (let yy = y + e; yy < y + h - e; yy++) for (let xx = x + e; xx < x + w - e; xx++) {
      if (!inWin(xx, yy)) continue;
      if (!(inside(xx, yy) && inside(xx - e, yy) && inside(xx + e, yy) && inside(xx, yy - e) && inside(xx, yy + e))) continue;
      area++;
      const p = yy * W + xx;
      if (Math.abs(lum(before, p) - surf) > 60) b0++;
      // residue: anything still visibly off the surface, ghosts included
      if (Math.abs(lum(after, p) - surf) > 35) b1++;
    }
    inkBefore += b0; inkAfter += b1;
    const left = b0 ? b1 / b0 : 0;
    if (b0 > 30 && left > 0.15) dirty++;
    crops.push({ page: pg.id, id: r.id, box: r.box, left, b0, b1, area, W, H, before, after, surf });
  }
  const blocks = [...regionIds].filter((id) => an.regions.find((r) => r.id === id)?.kind !== "bubble").length;
  rows.push({ page: pg.id, natural: rep.natural, work: [W, H], displayed: rep.displayed, items: items.length, placements: placements.length, untagged, bubbles, dirtyBubbles: dirty, freeText: blocks, inkLeft: inkBefore ? +(inkAfter / inkBefore).toFixed(3) : null });

  // renders: erased only, and final
  const o = createCanvas(W, H), octx = o.getContext("2d"); octx.putImageData(clean, 0, 0);
  fs.writeFileSync(path.join(out, `p${pg.id}-erased.png`), o.toBuffer("image/png"));
  const drawn = GyText.draw(octx, placements, { fontFamily: rep.settings?.fontFamily || undefined, uppercase: rep.settings?.uppercase });
  if (process.env.AUDIT_DEBUG) console.error("page", pg.id, "drawn", drawn, JSON.stringify(placements.slice(0, 2).map((p) => ({ t: p.text.slice(0, 20), r: p.rect, l: p.letter, c: p.color }))));
  fs.writeFileSync(path.join(out, `p${pg.id}-final.png`), o.toBuffer("image/png"));
  an.dispose();
}

// crop sheet of the 12 worst bubbles (original | erased), 2x
crops.sort((a, b) => b.left * Math.min(1, b.b0 / 200) - a.left * Math.min(1, a.b0 / 200));
const worst = crops.slice(0, 12);
const S = 2, pad = 8;
let sheetW = 0, sheetH = pad;
for (const k of worst) { sheetW = Math.max(sheetW, (k.box.w * 2 + pad) * S + pad * 2); sheetH += k.box.h * S + 24 + pad; }
if (worst.length) {
  const sh = createCanvas(Math.min(4000, sheetW), Math.min(16000, sheetH)), sc = sh.getContext("2d");
  sc.fillStyle = "#888"; sc.fillRect(0, 0, sh.width, sh.height);
  let yy = pad;
  for (const k of worst) {
    sc.fillStyle = "#000"; sc.font = "14px sans-serif";
    sc.fillText(`page ${k.page} region #${k.id}: ink left ${(k.left * 100).toFixed(0)}% (${k.b1}/${k.b0} px)`, pad, yy + 14);
    yy += 20;
    for (const [i, src] of [k.before, k.after].entries()) {
      const id = new ImageData(new Uint8ClampedArray(k.box.w * k.box.h * 4), k.box.w, k.box.h);
      for (let r = 0; r < k.box.h; r++) id.data.set(src.subarray(((k.box.y + r) * k.W + k.box.x) * 4, ((k.box.y + r) * k.W + k.box.x + k.box.w) * 4), r * k.box.w * 4);
      const t = createCanvas(k.box.w, k.box.h); t.getContext("2d").putImageData(id, 0, 0);
      sc.imageSmoothingEnabled = false;
      sc.drawImage(t, pad + i * (k.box.w + pad) * S, yy, k.box.w * S, k.box.h * S);
    }
    yy += k.box.h * S + pad;
  }
  fs.writeFileSync(path.join(out, `worst-bubbles.png`), sh.toBuffer("image/png"));
}
fs.writeFileSync(path.join(out, "audit.json"), JSON.stringify(rows, null, 1));
const tot = rows.reduce((a, r) => ({ items: a.items + r.items, untagged: a.untagged + r.untagged, bubbles: a.bubbles + r.bubbles, dirty: a.dirty + r.dirtyBubbles, free: a.free + r.freeText }), { items: 0, untagged: 0, bubbles: 0, dirty: 0, free: 0 });
console.log(JSON.stringify({ report: path.basename(zipPath), site: summary.page, pages: rows.length, ...tot }));
fs.rmSync(tmp, { recursive: true, force: true });
