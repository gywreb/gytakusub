// The GPU path, end to end, against the CPU path: both models (text detector and
// bubble segmenter) run on ONNX Runtime's WebGPU backend and must find the same
// text lines and the same bubbles as on the CPU, on every fixture page, and the
// page's analysis and layout must come out the same (3.0).
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
const { loadDetector, detectText, detectInEmptyBubbles, detectInDarkShapes } = await import("../extension/engine/detect.js");
const { analyze } = await import("../extension/engine/analyze.js");
const { layout } = await import("../extension/engine/layout.js");
const { loadSegmenter, segment } = await import("../extension/engine/segment.js");

const vendor = (f) => path.join(here, "../extension/vendor", f);
const wasmBinary = fs.readFileSync(vendor("ort/ort-wasm-simd-threaded.asyncify.wasm")).buffer;
const ort = getOrt({ wasmBinary });
const config = JSON.parse(fs.readFileSync(vendor("segment.json"), "utf8"));
const detBytes = new Uint8Array(fs.readFileSync(vendor("ppocr-det.onnx")));
const det = { cpu: await loadDetector(cv, detBytes, { ort, gpu: false, wasmBinary }), gpu: await loadDetector(cv, detBytes, { ort, gpu: true, wasmBinary }) };
// one bubble model for both backends (3.0, ADR 0020)
const segBytes = new Uint8Array(fs.readFileSync(vendor("segment.onnx")));
const seg = {
  cpu: await loadSegmenter(ort, segBytes, { ...config, executionProviders: ["wasm"] }),
  gpu: await loadSegmenter(ort, segBytes, { ...config, executionProviders: ["webgpu"] }),
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
  // One model on both backends: the same bubbles, their masks a pixel apart at most (until 3.0 the
  // CPU had a model of its own, and only the confident bubbles agreed, at IoU 0.75).
  await test(`[${f}] GPU bubbles are the CPU's (${bubbles.cpu.length} bubbles)`, () => {
    assert.equal(bubbles.gpu.length, bubbles.cpu.length);
    for (const a of bubbles.cpu) {
      const b = bubbles.gpu.find((q) => iou(a.box, q.box) >= 0.9);
      assert.ok(b, `a CPU bubble at ${JSON.stringify(a.box)} has no GPU twin`);
      let both = 0, either = 0;
      const x0 = Math.min(a.box.x, b.box.x), y0 = Math.min(a.box.y, b.box.y), x1 = Math.max(a.box.x + a.box.w, b.box.x + b.box.w), y1 = Math.max(a.box.y + a.box.h, b.box.y + b.box.h);
      const at = (q, x, y) => x >= q.box.x && y >= q.box.y && x < q.box.x + q.box.w && y < q.box.y + q.box.h && q.mask[(y - q.box.y) * q.box.w + (x - q.box.x)] > 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = at(a, x, y), q = at(b, x, y); if (p && q) both++; if (p || q) either++; }
      assert.ok(both / Math.max(1, either) >= 0.98, `mask IoU ${(both / either).toFixed(3)}`);
    }
  });
  // The whole page: the analysis and the layout on the GPU are the CPU's, box for box (a report
  // replayed on the CPU reproduces the user's graphics card, and the same page reads the same).
  await test(`[${f}] the page's regions and placements on the GPU are the CPU's`, async () => {
    const run = async (d, s) => {
      let ls = await detectText(cv, d, px);
      ls = await detectInDarkShapes(cv, d, px, ls);
      const sg = await segment(s, px);
      ls = await detectInEmptyBubbles(cv, d, px, ls, sg.instances, s.bubbleClasses);
      const an = analyze(cv, px, { detector: d, lines: ls, instances: sg.instances, bubbleClasses: s.bubbleClasses });
      const items = an.regions.map((r, i) => ({ tag: r.id, box: [r.box.x / W, r.box.y / H, r.box.w / W, r.box.h / H], text: "Look over there, quickly!", kind: r.kind === "bubble" ? "bubble" : "narration", index: i }));
      const { placements } = layout(an, items);
      const out = { regions: an.regions.map((r) => ({ kind: r.kind, box: r.box })), placements: placements.map((p) => p.rect) };
      an.dispose();
      return out;
    };
    const a = await run(det.cpu, seg.cpu), b = await run(det.gpu, seg.gpu);
    const d = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.w - q.w), Math.abs(p.h - q.h));
    assert.equal(b.regions.length, a.regions.length, "regions");
    a.regions.forEach((r, i) => { assert.equal(b.regions[i].kind, r.kind); assert.ok(d(r.box, b.regions[i].box) <= 2, `region ${i}: ${JSON.stringify(r.box)} vs ${JSON.stringify(b.regions[i].box)}`); });
    assert.equal(b.placements.length, a.placements.length, "placements");
    a.placements.forEach((r, i) => assert.ok(d(r, b.placements[i]) <= 2, `placement ${i}: ${JSON.stringify(r)} vs ${JSON.stringify(b.placements[i])}`));
  });
}
// The learned eraser's inpainting model (2.12): it must start on the GPU (strict: no quiet
// fallback to the CPU) and fill a hole in screentone the way the CPU does.
{
  const { createSession, run } = await import("../extension/engine/ort.js");
  const { aotInpaint } = await import("../extension/engine/inpaint.js");
  const bytes = new Uint8Array(fs.readFileSync(path.join(here, "../extension/vendor/inpaint.onnx")));
  const ort = getOrt();
  const gpuS = await createSession(bytes, { gpu: true, strict: true }), cpuS = await createSession(bytes, { gpu: false });
  const W = 240, H = 160, rgb = new cv.Mat(H, W, cv.CV_8UC3), hole = cv.Mat.zeros(H, W, cv.CV_8UC1);
  for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; rgb.data[i * 3] = rgb.data[i * 3 + 1] = rgb.data[i * 3 + 2] = x % 7 < 2 && y % 7 < 2 ? 90 : 210; }
  cv.rectangle(hole, new cv.Point(60, 50), new cv.Point(180, 80), new cv.Scalar(255), -1);
  const a = await aotInpaint(cv, { ort, session: gpuS.session, run, ep: gpuS.ep }, rgb, hole, { maxSide: 768 });
  const b = await aotInpaint(cv, { ort, session: cpuS.session, run, ep: cpuS.ep }, rgb, hole, { maxSide: 768 });
  let d = 0, n = 0; for (let i = 0; i < W * H; i++) if (hole.data[i]) { d += Math.abs(a.data[i * 3] - b.data[i * 3]); n++; }
  await test("the inpainting model starts on the GPU", () => assert.equal(gpuS.ep, "webgpu"));
  await test(`its fill matches the CPU's (mean difference ${(d / n).toFixed(2)} levels)`, () => assert.ok(d / n < 2));
  // LaMa (2.13): the extension's fill on a graphics card. One size (512 px); on lavapipe a fill
  // takes about a minute, so one area only.
  const { LAMA_SIDE } = await import("../extension/engine/inpaint.js");
  const lb = new Uint8Array(fs.readFileSync(path.join(here, "../extension/vendor/lama.onnx")));
  const lg = await createSession(lb, { gpu: true, strict: true }), lc = await createSession(lb, { gpu: false });
  const la = await aotInpaint(cv, { ort, session: lg.session, run, ep: lg.ep, kind: "lama", side: LAMA_SIDE }, rgb, hole);
  const lcpu = await aotInpaint(cv, { ort, session: lc.session, run, ep: lc.ep, kind: "lama", side: LAMA_SIDE }, rgb, hole);
  let ld = 0; for (let i = 0; i < W * H; i++) if (hole.data[i]) ld += Math.abs(la.data[i * 3] - lcpu.data[i * 3]);
  await test("LaMa starts on the GPU", () => assert.equal(lg.ep, "webgpu"));
  await test(`its fill matches the CPU's (mean difference ${(ld / n).toFixed(2)} levels)`, () => assert.ok(ld / n < 2));
  la.delete(); lcpu.delete();
  a.delete(); b.delete(); rgb.delete(); hole.delete();
}
// The learned text mask (3.2): it must start on the GPU and see the lettering the CPU sees.
{
  const { createSession } = await import("../extension/engine/ort.js");
  const { textMasker, maskText } = await import("../extension/engine/textmask.js");
  const bytes = new Uint8Array(fs.readFileSync(vendor("textmask.onnx")));
  const g = await createSession(bytes, { gpu: true, strict: true }), c = await createSession(bytes, { gpu: false });
  const can = createCanvas(400, 200), x = can.getContext("2d");
  const grad = x.createLinearGradient(0, 0, 400, 200); grad.addColorStop(0, "#0b0506"); grad.addColorStop(1, "#8a0d12");
  x.fillStyle = grad; x.fillRect(0, 0, 400, 200); x.fillStyle = "#ff2a2a"; x.font = "bold 28px sans-serif"; x.fillText("WHERE ARE", 60, 90); x.fillText("YOU GOING?", 55, 130);
  const img = x.getImageData(0, 0, 400, 200), crop = [{ region: 1, x: 20, y: 40, w: 300, h: 120 }];
  const [mg] = await maskText(textMasker(g.session, { ep: g.ep }), img, crop), [mc] = await maskText(textMasker(c.session, { ep: c.ep }), img, crop);
  let differ = 0, on = 0; for (let i = 0; i < mg.mask.length; i++) { if (mg.mask[i] !== mc.mask[i]) differ++; on += mc.mask[i]; }
  await test("the text mask starts on the GPU", () => assert.equal(g.ep, "webgpu"));
  await test(`its mask is the CPU's (${differ} of ${mg.mask.length} pixels differ; ${on} lettering)`, () => assert.ok(on > 1000 && differ < 0.01 * mg.mask.length));
}
console.log(`GPU TESTS PASSED (${passed})`);
process.exit(0); // Dawn keeps the event loop alive
