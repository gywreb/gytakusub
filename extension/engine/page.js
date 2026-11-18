// Worker-side orchestration of one page: prepare (downscale, analyse, stamp the
// text regions for the model) and finish (place the translations, erase the
// original lettering, hand back a cleaned page plus text placements).
// Used by the extension's service worker and by the web app's Web Worker.
import { getCV, getDetector, getSegmenter, getFallbackDetector, getInpainter, setEnginePrefs } from "./cv.js";
import { ortBroken } from "./ort.js";
import { analyze } from "./analyze.js";
import { segment } from "./segment.js";
import { detectText, detectInEmptyBubbles, detectInDarkShapes } from "./detect.js";
import { layout } from "./layout.js";
import { erase, eraseFullSize, fillTexture, contextMargin, NotLoaded } from "./erase.js";
import { aotInpaint } from "./inpaint.js";

// How far the mask grows over a lettering's outline, as a share of its letter size (ADR 0013).
export const OUTLINE = 0.3;
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
  // the learned eraser's models (null without them: rules and Telea, as before 2.12)
  // the learned eraser's model, loaded the first time an area needs it (white bubbles and
  // screentone don't); null when opts.learned is false: rules and Telea, as before 2.12
  const inpainter = opts.learned === false ? null : () => getInpainter();
  const items = [], placements = [], regions = [], rois = [], patches = [];
  // what erasing cost on this page (the debug report shows it): areas by how they were filled, and
  // the time the texture fills took (the part 2.12 added)
  const fill = { ms: 0, flat: 0, tone: 0, learned: 0, telea: 0, ready: 0 };
  // areas prefillPage() already filled while the translation was on the way (same inputs, same result)
  const cache = job.fills || null;
  const canvas = new OffscreenCanvas(work.W, work.H);
  const ctx = canvas.getContext("2d");
  // ids for regions the layout makes from adopted lettering: after the stamped ones, page-wide
  let nextId = Math.max(0, ...job.slices.map((s) => s.tagTo || 0)) + 1;
  const newId = () => nextId++;
  for (const [idx, s] of job.slices.entries()) {
    const an = s.analysis;
    const norm = normalizeItems(results[idx]?.items || [], s, width, height); // tag + box as page fractions
    const first = items.length;
    items.push(...norm);
    // layout wants boxes as fractions of this slice; `index` ties a placement back to its item (edits)
    const local = norm.map((it, k) => ({ ...it, index: first + k, box: it.box ? [((it.box[0] * width) - s.x) / s.w, ((it.box[1] * height) - s.y) / s.h, (it.box[2] * width) / s.w, (it.box[3] * height) / s.h] : null }));
    const { placements: pl, regionIds } = layout(an, local, { newId });
    for (const p of pl) placements.push({ ...p, rect: { x: p.rect.x + s.ox, y: p.rect.y + s.oy, w: p.rect.w, h: p.rect.h } });
    for (const r of an.regions) regions.push({ id: r.id, kind: r.kind, letter: r.letter, box: { x: r.box.x + s.ox, y: r.box.y + s.oy, w: r.box.w, h: r.box.h } });
    let clean = { image: s.imageData, rois: [] };
    if (regionIds.size) {
      clean = erase(cv, s.imageData, an, regionIds, { keepMask: true, outline: OUTLINE });
      // textured areas at the size the page was analysed at (when that is its own size, the
      // patches come from here; else the full-size pass below does them)
      if (!full) clean.image = await fillTexture(cv, inpainter, clean.image, clean, { cache });
    }
    ctx.putImageData(clean.image, s.ox, s.oy);
    if (full && clean.mask) {
      for (const r of clean.rois) { const p = await fullSizePatch(cv, opts.natural, s, scale, clean.mask, r, inpainter, clean.surface, cache); if (p) patches.push(p); }
    } else {
      for (const r of clean.rois) rois.push({ x: r.x + s.ox, y: r.y + s.oy, w: r.w, h: r.h });
    }
    for (const r of clean.rois) { const kind = r.fill === "texture" ? r.filled || "telea" : r.fill || "telea"; fill[kind]++; fill.ms += r.fillMs || 0; if (r.fillHit) fill.ready++; }
    clean.mask?.delete(); clean.surface?.delete();
    an.dispose();
  }
  const letter = job.slices.length ? job.slices[0].analysis.letter : 0;
  const first = job.slices[0]?.analysis;
  const engine = !first ? "heuristic" : first.segmented ? "segmented" : first.learned ? "learned" : "heuristic";
  const segmentMs = job.slices.reduce((n, s) => n + (s.analysis.segmentMs || 0), 0);
  const detectMs = job.slices.reduce((n, s) => n + (s.analysis.detectMs || 0), 0);
  // Patches: just the areas the eraser changed, cut from the cleaned page. The
  // extension ships these (a few KB each) instead of the whole page; the content
  // script draws them over the image it already shows.
  // the work copy shows the full-size erasing too (the debug export's clean page)
  for (const p of patches) ctx.drawImage(p.canvas, p.x * scale, p.y * scale, p.w * scale, p.h * scale);
  // (work-size patches, when the page was analysed at its own size or no full-size page was given)
  for (const r of rois) {
    const c = new OffscreenCanvas(r.w, r.h);
    c.getContext("2d").drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    patches.push({ x: r.x / scale, y: r.y / scale, w: r.w / scale, h: r.h / scale, canvas: c });
  }
  const backend = job.slices[0]?.analysis.backend || null;
  if (fill.learned) fill.ep = (await getInpainter())?.ep || null; // where the learned fill ran: webgpu / wasm
  if (job.prefillMs != null) fill.pre = job.prefillMs; // the time prefillPage() spent while the translation was on the way
  if (inpainterTimes.load != null) fill.model = { ...inpainterTimes }; // its load and first run, once per worker
  job.fills = null;
  return { items, placements, regions, work, letter, canvas, patches, fullSize: full, engine, segmentMs, detectMs, backend, fill };
}

/**
 * The learned inpainter, loaded and run once on a small area. Callers start this once a page has
 * an area that needs it (prefillPage counts them) and await it outside any queue they share:
 * loading and the first run can take many seconds, and a page that waits for them must not hold
 * the others up. Its times go into the debug report.
 * @returns {Promise<object|null>} the model, or null without one
 */
export function warmInpainter() {
  if (!warming) {
    warming = (async () => {
      const t0 = performance.now();
      const model = await getInpainter();
      inpainterTimes.load = Math.round(performance.now() - t0);
      if (!model) return null;
      try {
        const cv = await getCV(), t1 = performance.now();
        const rgb = new cv.Mat(72, 72, cv.CV_8UC3, new cv.Scalar(200, 200, 200)), hole = cv.Mat.zeros(72, 72, cv.CV_8UC1);
        cv.rectangle(hole, new cv.Point(24, 24), new cv.Point(48, 48), new cv.Scalar(255), -1);
        (await aotInpaint(cv, model, rgb, hole)).delete(); rgb.delete(); hole.delete();
        inpainterTimes.warm = Math.round(performance.now() - t1);
      } catch (e) { console.warn("Gytakusub: inpainter warm-up failed", e); }
      return model;
    })().then((model) => { warmed = { model }; return model; });
  }
  return warming;
}
let warming = null, warmed = null;
/** Whether warmInpainter() is done (no page then waits for the model). */
export const inpainterWarm = () => !!warmed;
/** How long the inpainter took to load and to run first (ms; null until it has). */
export const inpainterTimes = { load: null, warm: null };

/**
 * Fills a page's textured areas ahead of its translation, while the caller waits for Claude
 * (seconds in which the engine has nothing else to do for this page): every text region is
 * erased as if it had a translation, and each textured area is filled into `job.fills`, keyed
 * by the exact inputs of the fill (erase.js fillKey). finishPage() then reuses each area whose
 * inputs came out the same — nearly all, since most regions get a translation — and fills the
 * rest itself; its result is the same with or without this step, only sooner.
 * The caller must let this return (or throw from `checkpoint`) before calling finishPage(),
 * which frees the analyses.
 * An area that needs the learned inpainter before warmInpainter() has it ready is left for later
 * (the load must not happen inside the caller's queue): the count of those is returned, and kept
 * in `job.later` once a pass got through every area. Called again once the model is ready, a pass
 * fills just those (the others are found in the cache).
 * @param {Job} job from preparePage
 * @param {{natural?: ImageBitmap, checkpoint?: () => Promise<void>}} [opts] natural: as for
 *   finishPage (the same bitmap); checkpoint: awaited before each area, throws to stop
 * @returns {Promise<{later: number}>}
 */
export async function prefillPage(job, opts = {}) {
  const t0 = performance.now();
  const cv = await getCV();
  const full = !!opts.natural && job.scale < 0.999;
  const cache = job.fills || (job.fills = new Map());
  const inpainter = () => { if (!warmed) throw new NotLoaded(); return warmed.model; };
  let later = 0;
  // the time spent filling, not waiting at checkpoints for other pages
  let waited = 0;
  const checkpoint = opts.checkpoint ? async () => { const w = performance.now(); try { await opts.checkpoint(); } finally { waited += performance.now() - w; } } : null;
  try {
    for (const s of job.slices) {
      const an = s.analysis;
      if (!an.regions.length) continue;
      const clean = erase(cv, s.imageData, an, new Set(an.regions.map((r) => r.id)), { keepMask: true, outline: OUTLINE });
      try {
        if (!full) {
          await fillTexture(cv, inpainter, clean.image, clean, { cache, checkpoint });
          later += clean.rois.filter((r) => r.filled === "later").length;
        } else {
          for (const r of clean.rois) {
            if (r.fill !== "texture") continue;
            if (checkpoint) await checkpoint();
            try { await fullSizePatch(cv, opts.natural, s, job.scale, clean.mask, r, inpainter, clean.surface, cache); }
            catch (e) { if (!(e instanceof NotLoaded)) throw e; later++; }
          }
        }
      } finally { clean.mask?.delete(); clean.surface?.delete(); }
    }
    job.later = later;
    return { later };
  } finally { job.prefillMs = (job.prefillMs || 0) + Math.round(performance.now() - t0 - waited); }
}

/**
 * One erased area again at the page's own size: the work-resolution area `r` (slice coordinates)
 * widened to whole page pixels, cut from the full-size page, inpainted with the work mask resampled.
 */
async function fullSizePatch(cv, natural, s, scale, mask, r, model, surface, cache = null) {
  // a texture fill sees some of the page around the area (the patch is then that much larger;
  // outside the mask its pixels are the page's own)
  const m = r.fill === "texture" ? contextMargin(r.letter) : 0;
  const nx = Math.max(s.x, s.x + Math.floor((r.x - m) / scale)), ny = Math.max(s.y, s.y + Math.floor((r.y - m) / scale));
  const nx1 = Math.min(s.x + s.w, s.x + Math.ceil((r.x + r.w + m) / scale)), ny1 = Math.min(s.y + s.h, s.y + Math.ceil((r.y + r.h + m) / scale));
  const nw = nx1 - nx, nh = ny1 - ny;
  if (nw < 1 || nh < 1) return null;
  const c = new OffscreenCanvas(nw, nh), cctx = c.getContext("2d", { willReadFrequently: true });
  cctx.drawImage(natural, nx, ny, nw, nh, 0, 0, nw, nh);
  const done = await eraseFullSize(cv, cctx.getImageData(0, 0, nw, nh), nx, ny, mask, scale, s.x, s.y, r, model, surface, cache);
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
