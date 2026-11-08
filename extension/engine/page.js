// Worker-side orchestration of one page: prepare (downscale, analyse, stamp the
// text regions for the model) and finish (place the translations, erase the
// original lettering, hand back a cleaned page plus text placements).
// Used by the extension's service worker and by the web app's Web Worker.
import { getCV } from "./cv.js";
import { analyze } from "./analyze.js";
import { layout } from "./layout.js";
import { erase } from "./erase.js";
import { sliceGeometry, normalizeItems } from "../prompt.js";

/**
 * @param {ImageBitmap} bitmap the page at natural size
 * @param {{maxLongEdge:number, stripWidth:number, sliceHeight:number}} settings
 * @returns {Promise<Job>}
 */
export async function preparePage(bitmap, settings) {
  const cv = await getCV();
  const W = bitmap.width, H = bitmap.height;
  const geometry = sliceGeometry(W, H, settings);
  const scale = geometry[0].scale; // one scale for the whole page
  const work = { W: Math.max(1, Math.round(W * scale)), H: Math.max(1, Math.round(H * scale)) };
  const slices = [];
  let nextId = 1;
  for (const s of geometry) {
    const cw = Math.max(1, Math.round(s.w * scale)), ch = Math.max(1, Math.round(s.h * scale));
    const canvas = new OffscreenCanvas(cw, ch);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bitmap, s.x, s.y, s.w, s.h, 0, 0, cw, ch);
    const imageData = ctx.getImageData(0, 0, cw, ch);
    const analysis = analyze(cv, imageData);
    const tagFrom = nextId;
    for (const r of analysis.regions) r.id = nextId++; // page-wide numbering
    const tagTo = nextId - 1;
    stampMarks(ctx, analysis.regions, cw);
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const b64 = await blobToBase64(jpeg);
    slices.push({
      // for the model
      b64, mediaType: "image/jpeg", cw, ch, tagFrom, tagTo,
      // geometry in natural-page pixels (normalizeItems) and in work pixels
      x: s.x, y: s.y, w: s.w, h: s.h, ox: Math.round(s.x * scale), oy: Math.round(s.y * scale),
      imageData, analysis,
    });
  }
  return { width: W, height: H, work, scale, slices };
}

/**
 * @param {Job} job from preparePage (its analyses are consumed and disposed here)
 * @param {Array<{items:any[]}>} results model output per slice, same order
 * @param {{wantClean?: boolean}} [opts]
 */
export async function finishPage(job, results, opts = {}) {
  const cv = await getCV();
  const { width, height, work } = job;
  const items = [], placements = [], regions = [];
  const canvas = new OffscreenCanvas(work.W, work.H);
  const ctx = canvas.getContext("2d");
  job.slices.forEach((s, idx) => {
    const an = s.analysis;
    const norm = normalizeItems(results[idx]?.items || [], s, width, height); // tag + box as page fractions
    items.push(...norm);
    // layout wants boxes as fractions of this slice
    const local = norm.map((it) => ({ ...it, box: it.box ? [((it.box[0] * width) - s.x) / s.w, ((it.box[1] * height) - s.y) / s.h, (it.box[2] * width) / s.w, (it.box[3] * height) / s.h] : null }));
    const { placements: pl, regionIds } = layout(an, local);
    for (const p of pl) placements.push({ ...p, rect: { x: p.rect.x + s.ox, y: p.rect.y + s.oy, w: p.rect.w, h: p.rect.h } });
    for (const r of an.regions) regions.push({ id: r.id, kind: r.kind, letter: r.letter, box: { x: r.box.x + s.ox, y: r.box.y + s.oy, w: r.box.w, h: r.box.h } });
    const clean = regionIds.size ? erase(cv, s.imageData, an, regionIds) : s.imageData;
    ctx.putImageData(clean, s.ox, s.oy);
    an.dispose();
  });
  const letter = job.slices.length ? job.slices[0].analysis.letter : 0;
  return { items, placements, regions, work, letter, canvas };
}

/** Red numbered stamps at the top-left of each text region. */
export function stampMarks(ctx, regions, cw) {
  const r = Math.max(9, Math.round(cw / 70));
  ctx.save();
  ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const reg of regions) {
    const cx = reg.box.x + r + 1, cy = reg.box.y + r + 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "#e11d48"; ctx.fill();
    ctx.lineWidth = Math.max(1, r / 6); ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.fillText(String(reg.id), cx, cy + r * 0.05);
  }
  ctx.restore();
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
}

/**
 * @typedef {object} Job
 * @property {number} width natural page width
 * @property {number} height
 * @property {{W:number,H:number}} work working-resolution size (the cleaned page and placements use it)
 * @property {number} scale work / natural
 * @property {Array<object>} slices
 */
