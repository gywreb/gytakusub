// Single shared OpenCV.js instance for whichever worker imports this module
// (extension service worker, the web app's Web Worker, or Node in tests).
import loadOpenCV from "../vendor/opencv.js";
import { loadDetector } from "./detect.js"; // static: MV3 service workers do not support dynamic import()
import { getOrt, gpuAvailable, gpuIsSoftware, ortBroken, createSession, run } from "./ort.js";
import { LAMA_SIDE } from "./inpaint.js";
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

// Engine preferences that change which models load: `gpu` (run on WebGPU when
// available), `lama` (the app ships the LaMa inpainter: the extension, ADR 0015). A
// change drops the loaded models so the next page loads them again.
const prefs = { gpu: true, lama: false };
export function setEnginePrefs(next = {}) {
  const gpu = next.gpu !== false, lama = next.lama ?? prefs.lama;
  if (gpu !== prefs.gpu) { prefs.gpu = gpu; detectorReady = null; segmenterReady = null; inpainterReady = null; }
  if (lama !== prefs.lama) { prefs.lama = lama; inpainterReady = null; }
}

let detectorReady = null;
/**
 * Resolves to the learned text detector (engine/detect.js), loaded once from
 * vendor/ppocr-det.onnx next to this module. Resolves to null if the model
 * cannot be fetched or parsed, in which case analysis falls back to heuristics.
 * @param {object} [overrides] tests pass `modelBytes`
 */
export function getDetector(overrides = {}) {
  if (ortBroken()) return getFallbackDetector();
  if (!detectorReady) {
    detectorReady = (async () => {
      let cv, bytes, post;
      try {
        cv = await getCV();
        bytes = overrides.modelBytes || new Uint8Array(await (await fetch(new URL("../vendor/ppocr-det.onnx", import.meta.url))).arrayBuffer());
        post = overrides.post || await detectorPost();
      } catch (e) { console.warn("Gytakusub: text detector unavailable, using heuristics", e); return null; }
      // ONNX Runtime first (about four times faster than OpenCV's dnn on wasm); dnn if it will not start
      try { return await loadDetector(cv, bytes, { ort: getOrt(overrides.wasmBinary ? { wasmBinary: overrides.wasmBinary } : {}), gpu: overrides.gpu ?? prefs.gpu, wasmBinary: overrides.wasmBinary, post }); }
      catch (e) { console.warn("Gytakusub: ONNX Runtime unavailable for the text detector, using OpenCV dnn", e); }
      try { return await loadDetector(cv, bytes, { post }); }
      catch (e) { console.warn("Gytakusub: text detector unavailable, using heuristics", e); return null; }
    })();
  }
  return detectorReady;
}

/** The detector's post-processing as vendor/ppocr-det.json records it (undefined: the engine's defaults). */
async function detectorPost() {
  const res = await fetch(new URL("../vendor/ppocr-det.json", import.meta.url)).catch(() => null);
  return res && res.ok ? (await res.json().catch(() => ({}))).post : undefined;
}

let fallbackReady = null;
/** The text detector on OpenCV's dnn, for when ONNX Runtime has failed (engine/ort.js ortBroken()). */
export function getFallbackDetector() {
  if (!fallbackReady) fallbackReady = (async () => {
    try {
      const cv = await getCV();
      const bytes = new Uint8Array(await (await fetch(new URL("../vendor/ppocr-det.onnx", import.meta.url))).arrayBuffer());
      return await loadDetector(cv, bytes, { post: await detectorPost() });
    } catch (e) { console.warn("Gytakusub: text detector unavailable, using heuristics", e); return null; }
  })();
  return fallbackReady;
}

let segmenterReady = null;
/**
 * Resolves to the learned bubble segmenter (engine/segment.js), loaded once by
 * ONNX Runtime from the files next to this module: vendor/segment.json (its
 * description) and one of two variants of the model — vendor/segment-gpu.onnx
 * (weight-only int8, float compute) on WebGPU when available, vendor/segment.onnx
 * (int8 QDQ, integer kernels) on the CPU otherwise. Resolves to null when there
 * is no model (the analysis then decides bubbles from pixel statistics) or when
 * it fails to load.
 * @param {object} [overrides] tests pass `modelBytes` / `gpuModelBytes`, `config`, `wasmBinary`, `gpu`
 */
export function getSegmenter(overrides = {}) {
  if (ortBroken()) return Promise.resolve(null);
  if (!segmenterReady) {
    segmenterReady = (async () => {
      const read = async (name) => { const res = await fetch(new URL("../vendor/" + name, import.meta.url)).catch(() => null); return res && res.ok ? new Uint8Array(await res.arrayBuffer()) : null; };
      try {
        let config = overrides.config;
        if (!config) {
          const res = await fetch(new URL("../vendor/segment.json", import.meta.url)).catch(() => null);
          config = res && res.ok ? await res.json() : {};
        }
        const ort = getOrt(overrides.wasmBinary ? { wasmBinary: overrides.wasmBinary } : {});
        const wantGpu = (overrides.gpu ?? prefs.gpu) && (overrides.gpuModelBytes || config.gpu) && await gpuAvailable();
        if (wantGpu) {
          try {
            const bytes = overrides.gpuModelBytes || await read("segment-gpu.onnx");
            if (bytes) return await loadSegmenter(ort, bytes, { ...config, executionProviders: ["webgpu"] });
          } catch (e) { console.warn("Gytakusub: bubble segmenter could not start on the GPU, using the CPU", e); }
        }
        const bytes = overrides.modelBytes || await read("segment.onnx");
        return bytes ? await loadSegmenter(ort, bytes, { ...config, executionProviders: ["wasm"] }) : null;
      } catch (e) { console.warn("Gytakusub: bubble segmenter unavailable, deciding bubbles from pixels", e); return null; }
    })();
  }
  return segmenterReady;
}

let inpainterReady = null;
/**
 * Resolves to the learned inpainter (engine/inpaint.js). On a graphics card, where the app ships
 * it (`lama`), LaMa finetuned on manga (vendor/lama.onnx): it continues screentone that AOT
 * leaves as a blurred ghost of the letters (ADR 0015). Otherwise AOT-GAN (vendor/inpaint.onnx),
 * on the GPU when there is one, else the CPU; LaMa is several times AOT's cost, which a GPU
 * emulated on the CPU (test machines) or the CPU itself cannot afford. Null when the files are
 * missing or fail to load (the eraser then fills textured areas with Telea, as before 2.12).
 * @param {object} [overrides] tests pass `modelBytes`, `lamaBytes`, `wasmBinary`, `gpu`, `lama`
 * @returns {Promise<{ort, session, run, ep: "webgpu"|"wasm", kind: "lama"|"aot", side?: number}|null>}
 */
export function getInpainter(overrides = {}) {
  if (ortBroken()) return Promise.resolve(null);
  if (!inpainterReady) inpainterReady = (async () => {
    if ((overrides.lama ?? prefs.lama) && (overrides.gpu ?? prefs.gpu) && await gpuAvailable() && !gpuIsSoftware()) {
      const lama = await loadModel("lama.onnx", { ...overrides, modelBytes: overrides.lamaBytes, strict: true });
      if (lama) return { ...lama, kind: "lama", side: LAMA_SIDE };
    }
    const aot = await loadModel("inpaint.onnx", overrides);
    return aot && { ...aot, kind: "aot" };
  })();
  return inpainterReady;
}

/**
 * The learned inpainter's one input size when it is LaMa (it then sees that much of the page around
 * each area, inpaint.js), else 0: decided as getInpainter() decides, without loading anything.
 */
export async function inpainterSide() {
  if (inpainterReady) { const m = await inpainterReady; return m?.side || 0; }
  return prefs.lama && prefs.gpu && !ortBroken() && await gpuAvailable() && !gpuIsSoftware() ? LAMA_SIDE : 0;
}

/** A vendored model on the GPU when there is one (else the CPU, unless `strict`); null when missing or broken. */
async function loadModel(file, overrides) {
  try {
    const gpu = (overrides.gpu ?? prefs.gpu) && await gpuAvailable();
    let bytes = overrides.modelBytes;
    if (!bytes) {
      const res = await fetch(new URL("../vendor/" + file, import.meta.url)).catch(() => null);
      if (!res || !res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    const ort = getOrt(overrides.wasmBinary ? { wasmBinary: overrides.wasmBinary } : {});
    const { session, ep } = await createSession(bytes, { gpu, strict: !!overrides.strict });
    return { ort, session, run, ep };
  } catch (e) { console.warn(`Gytakusub: ${file} unavailable`, e); return null; }
}
