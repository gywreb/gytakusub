// The learned-segmentation path, end to end, on a stand-in model: ONNX Runtime
// loads and runs in Node (same files the extension ships), both export layouts
// decode, boxes and masks map back to page pixels, NMS de-duplicates, and the
// page analysis takes the instances as bubbles. The stand-in model (make-fake-seg.py)
// emits the demo page's ground truth as constants, so this proves the plumbing,
// not a detector. With a real model under GYT_SEGMENT, engine.test.mjs is the
// quality gate.
import fs from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage } from "canvas";
import { cv, detector } from "./cv-node.mjs";
import { getOrt } from "../extension/engine/ort.js";
import { loadSegmenter, segment, letterbox, nms } from "../extension/engine/segment.js";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };
const iou = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); const i = ix * iy; return i / (a.w * a.h + b.w * b.h - i); };

const page = "fixtures/demo-page.png", truthPath = "fixtures/demo-truth.json";
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8")).filter((t) => t.kind === "bubble");
const models = { v8: "/tmp/gyt-fake-seg.onnx", e2e: "/tmp/gyt-fake-seg-e2e.onnx" };
execFileSync("python3", ["make-fake-seg.py", page, truthPath, models.v8]);
execFileSync("python3", ["make-fake-seg.py", page, truthPath, models.e2e, "--e2e"]);

const ort = getOrt({ wasmBinary: fs.readFileSync("../extension/vendor/ort/ort-wasm-simd-threaded.wasm").buffer });
const img = await loadImage(page);
const c = createCanvas(img.width, img.height), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
const pixels = ctx.getImageData(0, 0, img.width, img.height);

await test("letterbox keeps aspect, centres, pads with grey", () => {
  const lb = letterbox(pixels, 640);
  assert.equal(lb.size, 640);
  assert.ok(Math.abs(lb.r - 640 / Math.max(img.width, img.height)) < 1e-9);
  assert.ok(Math.abs(lb.data[0] - 114 / 255) < 1e-6, "padding is grey 114");
  const nw = Math.round(img.width * lb.r); assert.ok(lb.dx === Math.floor((640 - nw) / 2));
});
await test("nms keeps the best of overlapping candidates", () => {
  const kept = nms([{ x1: 0, y1: 0, x2: 10, y2: 10, score: 0.5 }, { x1: 1, y1: 1, x2: 11, y2: 11, score: 0.9 }, { x1: 50, y1: 50, x2: 60, y2: 60, score: 0.3 }], 0.45);
  assert.deepEqual(kept.map((k) => k.score), [0.9, 0.3]);
});

for (const [layoutName, file] of Object.entries(models)) {
  const seg = await loadSegmenter(ort, new Uint8Array(fs.readFileSync(file)), { classes: ["bubble"] });
  const { instances } = await segment(seg, pixels);
  await test(`[${layoutName}] every ground-truth bubble comes back once, box within 2 px`, () => {
    assert.equal(instances.length, truth.length);
    for (const t of truth) {
      const tb = { x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3] };
      const m = instances.find((i) => iou(i.box, tb) > 0.95);
      assert.ok(m, `missing ${JSON.stringify(tb)}`);
      assert.ok(Math.abs(m.box.x - tb.x) <= 2 && Math.abs(m.box.y - tb.y) <= 2 && Math.abs(m.box.w - tb.w) <= 3 && Math.abs(m.box.h - tb.h) <= 3);
    }
  });
  await test(`[${layoutName}] masks have the shape's area (ellipse ≈ π/4 of the box, rectangle ≈ all of it)`, () => {
    for (const t of truth) {
      const tb = { x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3] };
      const m = instances.find((i) => iou(i.box, tb) > 0.95);
      let n = 0; for (const v of m.mask) if (v) n++;
      const fill = n / (m.box.w * m.box.h), want = t.shape === "rect" ? 1 : Math.PI / 4;
      assert.ok(Math.abs(fill - want) < 0.12, `${t.shape}: fill ${fill.toFixed(2)} vs ${want.toFixed(2)}`);
    }
  });
  await test(`[${layoutName}] analysis takes the instances as its bubbles`, () => {
    const an = analyze(cv, pixels, { detector, instances, bubbleClasses: seg.bubbleClasses });
    assert.ok(an.segmented && an.learned);
    assert.equal(an.bubbles.length, truth.length);
    for (const b of an.bubbles) assert.ok(b.blocks.length >= 1, `bubble ${JSON.stringify(b.box)} has its lettering`);
    const { placements, regionIds } = layout(an, an.regions.map((r, i) => ({ tag: r.id, box: null, text: "Hello there " + i, size: "normal", kind: "bubble" })));
    assert.equal(placements.length, an.regions.length);
    for (const p of placements) { const inside = an.insideOf(p.tag); if (inside) assert.ok(inside(p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2)); }
    const out = erase(cv, pixels, an, regionIds);
    assert.ok(out.image.width === img.width && out.rois.length >= an.bubbles.length);
    an.dispose();
  });
}
console.log(`SEGMENT TESTS PASSED (${passed})`);
