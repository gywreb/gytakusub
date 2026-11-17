// Learned inpainting (AOT-GAN, manga-trained): fills the masked lettering with what the
// surrounding art suggests (screentone, hatching, gradients), where Telea can only smear
// the border colours inward. Used by erase.js through an `inpainter` the worker provides.
//
// Model contract (aot_folded.onnx): image [1,3,H,W] in [-1, 1] with the masked pixels
// zeroed, mask [1,1,H,W] in {0, 1}; H and W multiples of 8; output [1,3,H,W] in [-1, 1].

/**
 * Inpaints one area. Only masked pixels change in the result.
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {{ort: any, session: any, run: (session: any, feeds: object) => Promise<object>}} model
 * @param {any} rgb cv.Mat CV_8UC3, the area (with some context around the lettering)
 * @param {any} mask cv.Mat CV_8UC1, 255 where the lettering is
 * @param {{maxSide?: number}} [opts] maxSide: areas larger than this are inpainted at a smaller size
 *   and the fill scaled back up. By default 768 px on the GPU and 384 on the CPU, where the model
 *   costs about 40 µs a pixel (a 768 × 512 area: 17 s; at 384 × 256: 4 s)
 * @returns {Promise<any>} cv.Mat CV_8UC3 the size of `rgb` (caller deletes)
 */
export async function aotInpaint(cv, model, rgb, mask, opts = {}) {
  const W = rgb.cols, H = rgb.rows, maxSide = opts.maxSide || (model.ep === "wasm" ? CPU_SIDE : GPU_SIDE);
  // scaled to fit maxSide, but never so far that the short side drops under MIN_SIDE (a long strip)
  const k = Math.min(1, Math.max(maxSide / Math.max(W, H), MIN_SIDE / Math.min(W, H)));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  // padded to multiples of 8, and to MIN_SIDE: the model's widest dilated convolution pads its
  // quarter-size feature map by 16 (reflecting), which needs that map to be more than 16 across
  const pw = Math.max(MIN_SIDE, Math.ceil(w / 8) * 8), ph = Math.max(MIN_SIDE, Math.ceil(h / 8) * 8);
  const small = new cv.Mat(), smask = new cv.Mat();
  if (k < 1) { cv.resize(rgb, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA); cv.resize(mask, smask, new cv.Size(w, h), 0, 0, cv.INTER_LINEAR); }
  else { rgb.copyTo(small); mask.copyTo(smask); }
  // pad to multiples of 8 by reflection (the pad is known pixels: mask 0 there)
  const img = new cv.Mat(), m = new cv.Mat();
  cv.copyMakeBorder(small, img, 0, ph - h, 0, pw - w, cv.BORDER_REFLECT_101);
  cv.copyMakeBorder(smask, m, 0, ph - h, 0, pw - w, cv.BORDER_CONSTANT, new cv.Scalar(0));
  small.delete(); smask.delete();
  const n = pw * ph, px = img.data, md = m.data;
  const image = new Float32Array(3 * n), maskT = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const on = md[i] > 127 ? 1 : 0;
    maskT[i] = on;
    if (!on) { image[i] = px[i * 3] / 127.5 - 1; image[n + i] = px[i * 3 + 1] / 127.5 - 1; image[2 * n + i] = px[i * 3 + 2] / 127.5 - 1; }
  }
  img.delete(); m.delete();
  const { ort, session, run } = model;
  const out = await run(session, { image: new ort.Tensor("float32", image, [1, 3, ph, pw]), mask: new ort.Tensor("float32", maskT, [1, 1, ph, pw]) });
  const o = (out.inpainted || out[session.outputNames[0]]).data;
  // A grey page stays grey: the model can tint its fill (a pink cast on screentone was seen),
  // so where the area around the lettering has no colour, the fill keeps only its brightness.
  const grey = isGrey(rgb, mask);
  const filled = new cv.Mat(h, w, cv.CV_8UC3), fd = filled.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * pw + x, j = (y * w + x) * 3;
    const r = (o[i] + 1) * 127.5, g = (o[n + i] + 1) * 127.5, b = (o[2 * n + i] + 1) * 127.5;
    if (grey) { const l = clamp8(0.299 * r + 0.587 * g + 0.114 * b); fd[j] = fd[j + 1] = fd[j + 2] = l; }
    else { fd[j] = clamp8(r); fd[j + 1] = clamp8(g); fd[j + 2] = clamp8(b); }
  }
  let full = filled;
  if (k < 1) { full = new cv.Mat(); cv.resize(filled, full, new cv.Size(W, H), 0, 0, cv.INTER_CUBIC); filled.delete(); }
  // only the masked pixels take the fill
  const res = rgb.clone();
  full.copyTo(res, mask);
  full.delete();
  return res;
}

/** The largest side the model inpaints at: on the GPU, and on the CPU (a time budget, see ADR 0013). */
export const GPU_SIDE = 768, CPU_SIDE = 384;
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
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) coloured++;
  }
  return seen > 0 && coloured / seen < 0.02;
}
