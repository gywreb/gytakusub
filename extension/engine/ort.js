// ONNX Runtime Web, loaded once per worker. The single-file bundle is used
// because a module service worker cannot use dynamic import(); the wasm is
// fetched from the vendored copy next to this module (or supplied by a host
// that has no fetch for files, such as the Node tests).
import * as ort from "../vendor/ort/ort.bundle.js";

let configured = false;

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
    ort.env.wasm.wasmPaths = { wasm: dir + "ort-wasm-simd-threaded.wasm" };
    if (opts.wasmBinary) ort.env.wasm.wasmBinary = opts.wasmBinary;
    ort.env.logLevel = "error";
    configured = true;
  }
  return ort;
}

/**
 * Loads a model for inference.
 * @param {Uint8Array} bytes the .onnx file
 * @param {object} [opts] getOrt options
 */
export async function createSession(bytes, opts) {
  const o = getOrt(opts);
  return o.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}
