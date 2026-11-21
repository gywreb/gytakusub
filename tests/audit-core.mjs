// Core-quality audit on real debug reports (2.11.0; the measurements behind the 3.0 plan).
// For every page: analyse, lay out the report's items, erase, then measure
//  - items drawn over unerased original text (untagged: placed by box only)
//  - marks left by the eraser in each erased area (residue.mjs)
// and write renders + a crop sheet of the worst bubbles for visual review.
//   npm run audit -- <report.zip> <outdir> [--rtdetr detector.onnx]   (reports stay local: they hold the pages)
// With --rtdetr (comic-translate's text detector, ogkalu/comic-text-and-bubble-detector, Apache-2.0:
// a witness independent of ours), also
//  - lettering left: text it finds on the original inside the lines Claude translated (Claude's
//    boxes) that it still finds on the erased page — Japanese left beside or under the English
// and always
//  - moved: translations drawn nowhere near where Claude saw their text
//  - shrunk: translations drawn under 0.6 of their original letter size for want of room
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage } from "canvas";
import { cv, detector, analyzePage } from "./cv-node.mjs";
import { lookAgain } from "../extension/engine/page.js";
import { layout, tells } from "../extension/engine/layout.js";
import { erase, fillTexture } from "../extension/engine/erase.js";
import { getOrt, createSession, run as ortRun } from "../extension/engine/ort.js";
import { loadLettering } from "./lettering-setup.mjs";
import { marksLeft } from "./residue.mjs";

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const rtdetrFile = opt("--rtdetr");
const [zipPath, out] = argv;
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
  // the region now that overlaps the region then the most (two bubbles' boxes can overlap, so the
  // smallest box around the old centre can be the neighbour); the centre rule only for older
  // reports whose regions no longer match any
  const a = then.box, iou = (b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / (a.w * a.h + b.w * b.h - w * h) : 0;
  };
  let best = null, bestIou = 0.3;
  for (const r of an.regions) { const v = iou(r.box); if (v > bestIou) { best = r; bestIou = v; } }
  if (best) return best.id;
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
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

// The witness: RT-DETR-v2 as comic-translate runs it (page resized to 640 × 640); its text boxes
// (classes 1, text in a bubble, and 2, text outside) in page pixels.
const rtdetr = rtdetrFile ? (await createSession(new Uint8Array(fs.readFileSync(rtdetrFile)), { gpu: false })).session : null;
async function witnessText(img) {
  const { width: W, height: H } = img;
  const c = createCanvas(W, H); c.getContext("2d").putImageData(img, 0, 0);
  const s = createCanvas(640, 640), sx = s.getContext("2d"); sx.drawImage(c, 0, 0, 640, 640);
  const d = sx.getImageData(0, 0, 640, 640).data, n = 640 * 640, a = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) a[k * n + i] = d[i * 4 + k] / 255;
  const ort = getOrt();
  const o = await ortRun(rtdetr, { images: new ort.Tensor("float32", a, [1, 3, 640, 640]), orig_target_sizes: new ort.Tensor("int64", BigInt64Array.from([BigInt(W), BigInt(H)]), [1, 2]) });
  const boxes = [];
  for (let i = 0; i < o.scores.data.length; i++) {
    if (o.scores.data[i] < 0.3 || Number(o.labels.data[i]) === 0) continue;
    const b = o.boxes.data;
    boxes.push({ x: b[i * 4], y: b[i * 4 + 1], w: b[i * 4 + 2] - b[i * 4], h: b[i * 4 + 3] - b[i * 4 + 1] });
  }
  return boxes;
}
const cover = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? (w * h) / Math.max(1, a.w * a.h) : 0; };
const widen = (b, f) => ({ x: b.x - f * b.w, y: b.y - f * b.h, w: b.w * (1 + 2 * f), h: b.h * (1 + 2 * f) });
const SIZE_MUL = { small: 0.8, normal: 1, large: 1.3 }; // text.js: the size a line is aimed at, by Claude's size
const cases = []; // what went wrong where, for the eye
const marks = []; // every erased area's measure, to compare two builds area by area
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
// GYT_PAGES=03,07: only those pages (to look at a few closely)
const only = process.env.GYT_PAGES ? new Set(process.env.GYT_PAGES.split(",")) : null;
for (const pg of summary.pages) {
  if (only && !only.has(pg.id)) continue;
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
    return { tag: rematch(an, rep, it), box, text: it.text, size: it.size, kind: it.kind, index, ...(it.source ? { source: it.source } : {}), ...(it.same ? { same: true } : {}) };
  });
  // the second look at lettering Claude translated where the analysis found none (2.13; GYT_LOOK=0: without)
  if (process.env.GYT_LOOK !== "0") await lookAgain(cv, pixels, an, items, detector);
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
  // drawn by its box alone, over whatever is there (nothing erased under it)
  for (const p of placements) if (p.tag == null) cases.push({ page: pg.id, what: "untagged", text: p.text.slice(0, 40), at: [p.rect.x, p.rect.y, p.rect.w, p.rect.h].map(Math.round) });
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
    marks.push({ page: pg.id, kind: r.kind, box: r.box, left: m?.left ?? null, dirty: !!m?.dirty, textured: !!m?.textured });
  }
  const blocks = [...regionIds].filter((id) => an.regions.find((r) => r.id === id)?.kind !== "bubble").length;

  // Claude's box for each item, in work pixels
  // (a line with nothing to translate, only marks, is left as drawn by design: not counted)
  const seen = items.map((it) => (Array.isArray(it.box) && tells(it) ? { x: it.box[0] * W, y: it.box[1] * H, w: it.box[2] * W, h: it.box[3] * H } : null));
  // lettering left (the witness): its text on the original inside a translated line's box, still there after erasing
  let lettering = 0, left = 0;
  if (rtdetr) {
    const was = await witnessText(new ImageData(before, W, H)), now = await witnessText(clean);
    for (const t of was) {
      const k = seen.findIndex((b) => b && cover(t, widen(b, 0.25)) >= 0.5);
      if (k < 0) continue; // text Claude did not translate (or not text)
      lettering++;
      if (now.some((c) => cover(t, c) >= 0.5 || cover(c, t) >= 0.5)) { left++; cases.push({ page: pg.id, what: "left", text: items[k].text.slice(0, 40), at: [t.x, t.y, t.w, t.h].map(Math.round) }); }
    }
  }
  // moved: drawn nowhere near where Claude saw the text
  let moved = 0;
  for (const p of placements) {
    const b = p.item != null ? seen[p.item] : null;
    if (!b) continue;
    const near = { x: b.x - p.letter, y: b.y - p.letter, w: b.w + 2 * p.letter, h: b.h + 2 * p.letter };
    if (cover(p.rect, widen(near, 0.5)) === 0) { moved++; cases.push({ page: pg.id, what: "moved", text: p.text.slice(0, 40) }); }
  }
  rows.push({ page: pg.id, natural: rep.natural, work: [W, H], displayed: rep.displayed, items: items.length, placements: placements.length, untagged, bubbles, dirtyBubbles: dirty, freeText: blocks, dirtyFree: freeDirty, textured, lettering, left, moved });

  // renders: erased only, and final
  const o = createCanvas(W, H), octx = o.getContext("2d"); octx.putImageData(clean, 0, 0);
  fs.writeFileSync(path.join(out, `p${pg.id}-erased.png`), o.toBuffer("image/png"));
  const sizes = [];
  const drawn = GyText.draw(octx, placements, { fontFamily: rep.settings?.fontFamily || undefined, uppercase: rep.settings?.uppercase, sizes });
  // shrunk: drawn under 0.6 of the size it was aimed at (the original letter) for want of room
  let shrunkFree = 0, shrunkBubble = 0, free = 0;
  placements.forEach((p, i) => {
    const aim = p.letter * 1.45 * (SIZE_MUL[p.size] || 1);
    if (p.halo) free++;
    if (sizes[i] < 0.6 * aim) { if (p.halo) shrunkFree++; else shrunkBubble++; cases.push({ page: pg.id, what: p.halo ? "shrunk free" : "shrunk bubble", text: p.text.slice(0, 40), size: sizes[i], aim: Math.round(aim) }); }
  });
  Object.assign(rows.at(-1), { free, shrunkFree, shrunkBubble });
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
fs.writeFileSync(path.join(out, "cases.json"), JSON.stringify(cases, null, 1));
fs.writeFileSync(path.join(out, "marks.json"), JSON.stringify(marks));
const tot = rows.reduce((a, r) => ({ items: a.items + r.items, untagged: a.untagged + r.untagged, bubbles: a.bubbles + r.bubbles, dirty: a.dirty + r.dirtyBubbles, free: a.free + r.freeText, freeDirty: a.freeDirty + r.dirtyFree, textured: a.textured + r.textured, moved: a.moved + r.moved, freeLines: a.freeLines + r.free, shrunkFree: a.shrunkFree + r.shrunkFree, shrunkBubble: a.shrunkBubble + r.shrunkBubble, ...(rtdetr ? { lettering: a.lettering + r.lettering, left: a.left + r.left } : {}) }), { items: 0, untagged: 0, bubbles: 0, dirty: 0, free: 0, freeDirty: 0, textured: 0, moved: 0, freeLines: 0, shrunkFree: 0, shrunkBubble: 0, ...(rtdetr ? { lettering: 0, left: 0 } : {}) });
console.log(JSON.stringify({ report: path.basename(zipPath), site: summary.page, pages: rows.length, ...tot, ...(NEW ? { fills, aotMsPerArea: Math.round(aotMs / Math.max(1, aotAreas)) } : {}) }));
fs.rmSync(tmp, { recursive: true, force: true });
