// The learned eraser's parts (2.12.0), with the vendored model on the CPU:
//  - the learned fill continues screentone under removed lettering (no white cloud, no ghost),
//    keeps a grey page grey, and changes nothing outside the mask;
//  - a flat surface is recognised as flat, screentone and art are not.
//   node inpaint.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCanvas } from "canvas";
import { cv } from "./cv-node.mjs";
import { getOrt, createSession, run } from "../extension/engine/ort.js";
import { aotInpaint } from "../extension/engine/inpaint.js";
import { flatSurface } from "../extension/engine/erase.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const ort = getOrt();
const { session } = await createSession(new Uint8Array(fs.readFileSync("../extension/vendor/inpaint.onnx")), { gpu: false });
const model = { ort, session, run };

// a screentone panel (dots on light grey) with outlined black lettering across it
const W = 200, H = 120;
const c = createCanvas(W, H), x = c.getContext("2d");
x.fillStyle = "#d6d6d6"; x.fillRect(0, 0, W, H);
x.fillStyle = "#8a8a8a"; for (let yy = 2; yy < H; yy += 6) for (let xx = (yy / 6) % 2 ? 5 : 2; xx < W; xx += 6) { x.beginPath(); x.arc(xx, yy, 1.4, 0, 7); x.fill(); }
const tone = x.getImageData(0, 0, W, H);
x.font = "bold 44px sans-serif"; x.lineWidth = 6; x.strokeStyle = "#fff"; x.strokeText("ABC", 40, 80); x.fillStyle = "#000"; x.fillText("ABC", 40, 80);
const page = x.getImageData(0, 0, W, H);
// mask: everything the lettering changed, grown by a pixel
const mask = new cv.Mat(H, W, cv.CV_8UC1);
for (let i = 0; i < W * H; i++) mask.data[i] = Math.abs(page.data[i * 4] - tone.data[i * 4]) > 10 ? 255 : 0;
const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)); cv.dilate(mask, mask, k); k.delete();
const rgba = cv.matFromImageData(page), rgb = new cv.Mat(); cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB); rgba.delete();
const out = await aotInpaint(cv, model, rgb, mask);
const masked = [], toneIn = [];
for (let i = 0; i < W * H; i++) if (mask.data[i]) { masked.push(out.data[i * 3]); toneIn.push(tone.data[i * 4]); }
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };

test("the fill matches the tone's level (no white cloud, no dark ghost)", () => {
  assert.ok(Math.abs(mean(masked) - mean(toneIn)) < 15, `fill ${mean(masked).toFixed(1)} vs tone ${mean(toneIn).toFixed(1)}`);
});
test("the fill keeps texture (not a flat smear)", () => {
  assert.ok(sd(masked) > 0.35 * sd(toneIn), `fill spread ${sd(masked).toFixed(1)} vs tone ${sd(toneIn).toFixed(1)}`);
});
test("no letter shape survives (no black, no white outline)", () => {
  const dark = masked.filter((v) => v < 60).length, white = masked.filter((v) => v > 245).length;
  assert.ok(dark / masked.length < 0.01 && white / masked.length < 0.02, `dark ${dark}, white ${white} of ${masked.length}`);
});
test("a grey page stays grey", () => {
  let tinted = 0; for (let i = 0; i < W * H; i++) { const r = out.data[i * 3], g = out.data[i * 3 + 1], b = out.data[i * 3 + 2]; if (Math.max(r, g, b) - Math.min(r, g, b) > 3) tinted++; }
  assert.equal(tinted, 0);
});
test("nothing outside the mask changes", () => {
  let changed = 0; for (let i = 0; i < W * H; i++) if (!mask.data[i] && out.data[i * 3] !== rgb.data[i * 3]) changed++;
  assert.equal(changed, 0);
});

{
  // 900 × 120: fitting 384 px would make it 51 px tall, under what the model's dilated convolutions take
  const SW = 900, SH = 120, sc = createCanvas(SW, SH), sx = sc.getContext("2d");
  sx.fillStyle = "#d6d6d6"; sx.fillRect(0, 0, SW, SH);
  sx.fillStyle = "#8a8a8a"; for (let yy = 2; yy < SH; yy += 6) for (let xx = 2; xx < SW; xx += 6) { sx.beginPath(); sx.arc(xx, yy, 1.4, 0, 7); sx.fill(); }
  const strip = cv.matFromImageData(sx.getImageData(0, 0, SW, SH)), srgb = new cv.Mat(); cv.cvtColor(strip, srgb, cv.COLOR_RGBA2RGB); strip.delete();
  const sm = cv.Mat.zeros(SH, SW, cv.CV_8UC1); cv.rectangle(sm, new cv.Point(100, 40), new cv.Point(800, 80), new cv.Scalar(255), -1);
  const filled = await aotInpaint(cv, { ...model, ep: "wasm" }, srgb, sm);
  test("a long strip on the CPU's size budget is filled (the model needs 72 px across)", () => { assert.equal(filled.rows, SH); assert.equal(filled.cols, SW); });
  filled.delete(); srgb.delete(); sm.delete();
}

const mat = (img) => { const m = cv.matFromImageData(img), r = new cv.Mat(); cv.cvtColor(m, r, cv.COLOR_RGBA2RGB); m.delete(); return r; };
const none = cv.Mat.zeros(H, W, cv.CV_8UC1);
test("flat: a white surface with JPEG-like noise is flat, and gives its colour", () => {
  const w = createCanvas(W, H), wx = w.getContext("2d"); wx.fillStyle = "#fbfbfb"; wx.fillRect(0, 0, W, H);
  const id = wx.getImageData(0, 0, W, H); for (let i = 0; i < id.data.length; i += 4) { const n = (i * 7919) % 5 - 2; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
  const m = mat(id), f = flatSurface(m, none, null); m.delete();
  assert.ok(f && Math.abs(f[0] - 251) <= 2, JSON.stringify(f));
});
test("flat: screentone is not flat", () => { const m = mat(tone); assert.equal(flatSurface(m, none, null), null); m.delete(); });
test("flat: only the area's unmasked pixels count", () => {
  // the lettering itself (masked) must not make a white bubble look textured
  const w = createCanvas(W, H), wx = w.getContext("2d"); wx.fillStyle = "#fff"; wx.fillRect(0, 0, W, H);
  wx.font = "bold 44px sans-serif"; wx.fillStyle = "#000"; wx.fillText("ABC", 40, 80);
  const id = wx.getImageData(0, 0, W, H), lm = new cv.Mat(H, W, cv.CV_8UC1);
  for (let i = 0; i < W * H; i++) lm.data[i] = id.data[i * 4] < 250 ? 255 : 0;
  const k2 = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)); cv.dilate(lm, lm, k2); k2.delete();
  const m = mat(id), f = flatSurface(m, lm, null); m.delete(); lm.delete();
  assert.ok(f && f[0] === 255, JSON.stringify(f));
});
none.delete(); mask.delete(); rgb.delete(); out.delete();
console.log(`\n${passed} passed`);
