// Learned text detection: PaddleOCR PP-OCRv4 detector (DBNet, Apache-2.0),
// run by OpenCV's dnn module from the bundled ONNX file. Finds every text line
// on a page — Latin or CJK, light or dark, any size — and nothing else, which
// is the step hand-written rules kept getting wrong on real scans.
//
// vendor/ppocr-det.onnx is the official model with its HardSigmoid nodes
// rewritten as Mul/Add/Clip (OpenCV 4.5 lacks that layer); see
// scripts/vendor-detector.mjs.

const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

/**
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {Uint8Array} modelBytes ONNX file contents
 * @returns {{ net: any, inputSize: number|null }}
 */
export function loadDetector(cv, modelBytes) {
  const name = `ppocr-det-${Math.random().toString(36).slice(2)}.onnx`;
  cv.FS_createDataFile("/", name, modelBytes, true, false, false);
  const net = cv.readNetFromONNX(name);
  try { cv.FS_unlink("/" + name); } catch { /* keep */ }
  return { net, inputSize: null, bytes: modelBytes, cv };
}

/**
 * Text lines on the image, in image pixels.
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {{net:any}} det from loadDetector
 * @param {ImageData} img
 * @param {{maxSide?: number, threshold?: number, unclip?: number}} [opts]
 * @returns {Array<{x:number,y:number,w:number,h:number,score:number,vertical:boolean}>}
 */
export function detectText(cv, det, img, opts = {}) {
  const maxSide = opts.maxSide ?? 960, thr = opts.threshold ?? 0.3, unclip = opts.unclip ?? 1.6;
  const W = img.width, H = img.height;
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(32, Math.round((W * scale) / 32) * 32), h = Math.max(32, Math.round((H * scale) / 32) * 32);
  // OpenCV's dnn keeps the shapes of the first forward; a new input size needs a fresh net.
  const key = w * 100000 + h;
  if (det.inputSize !== null && det.inputSize !== key) { det.net.delete(); det.net = loadDetector(cv, det.bytes).net; }
  det.inputSize = key;

  const src = cv.matFromImageData(img);
  const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const resized = new cv.Mat(); cv.resize(rgb, resized, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
  const blob = cv.blobFromImage(resized, 1 / 255, new cv.Size(w, h), new cv.Scalar(0, 0, 0), false, false);
  const d = blob.data32F, plane = w * h;
  for (let c = 0; c < 3; c++) { const m = MEAN[c], s = STD[c], o = c * plane; for (let i = 0; i < plane; i++) d[o + i] = (d[o + i] - m) / s; }
  det.net.setInput(blob);
  const out = det.net.forward();
  const prob = new cv.Mat(h, w, cv.CV_32F); prob.data32F.set(out.data32F.subarray(0, plane));
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
    if (score < 0.5) continue;
    // DB predicts a shrunk text region; grow it back (Vatti unclip approximated on the box)
    const dist = (a * unclip) / (2 * (bw + bh));
    const ex = Math.max(1, dist), ey = Math.max(1, dist);
    const X = (x - ex) / scale, Y = (y - ey) / scale, Wd = (bw + 2 * ex) / scale, Hd = (bh + 2 * ey) / scale;
    const bx = Math.max(0, Math.round(X)), by = Math.max(0, Math.round(Y));
    lines.push({ x: bx, y: by, w: Math.min(W - bx, Math.round(X + Wd) - bx), h: Math.min(H - by, Math.round(Y + Hd) - by), score, vertical: bh > 1.5 * bw });
  }
  src.delete(); rgb.delete(); resized.delete(); blob.delete(); out.delete(); prob.delete(); bin.delete(); bin8.delete(); labels.delete(); stats.delete(); cents.delete();
  return lines;
}
