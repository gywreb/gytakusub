// ONNX Runtime Web, loaded once per worker: the WebGPU build, which carries
// both execution providers — "webgpu" (the GPU, through the browser's WebGPU
// API) and "wasm" (the CPU, single-threaded SIMD). Models run on the GPU when
// the browser offers an adapter and the user has not turned it off, and fall
// back to the CPU otherwise or if the GPU session fails to start.
//
// The single-file bundle is used because a module service worker cannot use
// dynamic import(); its wasm is fetched from the vendored copy next to this
// module (or supplied by a host without fetch for files, such as the Node tests).
import * as ort from "../vendor/ort/ort.bundle.js";

const WASM = "ort-wasm-simd-threaded.asyncify.wasm";
let configured = false, gpuProbe = null;

/**
 * @param {{wasmPaths?: string, wasmBinary?: ArrayBuffer, numThreads?: number}} [opts] wasmBinary: the runtime's wasm bytes, for hosts without fetch for files (Node)
 * @returns {typeof ort}
 */
export function getOrt(opts = {}) {
  if (!configured) {
    // Threads need SharedArrayBuffer (cross-origin isolation), which an
    // extension service worker does not have; one thread, SIMD.
    ort.env.wasm.numThreads = opts.numThreads ?? 1;
    // Only the wasm is fetched; the JS glue is inside the bundle (a string prefix
    // here would make ORT import() a separate loader, which a service worker cannot).
    const dir = opts.wasmPaths ?? new URL("../vendor/ort/", import.meta.url).href;
    ort.env.wasm.wasmPaths = { wasm: dir + WASM };
    if (opts.wasmBinary) ort.env.wasm.wasmBinary = opts.wasmBinary;
    ort.env.webgpu.powerPreference = "high-performance";
    ort.env.logLevel = "error";
    configured = true;
  }
  return ort;
}

/** Whether this context can run models on a GPU (WebGPU with an adapter). Probed once. */
export function gpuAvailable() {
  if (!gpuProbe) gpuProbe = (async () => {
    try {
      const gpu = globalThis.navigator?.gpu;
      return !!(gpu && await gpu.requestAdapter({ powerPreference: "high-performance" }));
    } catch { return false; }
  })();
  return gpuProbe;
}

/**
 * Loads a model for inference, on the GPU when asked and available, else the CPU.
 * @param {Uint8Array} bytes the .onnx file
 * @param {{gpu?: boolean} & object} [opts] gpu: try WebGPU first; the rest are getOrt options
 * @returns {Promise<{session: object, ep: "webgpu"|"wasm"}>}
 */
export async function createSession(bytes, opts = {}) {
  const o = getOrt(opts);
  if (opts.gpu && await gpuAvailable()) {
    try { return { session: await o.InferenceSession.create(bytes, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }), ep: "webgpu" }; }
    catch (e) { console.warn("Gytakusub: GPU session failed, using the CPU", e); }
  }
  return { session: await o.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }), ep: "wasm" };
}
