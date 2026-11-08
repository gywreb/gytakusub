// Single shared OpenCV.js instance for whichever worker imports this module
// (extension service worker, the web app's Web Worker, or Node in tests).
import loadOpenCV from "../vendor/opencv.js";
import { loadDetector } from "./detect.js"; // static: MV3 service workers do not support dynamic import()

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
