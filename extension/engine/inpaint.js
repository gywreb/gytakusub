// Learned inpainting: fills the masked lettering with what the surrounding art suggests
// (screentone, hatching, gradients), where Telea can only smear the border colours inward.
// Used by erase.js through an `inpainter` the worker provides. Two models (cv.js getInpainter):
//
//  - AOT-GAN, manga-trained (inpaint.onnx; kind "aot"): image [1,3,H,W] in [-1, 1] with the
//    masked pixels zeroed, mask [1,1,H,W] in {0, 1}; H and W multiples of 8; output in [-1, 1].
//  - LaMa finetuned on manga (lama.onnx; kind "lama", on a graphics card, ADR 0015): image in
//    [0, 1] with the masked pixels zeroed, mask as above, output in [0, 1]; one size only
//    (`side`, 512): the area is scaled to fit it and padded to it.

import { FILL } from "./tuning.js";
import { owning } from "./owner.js";

/**
 * A copy of one area of `mat`, its rows continuous (caller deletes). The view the copy is made
 * through is freed here: a view left undeleted keeps the whole of its parent's memory alive after
 * the parent is deleted — a page's worth a time, until the OpenCV heap is full (a long chapter
 * then failed page after page).
 */
export function copyOf(mat, rect) {
  const view = mat.roi(rect);
  try { return view.clone(); } finally { view.delete(); }
}

/**
 * Inpaints one area. Only masked pixels change in the result.
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {{ort: any, session: any, run: (session: any, feeds: object) => Promise<object>}} model
 * @param {any} rgb cv.Mat CV_8UC3, the area (with some context around the lettering)
 * @param {any} mask cv.Mat CV_8UC1, 255 where the lettering is
 * @param {{maxSide?: number, context?: {image: any, x: number, y: number}, timing?: {run?: number}}} [opts] timing: gets the
 *   model run's own time (ms) in `run`. maxSide: areas larger
 *   than this are inpainted at a smaller size and the fill scaled back up. context: the image the
 *   area was cut from (RGB cv.Mat; the area's top-left at x, y), for a model of one size. By default 768 px on the GPU and 384 on the CPU, where the model
 *   costs about 40 µs a pixel (a 768 × 512 area: 17 s; at 384 × 256: 4 s)
 * @returns {Promise<any>} cv.Mat CV_8UC3 the size of `rgb` (caller deletes)
 */
export function aotInpaint(cv, model, rgb, mask, opts = {}) {
  return owning((own) => inpaintArea(cv, model, rgb, mask, opts, own));
}

async function inpaintArea(cv, model, rgb, mask, opts, own) {
  const fixed = model.side || 0, lama = model.kind === "lama";
  // A model of one size sees the real page around a smaller area (`opts.context`): padded with a
  // mirror image of the area, LaMa read the copies as more of the same and filled screentone with
  // dots out of step (SSIM 0.51 against 0.59 with the page around it, on 12 areas of a B/W chapter)
  const ctx = opts.context;
  if (fixed && ctx && rgb.cols <= fixed && rgb.rows <= fixed) {
    const win = contextWindow(ctx.image.cols, ctx.image.rows, ctx.x, ctx.y, rgb.cols, rgb.rows, fixed);
    const wr = own(copyOf(ctx.image, new cv.Rect(win.x, win.y, win.w, win.h))), wm = own(cv.Mat.zeros(win.h, win.w, cv.CV_8UC1));
    const at = new cv.Rect(ctx.x - win.x, ctx.y - win.y, rgb.cols, rgb.rows);
    { const v = own(wr.roi(at)); rgb.copyTo(v); v.delete(); const mv = own(wm.roi(at)); mask.copyTo(mv); mv.delete(); }
    const done = own(await aotInpaint(cv, model, wr, wm, { ...opts, context: null }));
    const part = own(done.roi(at)), res = own(rgb.clone());
    part.copyTo(res, mask);
    part.delete(); done.delete(); wr.delete(); wm.delete();
    return own.keep(res);
  }
  const W = rgb.cols, H = rgb.rows, maxSide = fixed || opts.maxSide || (model.ep === "wasm" ? CPU_SIDE : GPU_SIDE);
  // scaled to fit maxSide, but never so far that the short side drops under MIN_SIDE (a long strip;
  // a model of one size takes the strip whole instead, squeezed)
  const k = fixed ? Math.min(1, fixed / Math.max(W, H)) : Math.min(1, Math.max(maxSide / Math.max(W, H), MIN_SIDE / Math.min(W, H)));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  // padded to multiples of 8, and to MIN_SIDE: the model's widest dilated convolution pads its
  // quarter-size feature map by 16 (reflecting), which needs that map to be more than 16 across
  const pw = fixed || Math.max(MIN_SIDE, Math.ceil(w / 8) * 8), ph = fixed || Math.max(MIN_SIDE, Math.ceil(h / 8) * 8);
  const small = own(new cv.Mat()), smask = own(new cv.Mat());
  if (k < 1) { cv.resize(rgb, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA); cv.resize(mask, smask, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR); }
  else { rgb.copyTo(small); mask.copyTo(smask); }
  // pad to multiples of 8 by reflection (the pad is known pixels: mask 0 there)
  const img = own(new cv.Mat()), m = own(new cv.Mat());
  cv.copyMakeBorder(small, img, 0, ph - h, 0, pw - w, cv.BORDER_REFLECT_101);
  cv.copyMakeBorder(smask, m, 0, ph - h, 0, pw - w, cv.BORDER_CONSTANT, new cv.Scalar(0));
  small.delete(); smask.delete();
  const n = pw * ph, px = img.data, md = m.data;
  const image = new Float32Array(3 * n), maskT = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const on = md[i] > 127 ? 1 : 0;
    maskT[i] = on;
    if (!on) for (let c = 0; c < 3; c++) image[c * n + i] = lama ? px[i * 3 + c] / 255 : px[i * 3 + c] / 127.5 - 1;
  }
  img.delete(); m.delete();
  const { ort, session, run } = model;
  const t0 = performance.now();
  const out = await run(session, { image: new ort.Tensor("float32", image, [1, 3, ph, pw]), mask: new ort.Tensor("float32", maskT, [1, 1, ph, pw]) });
  if (opts.timing) opts.timing.run = (opts.timing.run || 0) + Math.round(performance.now() - t0); // the model's own time (the debug report)
  const o = (out.inpainted || out[session.outputNames[0]]).data;
  // A grey page stays grey: the model can tint its fill (a pink cast on screentone was seen),
  // so where the area around the lettering has no colour, the fill keeps only its brightness.
  const grey = isGrey(rgb, mask);
  const filled = own(new cv.Mat(h, w, cv.CV_8UC3)), fd = filled.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * pw + x, j = (y * w + x) * 3;
    const r = lama ? o[i] * 255 : (o[i] + 1) * 127.5, g = lama ? o[n + i] * 255 : (o[n + i] + 1) * 127.5, b = lama ? o[2 * n + i] * 255 : (o[2 * n + i] + 1) * 127.5;
    if (grey) { const l = clamp8(0.299 * r + 0.587 * g + 0.114 * b); fd[j] = fd[j + 1] = fd[j + 2] = l; }
    else { fd[j] = clamp8(r); fd[j + 1] = clamp8(g); fd[j + 2] = clamp8(b); }
  }
  let full = filled;
  if (k < 1) { full = own(new cv.Mat()); cv.resize(filled, full, new cv.Size(W, H), 0, 0, cv.INTER_CUBIC); filled.delete(); }
  // only the masked pixels take the fill
  const res = own(rgb.clone());
  full.copyTo(res, mask);
  full.delete();
  return own.keep(res);
}

/** The largest side the model inpaints at: on the GPU, and on the CPU (a time budget, see ADR 0013). */
export const GPU_SIDE = FILL.gpuSide, CPU_SIDE = FILL.cpuSide;
/** The one size the LaMa file takes (scripts/lama-static.py): what it was finetuned at. */
export const LAMA_SIDE = 512;

/**
 * The window of an image (cols × rows) a model of one size sees around an area (x, y, w, h): that
 * size, centred on the area, kept inside the image (smaller when the image is).
 */
export function contextWindow(cols, rows, x, y, w, h, side) {
  const ww = Math.min(side, cols), wh = Math.min(side, rows);
  const wx = Math.max(0, Math.min(cols - ww, Math.round(x + w / 2 - ww / 2))), wy = Math.max(0, Math.min(rows - wh, Math.round(y + h / 2 - wh / 2)));
  return { x: wx, y: wy, w: ww, h: wh };
}
const MIN_SIDE = 72;

const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Whether the unmasked pixels of an area carry no colour (a black-and-white page). */
function isGrey(rgb, mask) {
  const d = rgb.data, m = mask.data, n = rgb.rows * rgb.cols;
  let seen = 0, coloured = 0;
  for (let i = 0; i < n; i += 3) {
    if (m[i] > 127) continue;
    const r = d[i * 3], g = d[i * 3 + 1], b = d[i * 3 + 2];
    seen++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > FILL.greySpread) coloured++;
  }
  return seen > 0 && coloured / seen < FILL.greyShare;
}
