// Single shared OpenCV.js instance for whichever worker imports this module
// (extension service worker, the web app's Web Worker, or Node in tests).
import loadOpenCV from "../vendor/opencv.js";

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
