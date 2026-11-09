// Loads the vendored OpenCV.js in Node for tests (same files the extension ships).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
// Emscripten's Node branch expects CommonJS globals.
globalThis.__dirname ??= here;
globalThis.require ??= createRequire(import.meta.url);
import { ImageData } from "canvas";
globalThis.ImageData ??= ImageData; // engine/erase.js constructs ImageData like a browser would
const { getCV, getDetector, getSegmenter } = await import("../extension/engine/cv.js");
const { analyze } = await import("../extension/engine/analyze.js");
const { segment } = await import("../extension/engine/segment.js");
const { detectText, detectInEmptyBubbles, detectInDarkShapes } = await import("../extension/engine/detect.js");
export const cv = await getCV({ wasmBinary: fs.readFileSync(path.join(here, "../extension/vendor/opencv_js.wasm")) });
// Emscripten's Node branch installs process-wide handlers that turn any unhandled
// rejection into a wasm abort (exit code 7, source dump) — masking the real error.
process.removeAllListeners("unhandledRejection");
process.removeAllListeners("uncaughtException");

// The learned text detector, from the vendored model file (fetch() cannot read files in Node).
// GYT_DETECTOR=dnn runs the text detector on OpenCV's dnn instead of ONNX Runtime (the fallback path).
const ortWasm = fs.readFileSync(path.join(here, "../extension/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm")).buffer;
// GYT_DETECTOR_MODEL: another text-detector file to evaluate (same DB output), GYT_DETECTOR_POST its
// post-processing as JSON ({"thresh":..,"boxThresh":..,"unclip":..}).
const detBytes = new Uint8Array(fs.readFileSync(process.env.GYT_DETECTOR_MODEL || path.join(here, "../extension/vendor/ppocr-det.onnx")));
const detPost = process.env.GYT_DETECTOR_POST ? JSON.parse(process.env.GYT_DETECTOR_POST) : undefined;
export const detector = process.env.GYT_DETECTOR === "dnn"
  ? await (await import("../extension/engine/detect.js")).loadDetector(cv, detBytes, { post: detPost })
  : await getDetector({ modelBytes: detBytes, wasmBinary: ortWasm, post: detPost });
console.error(`[cv-node] text detector on ${detector.kind}`);

// The learned bubble segmenter, when a model is available: extension/vendor/segment.onnx
// (+ segment.json) as shipped, or the file named by GYT_SEGMENT (a model under
// evaluation, with GYT_SEGMENT_CONFIG for its description). null otherwise.
const segPath = process.env.GYT_SEGMENT || path.join(here, "../extension/vendor/segment.onnx");
export const segmenter = fs.existsSync(segPath)
  ? await getSegmenter({
    modelBytes: new Uint8Array(fs.readFileSync(segPath)),
    config: (() => { const c = process.env.GYT_SEGMENT_CONFIG || segPath.replace(/\.onnx$/, ".json"); return fs.existsSync(c) ? JSON.parse(fs.readFileSync(c, "utf8")) : {}; })(),
    wasmBinary: ortWasm,
  })
  : null;
if (segmenter) console.error(`[cv-node] bubble segmenter: ${path.basename(segPath)} (input ${segmenter.inputSize}, classes ${segmenter.classes.join("/")})`);

/** Full analysis as the extension runs it: segmentation (if a model is loaded) + text detection + geometry. */
export async function analyzePage(img, opts = {}) {
  const det = detector;
  const t0 = Date.now();
  let lines = det ? await detectText(cv, det, img) : null;
  if (lines) lines = await detectInDarkShapes(cv, det, img, lines);
  const seg = segmenter ? await segment(segmenter, img) : null;
  if (lines && seg) lines = await detectInEmptyBubbles(cv, det, img, lines, seg.instances, segmenter.bubbleClasses);
  const detectMs = Date.now() - t0 - (seg ? seg.ms : 0);
  const an = analyze(cv, img, { detector: det, lines, instances: seg ? seg.instances : null, bubbleClasses: segmenter?.bubbleClasses, ...opts });
  an.segmentMs = seg ? seg.ms : 0; an.detectMs = detectMs;
  return an;
}
