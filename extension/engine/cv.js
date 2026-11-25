// Single shared OpenCV.js instance for whichever worker imports this module
// (extension service worker, the web app's Web Worker, or Node in tests).
import loadOpenCV from "../vendor/opencv.js";
import { loadDetector } from "./detect.js"; // static: MV3 service workers do not support dynamic import()
import { getOrt, gpuAvailable, gpuIsSoftware, ortBroken, createSession, run } from "./ort.js";
import { LAMA_SIDE } from "./inpaint.js";
import { loadSegmenter } from "./segment.js";
import { textMasker } from "./textmask.js";

let ready = null, loaded = null, cvOverrides = {};
// The most memory OpenCV can have: the vendored build's maximum (vendor/opencv.js; a test holds
// the two the same). It never gives any back, and a failure at this size is most likely the
// memory running out.
export const OPENCV_MAX = 1024 * 1048576;

/**
 * Resolves to the initialised `cv` namespace. Loads once; later calls are free — until OpenCV runs
 * out of memory (engineError), when the next call starts a fresh one.
 * @param {object} [overrides] Emscripten Module fields (tests pass `wasmBinary`; kept for a fresh start).
 */
export function getCV(overrides = cvOverrides) {
  if (!ready) {
    cvOverrides = overrides;
    ready = new Promise((resolve, reject) => {
      const Module = {
        locateFile: (file) => new URL("../vendor/" + file, import.meta.url).href,
        onRuntimeInitialized() { delete cv.then; loaded = cv; resolve(cv); }, // the module object is a thenable; Promises would loop on it
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

/**
 * What the engine threw, as an Error. OpenCV throws its C++ exceptions as a bare number (where the
 * exception sits in its memory), and a report then said "Gytakusub Error: 6686152" and nothing
 * more. The message names OpenCV and how large its memory had grown: it stops at 1 GiB, and a
 * failure at that size is most likely the memory running out.
 */
export function engineError(e) {
  if (typeof e !== "number") return e;
  const mb = loaded ? Math.round(loaded.HEAPU8.length / 1048576) : null;
  // Out of memory: every page after would fail the same way, so the next page starts a fresh
  // OpenCV. A page under way keeps the one it began with (its objects live there: job.cv), and that
  // one is let go of once no page holds it. Nothing should bring this about (tests/memory.test.mjs,
  // tests/fail-paths.test.mjs: a page leaves nothing behind); this is for whatever still does.
  const full = loaded && loaded.HEAPU8.length >= OPENCV_MAX;
  if (full) { ready = null; loaded = null; fallbackReady = null; } // (the fallback text detector is made in OpenCV)
  return Object.assign(new Error(`Gytakusub: OpenCV failed (exception ${e}${mb ? `; its memory at ${mb} MB` : ""}${full ? ", all it can have: the next page starts afresh" : ""})`), { code: "opencv" });
}

// Engine preferences that change which models load: `gpu` (run on WebGPU when
// available), `lama` (LaMa on a graphics card, ADR 0015: the extension, and the web app unless it
// ran out of memory on it before). A change drops the loaded models so the next page loads them again.
const prefs = { gpu: true, lama: false };
// told when LaMa starts loading ("loading") and once it has filled at full size ("ok"; page.js
// warmInpainter): the web app keeps a phone that ran out of memory on it to AOT afterwards
let lamaEvents = null;
export function onLama(fn) { lamaEvents = fn; }
export function lamaEvent(state) { try { lamaEvents?.(state); } catch {} }
export function setEnginePrefs(next = {}) {
  const gpu = next.gpu !== false, lama = next.lama ?? prefs.lama;
  if (gpu !== prefs.gpu) { prefs.gpu = gpu; detectorReady = null; segmenterReady = null; inpainterReady = null; textMaskerReady = null; }
  if (lama !== prefs.lama) { prefs.lama = lama; inpainterReady = null; }
}

let textMaskerReady = null;
/**
 * Resolves to the learned text mask (engine/textmask.js: vendor/textmask.onnx and its record
 * vendor/textmask.json), loaded the first time a page asks for it: on WebGPU when available, else on
 * the CPU. Null when the file is missing or fails to load (the eraser then finds lettering by its
 * rules, as before 3.2).
 * @param {object} [overrides] tests pass `modelBytes`, `wasmBinary`, `gpu`
 */
export function getTextMasker(overrides = {}) {
  if (ortBroken()) return Promise.resolve(null);
  if (!textMaskerReady) textMaskerReady = (async () => {
    const res = await fetch(new URL("../vendor/textmask.json", import.meta.url)).catch(() => null);
    const info = res && res.ok ? await res.json().catch(() => ({})) : {};
    const m = await loadModel("textmask.onnx", overrides);
    return m && textMasker(m.session, { ep: m.ep, threshold: info.threshold });
  })();
  return textMaskerReady;
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
 * Resolves to the learned bubble segmenter (engine/segment.js), loaded once by ONNX Runtime from
 * the files next to this module: vendor/segment.json (its description) and vendor/segment.onnx,
 * one model for both backends (weight-only int8, float compute): on WebGPU when available, else
 * on the CPU. Until 3.0 the CPU had a model of its own (int8 activations, faster there), and the
 * two drew bubbles a few pixels apart: the same page came out differently on a graphics card than
 * on the CPU, and a report replayed on the CPU did not reproduce the page (ADR 0020). Resolves to
 * null when there is no model (the analysis then decides bubbles from pixel statistics) or when
 * it fails to load.
 * @param {object} [overrides] tests pass `modelBytes`, `config`, `wasmBinary`, `gpu`
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
        const bytes = overrides.modelBytes || await read("segment.onnx");
        if (!bytes) return null;
        if ((overrides.gpu ?? prefs.gpu) && await gpuAvailable()) {
          try { return await loadSegmenter(ort, bytes, { ...config, executionProviders: ["webgpu"] }); }
          catch (e) { console.warn("Gytakusub: bubble segmenter could not start on the GPU, using the CPU", e); }
        }
        return await loadSegmenter(ort, bytes, { ...config, executionProviders: ["wasm"] });
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
      // marked once downloaded, as the session is made: a download cut short is no sign the device can't run it
      const lama = await loadModel("lama.onnx", { ...overrides, modelBytes: overrides.lamaBytes, strict: true, beforeSession: () => lamaEvent("loading") });
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
    overrides.beforeSession?.();
    const { session, ep } = await createSession(bytes, { gpu, strict: !!overrides.strict });
    return { ort, session, run, ep };
  } catch (e) { console.warn(`Gytakusub: ${file} unavailable`, e); return null; }
}
