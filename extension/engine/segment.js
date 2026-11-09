// Learned page layout: a YOLO instance-segmentation model (Ultralytics export,
// run by ONNX Runtime) returns the speech bubbles — and, with a multi-class
// model, text and sound-effect lines — as scored boxes with pixel masks. The
// page analysis uses the masks as bubble interiors instead of deciding from
// pixel statistics what a bubble is.
//
// Two export layouts are understood:
//   - YOLOv8-seg: output0 [1, 4+nc+32, N] (cx, cy, w, h, class scores, 32 mask
//     coefficients per anchor; needs NMS), output1 [1, 32, mh, mw] prototypes
//   - end-to-end (YOLO26 / `nms=True` exports): output0 [1, N, 6+32] rows of
//     x1, y1, x2, y2, score, class, 32 coefficients, already de-duplicated
// Coordinates are those of the letterboxed model input; results are mapped
// back to the pixels of the image given.

const sigmoid = (v) => 1 / (1 + Math.exp(-v));

/**
 * @typedef {object} Segmenter
 * @property {object} session ONNX Runtime InferenceSession
 * @property {string} inputName
 * @property {number} inputSize square model input (pixels)
 * @property {string[]} classes class names in model order
 * @property {Set<number>} bubbleClasses class ids that are speech/thought bubbles
 * @property {Set<number>} textClasses class ids that are text lines (optional)
 * @property {number} conf score threshold
 * @property {number} iou NMS threshold (YOLOv8 layout only)
 * @property {number} maskThreshold
 */

/**
 * @param {typeof import("../vendor/ort/ort.bundle.js")} ort
 * @param {Uint8Array} bytes the .onnx model
 * @param {Partial<Segmenter> & {inputSize?: number}} [cfg]
 * @returns {Promise<Segmenter>}
 */
export async function loadSegmenter(ort, bytes, cfg = {}) {
  const ep = (cfg.executionProviders || ["wasm"])[0];
  const session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: "all" });
  const inputName = session.inputNames[0];
  // a static input shape wins over the configured size
  const meta = session.inputMetadata?.[inputName] || session.inputMetadata?.[0];
  const dims = meta?.dimensions || meta?.shape;
  const staticSize = Array.isArray(dims) && typeof dims[2] === "number" && dims[2] > 0 ? dims[2] : null;
  const classes = cfg.classes || ["bubble"];
  return {
    session, inputName, inputSize: staticSize || cfg.inputSize || 640, classes,
    bubbleClasses: new Set(cfg.bubbleClasses || classes.map((c, i) => (/bubble|balloon/i.test(c) ? i : -1)).filter((i) => i >= 0)),
    textClasses: new Set(cfg.textClasses || classes.map((c, i) => (/text/i.test(c) && !/onomatop|sfx|sound/i.test(c) ? i : -1)).filter((i) => i >= 0)),
    conf: cfg.conf ?? 0.25, iou: cfg.iou ?? 0.45, maskThreshold: cfg.maskThreshold ?? 0.5, ort, ep,
  };
}

/**
 * Letterbox an image into a square float tensor (RGB, 0..1, grey 114 padding).
 * @returns {{data: Float32Array, size: number, r: number, dx: number, dy: number}}
 */
export function letterbox(img, size) {
  const { width: W, height: H, data: px } = img;
  const r = Math.min(size / W, size / H);
  const nw = Math.max(1, Math.round(W * r)), nh = Math.max(1, Math.round(H * r));
  const dx = Math.floor((size - nw) / 2), dy = Math.floor((size - nh) / 2);
  const plane = size * size, out = new Float32Array(3 * plane).fill(114 / 255);
  // bilinear resample of the source into the nw×nh window
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(H - 1, (y + 0.5) / r - 0.5), y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(H - 1, y0 + 1), fy = Math.max(0, sy - y0);
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(W - 1, (x + 0.5) / r - 0.5), x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(W - 1, x0 + 1), fx = Math.max(0, sx - x0);
      const p00 = (y0 * W + x0) * 4, p01 = (y0 * W + x1) * 4, p10 = (y1 * W + x0) * 4, p11 = (y1 * W + x1) * 4;
      const o = (dy + y) * size + dx + x;
      for (let c = 0; c < 3; c++) {
        const top = px[p00 + c] * (1 - fx) + px[p01 + c] * fx, bot = px[p10 + c] * (1 - fx) + px[p11 + c] * fx;
        out[c * plane + o] = (top * (1 - fy) + bot * fy) / 255;
      }
    }
  }
  return { data: out, size, r, dx, dy };
}

/**
 * Runs the model on an image.
 * @param {Segmenter} seg
 * @param {ImageData} img
 * @returns {Promise<{instances: Instance[], ms: number}>}
 */
export async function segment(seg, img) {
  const t0 = Date.now();
  const lb = letterbox(img, seg.inputSize);
  const input = new seg.ort.Tensor("float32", lb.data, [1, 3, lb.size, lb.size]);
  const out = await seg.session.run({ [seg.inputName]: input });
  const tensors = seg.session.outputNames.map((n) => out[n]);
  // the prototype tensor is the 4-D one; the detections the other
  const protos = tensors.find((t) => t.dims.length === 4), dets = tensors.find((t) => t !== protos);
  if (!dets) throw new Error("segmenter: no detection output");
  const cands = decode(dets, seg);
  const kept = cands[0]?.nms ? nms(cands, seg.iou) : cands;
  const instances = dedupe(kept.map((c) => toInstance(c, protos, lb, img.width, img.height, seg.maskThreshold)).filter(Boolean));
  return { instances, ms: Date.now() - t0 };
}

/**
 * Drops an instance whose mask is mostly (≥ 70%) covered by higher-scored
 * instances: a loose box around a cluster of bubbles that the model also
 * returned one by one (box-IoU NMS does not catch containment).
 */
export function dedupe(instances) {
  const sorted = instances.slice().sort((p, q) => q.score - p.score), kept = [];
  for (const inst of sorted) {
    const { x, y, w, h } = inst.box; let covered = 0, total = 0;
    for (let yy = 0; yy < h; yy += 2) for (let xx = 0; xx < w; xx += 2) {
      if (!inst.mask[yy * w + xx]) continue;
      total++;
      const px = x + xx, py = y + yy;
      if (kept.some((k) => { const lx = px - k.box.x, ly = py - k.box.y; return lx >= 0 && ly >= 0 && lx < k.box.w && ly < k.box.h && k.mask[ly * k.box.w + lx]; })) covered++;
    }
    if (total && covered / total >= 0.7) continue;
    kept.push(inst);
  }
  return kept;
}

/** Candidates in model-input coordinates: {x1,y1,x2,y2,score,cls,coefs,nms}. */
function decode(dets, seg) {
  const d = dets.data, dims = dets.dims, out = [];
  if (dims.length !== 3) throw new Error(`segmenter: unexpected output shape ${dims}`);
  const a = dims[1], b = dims[2];
  if (b === 38 || (a > b && b >= 6 && b - 32 === 6)) {
    // end-to-end rows: x1 y1 x2 y2 score cls coef*32
    for (let i = 0; i < a; i++) {
      const o = i * b, score = d[o + 4];
      if (score < seg.conf) continue;
      out.push({ x1: d[o], y1: d[o + 1], x2: d[o + 2], y2: d[o + 3], score, cls: Math.round(d[o + 5]), coefs: d.subarray(o + 6, o + 6 + 32), nms: false });
    }
    return out;
  }
  // YOLOv8: channels-first [C, N] with C = 4 + nc + 32 (or transposed [N, C])
  const channelsFirst = a < b, C = channelsFirst ? a : b, N = channelsFirst ? b : a, nc = C - 36;
  if (nc < 1) throw new Error(`segmenter: cannot read ${C} channels as YOLOv8-seg`);
  const at = channelsFirst ? (c, i) => d[c * N + i] : (c, i) => d[i * C + c];
  for (let i = 0; i < N; i++) {
    let best = 0, cls = 0;
    for (let k = 0; k < nc; k++) { const v = at(4 + k, i); if (v > best) { best = v; cls = k; } }
    if (best < seg.conf) continue;
    const cx = at(0, i), cy = at(1, i), w = at(2, i), h = at(3, i);
    const coefs = new Float32Array(32); for (let k = 0; k < 32; k++) coefs[k] = at(4 + nc + k, i);
    out.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: best, cls, coefs, nms: true });
  }
  return out;
}

/** Class-agnostic non-maximum suppression. */
export function nms(cands, iouThr) {
  const sorted = cands.slice().sort((p, q) => q.score - p.score), kept = [];
  for (const c of sorted) {
    let drop = false;
    for (const k of kept) {
      const ix = Math.max(0, Math.min(c.x2, k.x2) - Math.max(c.x1, k.x1)), iy = Math.max(0, Math.min(c.y2, k.y2) - Math.max(c.y1, k.y1));
      const inter = ix * iy, uni = (c.x2 - c.x1) * (c.y2 - c.y1) + (k.x2 - k.x1) * (k.y2 - k.y1) - inter;
      if (uni > 0 && inter / uni > iouThr) { drop = true; break; }
    }
    if (!drop) kept.push(c);
  }
  return kept;
}

/**
 * @typedef {object} Instance
 * @property {number} cls
 * @property {number} score
 * @property {{x:number,y:number,w:number,h:number}} box image pixels
 * @property {Uint8Array|null} mask box.w × box.h, 255 inside the instance (null when the model has no mask head)
 */

function toInstance(c, protos, lb, W, H, thr) {
  const toImg = (x, y) => [(x - lb.dx) / lb.r, (y - lb.dy) / lb.r];
  const [ix1, iy1] = toImg(c.x1, c.y1), [ix2, iy2] = toImg(c.x2, c.y2);
  const x = Math.max(0, Math.floor(ix1)), y = Math.max(0, Math.floor(iy1));
  const x2 = Math.min(W, Math.ceil(ix2)), y2 = Math.min(H, Math.ceil(iy2));
  const w = x2 - x, h = y2 - y;
  if (w < 2 || h < 2) return null;
  const box = { x, y, w, h };
  if (!protos) return { cls: c.cls, score: c.score, box, mask: null };
  const [, K, mh, mw] = protos.dims, P = protos.data, plane = mh * mw;
  const sx = mw / lb.size, sy = mh / lb.size;
  // image pixel → prototype grid coordinate (continuous)
  const gxOf = (px) => ((px + 0.5) * lb.r + lb.dx) * sx - 0.5, gyOf = (py) => ((py + 0.5) * lb.r + lb.dy) * sy - 0.5;
  // combine the prototypes once, on the grid cells the box covers (plus a margin)
  const gx0 = Math.max(0, Math.floor(gxOf(x)) - 1), gy0 = Math.max(0, Math.floor(gyOf(y)) - 1);
  const gx1 = Math.min(mw - 1, Math.ceil(gxOf(x + w)) + 1), gy1 = Math.min(mh - 1, Math.ceil(gyOf(y + h)) + 1);
  const cw = gx1 - gx0 + 1, ch = gy1 - gy0 + 1, logit = new Float32Array(cw * ch);
  for (let gy = 0; gy < ch; gy++) for (let gx = 0; gx < cw; gx++) {
    const q = (gy0 + gy) * mw + gx0 + gx; let v = 0;
    for (let k = 0; k < K; k++) v += c.coefs[k] * P[k * plane + q];
    logit[gy * cw + gx] = v;
  }
  // then sample it bilinearly for every pixel of the box
  const mask = new Uint8Array(w * h);
  for (let yy = 0; yy < h; yy++) {
    const gy = Math.min(ch - 1, Math.max(0, gyOf(y + yy) - gy0)), iy0 = Math.floor(gy), iy1 = Math.min(ch - 1, iy0 + 1), fy = gy - iy0;
    for (let xx = 0; xx < w; xx++) {
      const gx = Math.min(cw - 1, Math.max(0, gxOf(x + xx) - gx0)), ix0 = Math.floor(gx), ix1 = Math.min(cw - 1, ix0 + 1), fx = gx - ix0;
      const top = logit[iy0 * cw + ix0] * (1 - fx) + logit[iy0 * cw + ix1] * fx, bot = logit[iy1 * cw + ix0] * (1 - fx) + logit[iy1 * cw + ix1] * fx;
      if (sigmoid(top * (1 - fy) + bot * fy) >= thr) mask[yy * w + xx] = 255;
    }
  }
  return { cls: c.cls, score: c.score, box, mask };
}
