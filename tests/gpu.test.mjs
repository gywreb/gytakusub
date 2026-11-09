// The GPU path, end to end, against the CPU path: both models (text detector and
// bubble segmenter) run on ONNX Runtime's WebGPU backend and must find the same
// text lines and the same bubbles as on the CPU, on every fixture page.
//
// Node has no WebGPU of its own; the `webgpu` package provides Google's Dawn
// (the implementation inside Chrome), and Mesa's lavapipe gives it a software
// GPU where there is no real one (CI: `apt install mesa-vulkan-drivers`). That
// proves correctness and that every op runs on the GPU, not speed.
//
//   node gpu.test.mjs            skips (exit 0) when no GPU adapter is found
//   GYT_REQUIRE_GPU=1 node ...   fails instead (CI)
//
// Dawn is loaded before anything that loads node-canvas: canvas ships its own,
// older libstdc++, and whichever loads first wins.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let gpu = null;
try {
  const { create, globals } = await import("webgpu");
  Object.assign(globalThis, globals);
  gpu = create([]);
  Object.defineProperty(globalThis.navigator, "gpu", { value: gpu, configurable: true });
} catch (e) { console.log("webgpu (Dawn) not loadable:", e.message); }
const adapter = gpu && await gpu.requestAdapter().catch(() => null);
if (!adapter) {
  const msg = "no WebGPU adapter (install mesa-vulkan-drivers for a software GPU)";
  if (process.env.GYT_REQUIRE_GPU) { console.log("FAIL:", msg); process.exit(1); }
  console.log("SKIP:", msg); process.exit(0);
}
console.log("GPU adapter:", adapter.info?.description || adapter.info?.device || "(unnamed)");

const { createCanvas, loadImage } = await import("canvas");
const { cv } = await import("./cv-node.mjs");
const { getOrt } = await import("../extension/engine/ort.js");
const { loadDetector, detectText } = await import("../extension/engine/detect.js");
const { loadSegmenter, segment } = await import("../extension/engine/segment.js");

const vendor = (f) => path.join(here, "../extension/vendor", f);
const wasmBinary = fs.readFileSync(vendor("ort/ort-wasm-simd-threaded.asyncify.wasm")).buffer;
const ort = getOrt({ wasmBinary });
const config = JSON.parse(fs.readFileSync(vendor("segment.json"), "utf8"));
const detBytes = new Uint8Array(fs.readFileSync(vendor("ppocr-det.onnx")));
const det = { cpu: await loadDetector(cv, detBytes, { ort, gpu: false, wasmBinary }), gpu: await loadDetector(cv, detBytes, { ort, gpu: true, wasmBinary }) };
const seg = {
  cpu: await loadSegmenter(ort, new Uint8Array(fs.readFileSync(vendor("segment.onnx"))), { ...config, executionProviders: ["wasm"] }),
  gpu: await loadSegmenter(ort, new Uint8Array(fs.readFileSync(vendor("segment-gpu.onnx"))), { ...config, executionProviders: ["webgpu"] }),
};

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };
const iou = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); const i = ix * iy; return i / (a.w * a.h + b.w * b.h - i); };
/** Fraction of `a` boxes that have a partner in `b` with IoU ≥ thr. */
const matched = (a, b, thr) => a.filter((x) => b.some((y) => iou(x, y) >= thr)).length / Math.max(1, a.length);

await test("both models start on the GPU", () => {
  assert.equal(det.gpu.ep, "webgpu");
  assert.equal(seg.gpu.ep, "webgpu");
  assert.equal(det.cpu.ep, "wasm");
  assert.equal(seg.cpu.ep, "wasm");
});

const pages = fs.readdirSync(path.join(here, "fixtures")).filter((f) => /^(demo-page|gen-\d+)\.png$/.test(f)).sort().slice(0, 6);
for (const f of pages) {
  const img = await loadImage(path.join(here, "fixtures", f));
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
  const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H);
  const lines = { cpu: await detectText(cv, det.cpu, px), gpu: await detectText(cv, det.gpu, px) };
  const bubbles = { cpu: (await segment(seg.cpu, px)).instances, gpu: (await segment(seg.gpu, px)).instances };
  await test(`[${f}] GPU text lines match the CPU's (${lines.cpu.length} lines)`, () => {
    assert.ok(Math.abs(lines.gpu.length - lines.cpu.length) <= 1, `${lines.gpu.length} vs ${lines.cpu.length}`);
    assert.ok(matched(lines.cpu, lines.gpu, 0.7) >= 0.95, `only ${(100 * matched(lines.cpu, lines.gpu, 0.7)).toFixed(0)}% of CPU lines found on the GPU`);
  });
  // The two variants differ in quantisation (activations int8 on the CPU, float on
  // the GPU), so a borderline bubble may come and go; the confident ones must agree.
  await test(`[${f}] GPU bubbles match the CPU's (${bubbles.cpu.length} bubbles)`, () => {
    const sure = (l) => l.filter((b) => b.score >= 0.5).map((b) => b.box);
    const a = sure(bubbles.cpu), b = sure(bubbles.gpu);
    assert.ok(matched(a, b, 0.75) >= 0.9 && matched(b, a, 0.75) >= 0.9, `CPU→GPU ${matched(a, b, 0.75).toFixed(2)}, GPU→CPU ${matched(b, a, 0.75).toFixed(2)} (${a.length} vs ${b.length} confident bubbles)`);
  });
}
console.log(`GPU TESTS PASSED (${passed})`);
process.exit(0); // Dawn keeps the event loop alive
