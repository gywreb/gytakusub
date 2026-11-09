// Learned text detection: PaddleOCR PP-OCRv4 detector (DBNet, Apache-2.0),
// from the bundled ONNX file. Finds every text line on a page — Latin or CJK,
// light or dark, any size — and nothing else, which is the step hand-written
// rules kept getting wrong on real scans.
//
// Two backends run the same model: ONNX Runtime (engine/ort.js; ~4× faster
// on wasm, the default) and OpenCV's dnn module (the fallback when the runtime
// is unavailable). vendor/ppocr-det.onnx is the official model with its
// HardSigmoid nodes rewritten as Mul/Add/Clip, which OpenCV 4.5 lacks and
// ONNX Runtime does not mind; see scripts/vendor-detector.mjs.

import { createSession, run } from "./ort.js";

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

/**
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {Uint8Array} modelBytes ONNX file contents
 * @param {{ort?: object, gpu?: boolean, wasmBinary?: ArrayBuffer, post?: Post}} [opts] ort: the ONNX Runtime namespace (engine/ort.js getOrt()) to run on it — on the GPU when `gpu` and available; OpenCV dnn otherwise. post: the model's DB post-processing (its inference.yml)
 * @returns {Promise<Detector>}
 */
export async function loadDetector(cv, modelBytes, opts = {}) {
  const post = { ...DEFAULT_POST, ...(opts.post || {}) };
  if (opts.ort) {
    const { session, ep } = await createSession(modelBytes, { gpu: !!opts.gpu, wasmBinary: opts.wasmBinary });
    return { kind: "ort", ort: opts.ort, session, ep, bytes: modelBytes, cv, post };
  }
  return { kind: "dnn", ep: "opencv", ...loadDnn(cv, modelBytes), bytes: modelBytes, cv, post };
}

/** The page's longest side at the model's input; DB post-processing: probability threshold, minimum mean score of a box, unclip ratio. */
const DEFAULT_POST = { maxSide: 960, thresh: 0.3, boxThresh: 0.5, unclip: 1.6 };

function loadDnn(cv, modelBytes) {
  const name = `ppocr-det-${Math.random().toString(36).slice(2)}.onnx`;
  cv.FS_createDataFile("/", name, modelBytes, true, false, false);
  const net = cv.readNetFromONNX(name);
  try { cv.FS_unlink("/" + name); } catch { /* keep */ }
  return { net, inputSize: null };
}

/**
 * Text lines on the image, in image pixels.
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {Detector} det from loadDetector
 * @param {ImageData} img
 * @param {{maxSide?: number, threshold?: number, unclip?: number}} [opts]
 * @returns {Promise<Line[]>}
 */
export async function detectText(cv, det, img, opts = {}) {
  opts = { ...det.post, ...opts };
  const inp = prepareInput(cv, img, opts);
  let prob;
  if (det.kind === "ort") {
    const tensor = new det.ort.Tensor("float32", new Float32Array(inp.data), [1, 3, inp.h, inp.w]); // a copy: the blob lives in OpenCV's heap
    inp.blob.delete();
    const out = await run(det.session, { [det.session.inputNames[0]]: tensor });
    prob = out[det.session.outputNames[0]].data;
  } else { prob = forwardDnn(cv, det, inp); inp.blob.delete(); }
  return decodeOutput(cv, prob, inp, opts);
}

/**
 * A second look inside bubbles the segmentation model found but the page-wide
 * pass left without text: each such bubble is cropped and detected again at up
 * to twice the resolution. The page-wide pass works on the page shrunk to 960 px,
 * where a small or thin line inside a bubble can fall under the detector's
 * threshold; a bubble is strong evidence that lettering is there, and the crop
 * gives the detector the pixels to see it. Returns the page lines plus any found.
 * @param {Line[]} lines from detectText on the whole page
 * @param {import("./segment.js").Instance[]} instances
 * @param {Set<number>} [bubbleClasses]
 */
export async function detectInEmptyBubbles(cv, det, img, lines, instances, bubbleClasses) {
  const out = lines.slice();
  for (const inst of instances) {
    if (bubbleClasses && !bubbleClasses.has(inst.cls)) continue;
    const { x, y, w, h } = inst.box;
    if (w < 12 || h < 12 || !inst.mask) continue;
    const inMask = (px, py) => { const lx = Math.round(px) - x, ly = Math.round(py) - y; return lx >= 0 && ly >= 0 && lx < w && ly < h && inst.mask[ly * w + lx] !== 0; };
    if (out.some((l) => inMask(l.x + l.w / 2, l.y + l.h / 2))) continue;
    const crop = new ImageData(new Uint8ClampedArray(w * h * 4), w, h), cd = crop.data, sd = img.data, W = img.width;
    for (let yy = 0; yy < h; yy++) cd.set(sd.subarray(((y + yy) * W + x) * 4, ((y + yy) * W + x + w) * 4), yy * w * 4);
    const found = await detectText(cv, det, crop, { maxSide: 960, maxScale: 2 });
    for (const l of found) {
      const g = { ...l, x: l.x + x, y: l.y + y };
      if (inMask(g.x + g.w / 2, g.y + g.h / 2)) out.push(g);
    }
  }
  return out;
}

/**
 * A second look inside dark bubbles the page-wide pass left empty. Small white
 * lettering on black falls under the detector's threshold at the page-wide scale
 * more readily than dark lettering on white, and the segmentation model is
 * trained on light bubbles. A dark shape is looked at again when it is shaped
 * like a bubble — compact, convex, a small part of the page — holds a little
 * light ink (lettering, not a highlight across the shape) and no detected line:
 * its crop is detected at up to twice the resolution, as in detectInEmptyBubbles.
 * Returns the page lines plus any found inside such shapes.
 */
export async function detectInDarkShapes(cv, det, img, lines) {
  const W = img.width, H = img.height;
  const src = cv.matFromImageData(img), gray = new cv.Mat(), dark = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); src.delete();
  cv.threshold(gray, dark, 70, 255, cv.THRESH_BINARY_INV);
  const labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat();
  const n = cv.connectedComponentsWithStats(dark, labels, stats, cents, 8, cv.CV_32S);
  const S = stats.data32S, L = labels.data32S, G = gray.data, shapes = [];
  const hasLine = (r) => lines.some((l) => { const cx = l.x + l.w / 2, cy = l.y + l.h / 2; return cx >= r.x && cy >= r.y && cx < r.x + r.width && cy < r.y + r.height; });
  for (let i = 1; i < n; i++) {
    const r = { x: S[i * 5], y: S[i * 5 + 1], width: S[i * 5 + 2], height: S[i * 5 + 3] }, ink = S[i * 5 + 4];
    if (ink < 0.002 * W * H || ink > 0.06 * W * H || ink < 0.45 * r.width * r.height || r.width > 4 * r.height || r.height > 4 * r.width || hasLine(r)) continue;
    // the shape filled (lettering holes included), its convexity, and the light ink in it
    const m = new cv.Mat(r.height, r.width, cv.CV_8UC1), md = m.data;
    for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) md[y * r.width + x] = L[(r.y + y) * W + r.x + x] === i ? 255 : 0;
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = -1, filled = 0;
    for (let k = 0; k < contours.size(); k++) { const ct = contours.get(k), a = cv.contourArea(ct); if (a > filled) { filled = a; best = k; } ct.delete(); }
    if (best >= 0) {
      const ct = contours.get(best), hull = new cv.Mat(); cv.convexHull(ct, hull);
      const solidity = filled / Math.max(1, cv.contourArea(hull)); hull.delete(); ct.delete();
      if (solidity >= 0.9 && filled >= 0.6 * r.width * r.height) {
        m.setTo(new cv.Scalar(0)); cv.drawContours(m, contours, best, new cv.Scalar(255), -1);
        let inside = 0, light = 0;
        for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) if (md[y * r.width + x]) { inside++; if (G[(r.y + y) * W + r.x + x] > 180) light++; }
        if (light >= 0.01 * inside && light <= 0.35 * inside) shapes.push({ r, mask: new Uint8Array(md) });
      }
    }
    contours.delete(); hier.delete(); m.delete();
  }
  labels.delete(); stats.delete(); cents.delete(); gray.delete(); dark.delete();
  const out = lines.slice();
  for (const { r, mask } of shapes) {
    const { x, y, width: w, height: h } = r;
    const crop = new ImageData(new Uint8ClampedArray(w * h * 4), w, h), cd = crop.data, sd = img.data;
    for (let yy = 0; yy < h; yy++) cd.set(sd.subarray(((y + yy) * W + x) * 4, ((y + yy) * W + x + w) * 4), yy * w * 4);
    for (const l of await detectText(cv, det, crop, { maxSide: 960, maxScale: 2 })) {
      const lx = Math.round(l.x + l.w / 2), ly = Math.round(l.y + l.h / 2);
      if (lx >= 0 && ly >= 0 && lx < w && ly < h && mask[ly * w + lx]) out.push({ ...l, x: l.x + x, y: l.y + y });
    }
  }
  return out;
}

/** detectText for the OpenCV backend only, without a promise (analyze() is synchronous). */
export function detectTextSync(cv, det, img, opts = {}) {
  if (det.kind === "ort") throw new Error("detectTextSync: the ONNX Runtime detector is asynchronous; pass `lines` to analyze()");
  opts = { ...det.post, ...opts };
  const inp = prepareInput(cv, img, opts);
  const prob = forwardDnn(cv, det, inp); inp.blob.delete();
  return decodeOutput(cv, prob, inp, opts);
}

/** Resize to a multiple of 32 within maxSide and normalise to the model's input (CHW float). */
function prepareInput(cv, img, opts) {
  const maxSide = opts.maxSide ?? 960;
  const W = img.width, H = img.height;
  const scale = Math.min(opts.maxScale ?? 1, maxSide / Math.max(W, H));
  const w = Math.max(32, Math.round((W * scale) / 32) * 32), h = Math.max(32, Math.round((H * scale) / 32) * 32);
  const src = cv.matFromImageData(img);
  const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const resized = new cv.Mat(); cv.resize(rgb, resized, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
  // CHW float, normalised (the blob OpenCV's dnn wants is built the same way)
  const blob = cv.blobFromImage(resized, 1 / 255, new cv.Size(w, h), new cv.Scalar(0, 0, 0), false, false);
  const data = blob.data32F, plane = w * h;
  for (let c = 0; c < 3; c++) { const m = MEAN[c], sd = STD[c], o = c * plane; for (let i = 0; i < plane; i++) data[o + i] = (data[o + i] - m) / sd; }
  src.delete(); rgb.delete(); resized.delete();
  // the input is resized to multiples of 32, so each axis has its own scale (up to a
  // few percent apart): mapping boxes back with one factor would shift them
  return { data, blob, w, h, W, H, sx: w / W, sy: h / H };
}

function forwardDnn(cv, det, inp) {
  const { w, h } = inp;
  // OpenCV's dnn keeps the shapes of the first forward; a new input size needs a fresh net.
  const key = w * 100000 + h;
  if (det.inputSize !== null && det.inputSize !== key) { det.net.delete(); det.net = loadDnn(cv, det.bytes).net; }
  det.inputSize = key;
  det.net.setInput(inp.blob);
  const out = det.net.forward();
  const prob = new Float32Array(out.data32F.subarray(0, w * h));
  out.delete();
  return prob;
}

/** DB post-processing: threshold, components, box score, unclip, back to image pixels. */
function decodeOutput(cv, probData, inp, opts) {
  const thr = opts.threshold ?? opts.thresh ?? DEFAULT_POST.thresh, unclip = opts.unclip ?? DEFAULT_POST.unclip, boxThresh = opts.boxThresh ?? DEFAULT_POST.boxThresh;
  const { w, h, W, H, sx, sy } = inp;
  const prob = new cv.Mat(h, w, cv.CV_32F); prob.data32F.set(probData.subarray(0, w * h));
  const bin = new cv.Mat(); cv.threshold(prob, bin, thr, 255, cv.THRESH_BINARY);
  const bin8 = new cv.Mat(); bin.convertTo(bin8, cv.CV_8U);
  const labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat();
  const n = cv.connectedComponentsWithStats(bin8, labels, stats, cents, 8, cv.CV_32S);
  const S = stats.data32S, P = prob.data32F, L = labels.data32S;
  const lines = [];
  for (let i = 1; i < n; i++) {
    const x = S[i * 5], y = S[i * 5 + 1], bw = S[i * 5 + 2], bh = S[i * 5 + 3], a = S[i * 5 + 4];
    if (a < 12 || bw < 3 || bh < 3) continue;
    // mean probability inside the component (DB's box score)
    let sum = 0; for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) { const p = yy * w + xx; if (L[p] === i) sum += P[p]; }
    const score = sum / a;
    if (score < boxThresh) continue;
    // DB predicts a shrunk text region; grow it back (Vatti unclip approximated on the box)
    const dist = (a * unclip) / (2 * (bw + bh));
    const ex = Math.max(1, dist), ey = Math.max(1, dist);
    const X = (x - ex) / sx, Y = (y - ey) / sy, Wd = (bw + 2 * ex) / sx, Hd = (bh + 2 * ey) / sy;
    const bx = Math.max(0, Math.round(X)), by = Math.max(0, Math.round(Y));
    lines.push({ x: bx, y: by, w: Math.min(W - bx, Math.round(X + Wd) - bx), h: Math.min(H - by, Math.round(Y + Hd) - by), score, vertical: bh > 1.5 * bw });
  }
  prob.delete(); bin.delete(); bin8.delete(); labels.delete(); stats.delete(); cents.delete();
  return lines;
}

/**
 * @typedef {{maxSide:number, thresh:number, boxThresh:number, unclip:number}} Post
 * @typedef {{kind:"ort", ort:object, session:object, bytes:Uint8Array, cv:object, post:Post} | {kind:"dnn", net:any, inputSize:(number|null), bytes:Uint8Array, cv:object, post:Post}} Detector
 * @typedef {{x:number,y:number,w:number,h:number,score:number,vertical:boolean}} Line
 */
