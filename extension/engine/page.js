// Worker-side orchestration of one page: prepare (downscale, analyse, stamp the
// text regions for the model) and finish (place the translations, erase the
// original lettering, hand back a cleaned page plus text placements).
// Used by the extension's service worker and by the web app's Web Worker.
import { getCV, getDetector, getSegmenter, getFallbackDetector, setEnginePrefs } from "./cv.js";
import { ortBroken } from "./ort.js";
import { analyze } from "./analyze.js";
import { segment } from "./segment.js";
import { detectText, detectInEmptyBubbles, detectInDarkShapes } from "./detect.js";
import { layout } from "./layout.js";
import { erase, eraseFullSize } from "./erase.js";
import { sliceGeometry, normalizeItems } from "../prompt.js";

/**
 * Text lines (and bubbles, with a segmenter) for one slice, then the analysis.
 * `checkpoint` is awaited between the model runs (see preparePage); its time is not counted.
 */
async function analyzeSlice(cv, detector, segmenter, imageData, checkpoint = async () => {}) {
  let t0 = Date.now();
  let lines = detector ? await detectText(cv, detector, imageData) : null;
  let detectMs = Date.now() - t0;
  await checkpoint();
  t0 = Date.now();
  if (lines) lines = await detectInDarkShapes(cv, detector, imageData, lines);
  detectMs += Date.now() - t0;
  await checkpoint();
  const seg = segmenter ? await segment(segmenter, imageData) : null;
  await checkpoint();
  if (lines && seg) { const t1 = Date.now(); lines = await detectInEmptyBubbles(cv, detector, imageData, lines, seg.instances, segmenter.bubbleClasses); detectMs += Date.now() - t1; }
  const analysis = analyze(cv, imageData, { detector, lines, instances: seg ? seg.instances : null, bubbleClasses: segmenter?.bubbleClasses });
  analysis.segmentMs = seg ? seg.ms : 0; analysis.detectMs = detectMs;
  analysis.backend = `detect:${detector ? detector.ep : "none"} segment:${segmenter ? segmenter.ep : "none"}`;
  return analysis;
}

/**
 * @param {ImageBitmap} bitmap the page at natural size
 * @param {{maxLongEdge:number, stripWidth:number, sliceHeight:number, useGpu?: boolean}} settings
 * @param {{checkpoint?: () => Promise<void>}} [opts] checkpoint: awaited between model runs, so a caller
 *   can let a more urgent page go first or stop here (it throws to stop; the analyses made so far are freed)
 * @returns {Promise<Job>}
 */
export async function preparePage(bitmap, settings, opts = {}) {
  const checkpoint = opts.checkpoint || (async () => {});
  setEnginePrefs({ gpu: settings?.useGpu !== false });
  const cv = await getCV();
  const [detector, segmenter] = await Promise.all([getDetector(), getSegmenter()]);
  const W = bitmap.width, H = bitmap.height;
  const geometry = sliceGeometry(W, H, settings);
  const scale = geometry[0].scale; // one scale for the whole page
  const work = { W: Math.max(1, Math.round(W * scale)), H: Math.max(1, Math.round(H * scale)) };
  const slices = [];
  let nextId = 1;
  try {
    for (const s of geometry) {
      await checkpoint();
      const cw = Math.max(1, Math.round(s.w * scale)), ch = Math.max(1, Math.round(s.h * scale));
      const canvas = new OffscreenCanvas(cw, ch);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(bitmap, s.x, s.y, s.w, s.h, 0, 0, cw, ch);
      const imageData = ctx.getImageData(0, 0, cw, ch);
      // bubbles from the segmentation model when there is one; the analysis then
      // only has to read the text inside them
      let analysis;
      try { analysis = await analyzeSlice(cv, detector, segmenter, imageData, checkpoint); }
      catch (e) {
        // The model runtime failed (engine/ort.js): this page and the rest of this
        // worker's life use the OpenCV text detector and no bubble model.
        if (!ortBroken() || e?.name === "Cancelled") throw e;
        analysis = await analyzeSlice(cv, await getFallbackDetector(), null, imageData, checkpoint);
      }
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
  } catch (e) {
    for (const sl of slices) sl.analysis.dispose(); // stopped at a checkpoint, or failed: free what was made
    throw e;
  }
  return { width: W, height: H, work, scale, slices };
}

/**
 * @param {Job} job from preparePage (its analyses are consumed and disposed here)
 * @param {Array<{items:any[]}>} results model output per slice, same order
 * @param {{natural?: ImageBitmap}} [opts] natural: the page at its own size again; when the page was
 *   downscaled for the analysis, the erased areas are then inpainted again at full size (patches
 *   with the page's own resolution). The caller keeps and closes the bitmap.
 * @returns patches in PAGE pixels ({x, y, w, h} of the full-size page, canvas at that size or, without
 *   `natural`, at the work size), placements and regions in work pixels.
 */
export async function finishPage(job, results, opts = {}) {
  const cv = await getCV();
  const { width, height, work, scale } = job;
  const full = !!opts.natural && scale < 0.999;
  const items = [], placements = [], regions = [], rois = [], patches = [];
  const canvas = new OffscreenCanvas(work.W, work.H);
  const ctx = canvas.getContext("2d");
  job.slices.forEach((s, idx) => {
    const an = s.analysis;
    const norm = normalizeItems(results[idx]?.items || [], s, width, height); // tag + box as page fractions
    const first = items.length;
    items.push(...norm);
    // layout wants boxes as fractions of this slice; `index` ties a placement back to its item (edits)
    const local = norm.map((it, k) => ({ ...it, index: first + k, box: it.box ? [((it.box[0] * width) - s.x) / s.w, ((it.box[1] * height) - s.y) / s.h, (it.box[2] * width) / s.w, (it.box[3] * height) / s.h] : null }));
    const { placements: pl, regionIds } = layout(an, local);
    for (const p of pl) placements.push({ ...p, rect: { x: p.rect.x + s.ox, y: p.rect.y + s.oy, w: p.rect.w, h: p.rect.h } });
    for (const r of an.regions) regions.push({ id: r.id, kind: r.kind, letter: r.letter, box: { x: r.box.x + s.ox, y: r.box.y + s.oy, w: r.box.w, h: r.box.h } });
    const clean = regionIds.size ? erase(cv, s.imageData, an, regionIds, { keepMask: full }) : { image: s.imageData, rois: [] };
    ctx.putImageData(clean.image, s.ox, s.oy);
    if (full && clean.mask) {
      for (const r of clean.rois) { const p = fullSizePatch(cv, opts.natural, s, scale, clean.mask, r); if (p) patches.push(p); }
      clean.mask.delete();
    } else {
      for (const r of clean.rois) rois.push({ x: r.x + s.ox, y: r.y + s.oy, w: r.w, h: r.h });
    }
    an.dispose();
  });
  const letter = job.slices.length ? job.slices[0].analysis.letter : 0;
  const first = job.slices[0]?.analysis;
  const engine = !first ? "heuristic" : first.segmented ? "segmented" : first.learned ? "learned" : "heuristic";
  const segmentMs = job.slices.reduce((n, s) => n + (s.analysis.segmentMs || 0), 0);
  const detectMs = job.slices.reduce((n, s) => n + (s.analysis.detectMs || 0), 0);
  // Patches: just the areas the eraser changed, cut from the cleaned page. The
  // extension ships these (a few KB each) instead of the whole page; the content
  // script draws them over the image it already shows.
  // (work-size patches, when the page was analysed at its own size or no full-size page was given)
  for (const r of rois) {
    const c = new OffscreenCanvas(r.w, r.h);
    c.getContext("2d").drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    patches.push({ x: r.x / scale, y: r.y / scale, w: r.w / scale, h: r.h / scale, canvas: c });
  }
  const backend = job.slices[0]?.analysis.backend || null;
  return { items, placements, regions, work, letter, canvas, patches, fullSize: full, engine, segmentMs, detectMs, backend };
}

/**
 * One erased area again at the page's own size: the work-resolution area `r` (slice coordinates)
 * widened to whole page pixels, cut from the full-size page, inpainted with the work mask resampled.
 */
function fullSizePatch(cv, natural, s, scale, mask, r) {
  const nx = s.x + Math.floor(r.x / scale), ny = s.y + Math.floor(r.y / scale);
  const nx1 = Math.min(s.x + s.w, s.x + Math.ceil((r.x + r.w) / scale)), ny1 = Math.min(s.y + s.h, s.y + Math.ceil((r.y + r.h) / scale));
  const nw = nx1 - nx, nh = ny1 - ny;
  if (nw < 1 || nh < 1) return null;
  const c = new OffscreenCanvas(nw, nh), cctx = c.getContext("2d", { willReadFrequently: true });
  cctx.drawImage(natural, nx, ny, nw, nh, 0, 0, nw, nh);
  const done = eraseFullSize(cv, cctx.getImageData(0, 0, nw, nh), nx, ny, mask, scale, s.x, s.y, r.radius || 3);
  if (!done) return null;
  cctx.putImageData(done, 0, 0);
  return { x: nx, y: ny, w: nw, h: nh, canvas: c };
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
