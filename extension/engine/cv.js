// Single shared OpenCV.js instance for whichever worker imports this module
// (extension service worker, the web app's Web Worker, or Node in tests).
import loadOpenCV from "../vendor/opencv.js";
import { loadDetector } from "./detect.js"; // static: MV3 service workers do not support dynamic import()
import { getOrt } from "./ort.js";
import { loadSegmenter } from "./segment.js";

let ready = null;

/**
 * Resolves to the initialised `cv` namespace. Loads once; later calls are free.
 * @param {object} [overrides] Emscripten Module fields (tests pass `wasmBinary`).
 */
export function getCV(overrides = {}) {
  if (!ready) {
    ready = new Promise((resolve, reject) => {
      const Module = {
        locateFile: (file) => new URL("../vendor/" + file, import.meta.url).href,
        onRuntimeInitialized() { delete cv.then; resolve(cv); }, // the module object is a thenable; Promises would loop on it
        onAbort: (why) => reject(new Error("OpenCV failed to start: " + why)),
        print: () => {},
        printErr: (s) => console.warn("OpenCV:", s),
        ...overrides,
      };
      const cv = loadOpenCV(Module);
    });
  }
  return ready;
}

let detectorReady = null;
/**
 * Resolves to the learned text detector (engine/detect.js), loaded once from
 * vendor/ppocr-det.onnx next to this module. Resolves to null if the model
 * cannot be fetched or parsed, in which case analysis falls back to heuristics.
 * @param {object} [overrides] tests pass `modelBytes`
 */
export function getDetector(overrides = {}) {
  if (!detectorReady) {
    detectorReady = (async () => {
      try {
        const cv = await getCV();
        const bytes = overrides.modelBytes || new Uint8Array(await (await fetch(new URL("../vendor/ppocr-det.onnx", import.meta.url))).arrayBuffer());
        return loadDetector(cv, bytes);
      } catch (e) { console.warn("Gytakusub: text detector unavailable, using heuristics", e); return null; }
    })();
  }
  return detectorReady;
}

let segmenterReady = null;
/**
 * Resolves to the learned bubble segmenter (engine/segment.js) — the model file
 * vendor/segment.onnx and its description vendor/segment.json next to this module
 * — loaded once by ONNX Runtime. Resolves to null when there is no model (the
 * analysis then decides bubbles from pixel statistics) or when it fails to load.
 * @param {object} [overrides] tests pass `modelBytes`, `config`, `wasmBinary`
 */
export function getSegmenter(overrides = {}) {
  if (!segmenterReady) {
    segmenterReady = (async () => {
      try {
        let bytes = overrides.modelBytes, config = overrides.config;
        if (!bytes) {
          const res = await fetch(new URL("../vendor/segment.onnx", import.meta.url));
          if (!res.ok) return null;
          bytes = new Uint8Array(await res.arrayBuffer());
        }
        if (!config) {
          const res = await fetch(new URL("../vendor/segment.json", import.meta.url)).catch(() => null);
          config = res && res.ok ? await res.json() : {};
        }
        const ort = getOrt(overrides.wasmBinary ? { wasmBinary: overrides.wasmBinary } : {});
        return await loadSegmenter(ort, bytes, config);
      } catch (e) { console.warn("Gytakusub: bubble segmenter unavailable, deciding bubbles from pixels", e); return null; }
    })();
  }
  return segmenterReady;
}
