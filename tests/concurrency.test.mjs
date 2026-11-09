// Several pages analysed at once, as auto-translate does while scrolling: the
// service worker starts a page while the previous one is still inside a model.
// Both models share one ONNX Runtime WebAssembly instance; on the WebGPU build
// a call that suspends (asyncify) while another enters the same instance
// corrupts its memory ("memory access out of bounds"). Every model call must
// therefore be serialised — this test runs pages concurrently and requires the
// same results as one at a time, on the GPU when one is available (Dawn, as in
// gpu.test.mjs) and on the CPU.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let gpu = null;
if (!process.env.GYT_NO_GPU) try {
  const { create, globals } = await import("webgpu"); // before node-canvas (libstdc++, see gpu.test.mjs)
  Object.assign(globalThis, globals);
  gpu = create([]);
  Object.defineProperty(globalThis.navigator, "gpu", { value: gpu, configurable: true });
} catch { /* CPU only */ }
const hasGpu = !!(gpu && await gpu.requestAdapter().catch(() => null));

const { createCanvas, loadImage } = await import("canvas");
const { cv } = await import("./cv-node.mjs");
const { getOrt } = await import("../extension/engine/ort.js");
const { loadDetector, detectText } = await import("../extension/engine/detect.js");
const { loadSegmenter, segment } = await import("../extension/engine/segment.js");

const vendor = (f) => path.join(here, "../extension/vendor", f);
const wasmBinary = fs.readFileSync(vendor("ort/ort-wasm-simd-threaded.asyncify.wasm")).buffer;
const ort = getOrt({ wasmBinary });
const config = JSON.parse(fs.readFileSync(vendor("segment.json"), "utf8"));
const pages = [];
for (const f of ["demo-page.png", "gen-00.png", "gen-01.png"]) {
  const img = await loadImage(path.join(here, "fixtures", f));
  const s = Math.min(1, 1600 / Math.max(img.width, img.height)), W = Math.round(img.width * s), H = Math.round(img.height * s);
  const c = createCanvas(W, H); c.getContext("2d").drawImage(img, 0, 0, W, H);
  pages.push(c.getContext("2d").getImageData(0, 0, W, H));
}

let passed = 0;
for (const backend of hasGpu ? ["webgpu", "wasm"] : ["wasm"]) {
  const det = await loadDetector(cv, new Uint8Array(fs.readFileSync(vendor("ppocr-det.onnx"))), { ort, gpu: backend === "webgpu", wasmBinary });
  const seg = await loadSegmenter(ort, new Uint8Array(fs.readFileSync(vendor(backend === "webgpu" ? "segment-gpu.onnx" : "segment.onnx"))), { ...config, executionProviders: [backend] });
  assert.equal(det.ep, backend); assert.equal(seg.ep, backend);
  const one = async (px) => { const lines = await detectText(cv, det, px); const { instances } = await segment(seg, px); return { lines: lines.length, bubbles: instances.length }; };
  const sequential = []; for (const px of pages) sequential.push(await one(px));
  for (let round = 0; round < (backend === "webgpu" ? 1 : 3); round++) {
    const concurrent = await Promise.all(pages.map(one));
    assert.deepEqual(concurrent, sequential, `[${backend}] round ${round}: concurrent results differ from sequential`);
  }
  passed++; console.log(`ok - [${backend}] ${pages.length} pages at once, same lines and bubbles as one at a time`);
}
console.log(`CONCURRENCY TESTS PASSED (${passed})`);
process.exit(0);
