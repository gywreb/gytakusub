// Core-quality audit on real debug reports (2.11.0; the measurements behind the 3.0 plan).
// For every page: analyse, lay out the report's items, erase, then measure
//  - items drawn over unerased original text (untagged: placed by box only)
//  - marks left by the eraser in each erased area (residue.mjs)
// and write renders + a crop sheet of the worst bubbles for visual review.
//   npm run audit -- <report.zip> <outdir>   (reports stay local: they hold the pages)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage } from "canvas";
import { cv, analyzePage } from "./cv-node.mjs";
import { layout } from "../extension/engine/layout.js";
import { erase, fillTexture } from "../extension/engine/erase.js";
import { getOrt, createSession, run as ortRun } from "../extension/engine/ort.js";
import { loadLettering } from "./lettering-setup.mjs";
import { marksLeft } from "./residue.mjs";

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
const clampBox = (b, W, H, pad) => { const x = Math.max(0, Math.round(b.x - pad)), y = Math.max(0, Math.round(b.y - pad)); return { x, y, w: Math.min(W, Math.round(b.x + b.w + pad)) - x, h: Math.min(H, Math.round(b.y + b.h + pad)) - y }; };

// The 2.12 eraser (what finishPage runs) instead of 2.11's Telea, when any of these is set:
//   GYT_OUTLINE=0.3       grow the mask over lettering outlines by this share of the letter size
//   GYT_AOT=inpaint.onnx  the learned fill for textured areas (else Telea there); flat areas take their colour
const NEW = !!(process.env.GYT_AOT || process.env.GYT_OUTLINE);
const OUTLINE = Number(process.env.GYT_OUTLINE ?? 0.3);
const loadModel = async (file) => {
  const ort = getOrt();
  const { session, ep } = await createSession(new Uint8Array(fs.readFileSync(file)), { gpu: false });
  return { ort, session, run: ortRun, ep }; // ep "wasm": the CPU's size budget, as in the extension without a GPU
};
const aot = process.env.GYT_AOT ? await loadModel(process.env.GYT_AOT) : null;
let aotMs = 0, aotAreas = 0, fills = { flat: 0, tone: 0, learned: 0, telea: 0 };

async function eraseNew(an, pixels, regionIds) {
  const res = erase(cv, pixels, an, regionIds, { keepMask: true, outline: OUTLINE });
  const t0 = Date.now();
  const image = await fillTexture(cv, aot, res.image, res);
  aotMs += Date.now() - t0; aotAreas += res.rois.filter((r) => r.fill === "texture").length;
  for (const r of res.rois) fills[r.fill === "texture" ? r.filled || "telea" : r.fill || "telea"]++;
  res.mask.delete(); res.surface.delete();
  return image;
}

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
  // GYT_ERASED=dir: measure pages erased by an earlier run (its p<id>-erased.png), without erasing again
  let clean;
  if (process.env.GYT_ERASED) {
    const e = await loadImage(path.join(process.env.GYT_ERASED, `p${pg.id}-erased.png`));
    const ec = createCanvas(W, H), ex = ec.getContext("2d"); ex.drawImage(e, 0, 0);
    clean = ex.getImageData(0, 0, W, H);
  } else clean = NEW ? await eraseNew(an, pixels, regionIds) : erase(cv, pixels, an, regionIds).image;
  const after = clean.data;

  const untagged = placements.filter((p) => p.tag == null).length;
  // marks left in each erased area (residue.mjs): bubbles against their interior, free text
  // against the page around it. The measure holds on a plain surround only; areas on a textured
  // one (screentone, art) are counted apart, and fill-truth.mjs measures their fill.
  let bubbles = 0, dirty = 0, freeDirty = 0, textured = 0;
  for (const r of an.regions) {
    if (!regionIds.has(r.id)) continue;
    const bubble = r.kind === "bubble";
    if (bubble) bubbles++;
    const m = marksLeft(before, after, W, H, r, bubble ? an.insideOf(r.id) : null);
    if (m?.textured) textured++;
    else if (m?.dirty) { if (bubble) dirty++; else freeDirty++; }
    crops.push({ page: pg.id, id: r.id, box: clampBox(r.box, W, H, bubble ? 0 : Math.round(r.letter || 8)), left: m?.lettered && !m.textured ? m.left : 0, W, H, before, after });
  }
  const blocks = [...regionIds].filter((id) => an.regions.find((r) => r.id === id)?.kind !== "bubble").length;
  rows.push({ page: pg.id, natural: rep.natural, work: [W, H], displayed: rep.displayed, items: items.length, placements: placements.length, untagged, bubbles, dirtyBubbles: dirty, freeText: blocks, dirtyFree: freeDirty, textured });

  // renders: erased only, and final
  const o = createCanvas(W, H), octx = o.getContext("2d"); octx.putImageData(clean, 0, 0);
  fs.writeFileSync(path.join(out, `p${pg.id}-erased.png`), o.toBuffer("image/png"));
  const drawn = GyText.draw(octx, placements, { fontFamily: rep.settings?.fontFamily || undefined, uppercase: rep.settings?.uppercase });
  if (process.env.AUDIT_DEBUG) console.error("page", pg.id, "drawn", drawn, JSON.stringify(placements.slice(0, 2).map((p) => ({ t: p.text.slice(0, 20), r: p.rect, l: p.letter, c: p.color }))));
  fs.writeFileSync(path.join(out, `p${pg.id}-final.png`), o.toBuffer("image/png"));
  an.dispose();
}

// crop sheet of the 12 worst areas (original | erased), 2x
crops.sort((a, b) => b.left - a.left);
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
    sc.fillText(`page ${k.page} region #${k.id}: marks ${k.left.toFixed(2)}`, pad, yy + 14);
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
const tot = rows.reduce((a, r) => ({ items: a.items + r.items, untagged: a.untagged + r.untagged, bubbles: a.bubbles + r.bubbles, dirty: a.dirty + r.dirtyBubbles, free: a.free + r.freeText, freeDirty: a.freeDirty + r.dirtyFree, textured: a.textured + r.textured }), { items: 0, untagged: 0, bubbles: 0, dirty: 0, free: 0, freeDirty: 0, textured: 0 });
console.log(JSON.stringify({ report: path.basename(zipPath), site: summary.page, pages: rows.length, ...tot, ...(NEW ? { fills, aotMsPerArea: Math.round(aotMs / Math.max(1, aotAreas)) } : {}) }));
fs.rmSync(tmp, { recursive: true, force: true });
