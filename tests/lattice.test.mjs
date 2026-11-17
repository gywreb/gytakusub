// The screentone fill (engine/tone.js, 2.12.0): continues a periodic surface under a hole in
// phase, and refuses what is not one.
//   node lattice.test.mjs
import assert from "node:assert/strict";
import { createCanvas } from "canvas";
import { cv } from "./cv-node.mjs";
import { latticeFill } from "../extension/engine/tone.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const W = 220, H = 140;
/** A surface drawn by `paint`, a lettering-shaped hole, the fill, and its error against the truth. */
function run(paint, opts = {}) {
  const c = createCanvas(W, H), x = c.getContext("2d");
  paint(x);
  const truth = x.getImageData(0, 0, W, H);
  const hole = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0));
  const m = createCanvas(W, H), mx = m.getContext("2d");
  mx.fillStyle = "#000"; mx.fillRect(0, 0, W, H);
  mx.font = "bold 40px sans-serif"; mx.lineWidth = 8; mx.strokeStyle = "#fff"; mx.fillStyle = "#fff";
  mx.strokeText("TONE", 50, 85); mx.fillText("TONE", 50, 85);
  const md = mx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < W * H; i++) hole.data[i] = md[i * 4] > 127 ? 255 : 0;
  const rgba = cv.matFromImageData(truth), rgb = new cv.Mat(); cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB); rgba.delete();
  // the hole holds black lettering, as on a page
  for (let i = 0; i < W * H; i++) if (hole.data[i]) rgb.data[i * 3] = rgb.data[i * 3 + 1] = rgb.data[i * 3 + 2] = 0;
  const info = {};
  const out = latticeFill(cv, rgb, hole, null, { info, ...opts });
  let err = 0, amp = 0, n = 0, sum = 0;
  const all = []; for (let i = 0; i < W * H; i++) if (!hole.data[i]) all.push(truth.data[i * 4]);
  const mean = all.reduce((s, v) => s + v, 0) / all.length;
  if (out) for (let i = 0; i < W * H; i++) if (hole.data[i]) { err += Math.abs(out.data[i * 3] - truth.data[i * 4]); amp += Math.abs(truth.data[i * 4] - mean); sum += out.data[i * 3]; n++; }
  out?.delete(); rgb.delete(); hole.delete();
  return { filled: !!out, err: err / Math.max(1, n), amp: amp / Math.max(1, n), level: sum / Math.max(1, n), info };
}
const show = (r) => console.log("   ", r.filled, r.err.toFixed(1), r.amp.toFixed(1), r.info.score?.toFixed(2), JSON.stringify(r.info.lattice?.map(v=>v.map(z=>+z.toFixed(2)))));
const dots = (period, angle, radius, bg = "#e8e8e8", ink = "#555") => (x) => {
  x.fillStyle = bg; x.fillRect(0, 0, W, H); x.fillStyle = ink;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let i = -60; i < 60; i++) for (let j = -60; j < 60; j++) {
    const px = 3 + i * period * ca - j * period * sa, py = 2 + i * period * sa + j * period * ca;
    if (px < -5 || py < -5 || px > W + 5 || py > H + 5) continue;
    const r = typeof radius === "function" ? radius(px, py) : radius;
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
  }
};

test("halftone dots at 45° with a period of 5.6 px: filled in phase", () => {
  const r = run(dots(5.6, Math.PI / 4, 1.5)); show(r);
  assert.ok(r.filled, "refused");
  assert.ok(r.err < 0.35 * r.amp, `error ${r.err.toFixed(1)} vs texture ${r.amp.toFixed(1)}`);
});
test("square halftone, coarse (9 px), dark dots", () => {
  const r = run(dots(9, 0, 3, "#ffffff", "#000")); show(r);
  assert.ok(r.filled, "refused");
  assert.ok(r.err < 0.35 * r.amp, `error ${r.err.toFixed(1)} vs texture ${r.amp.toFixed(1)}`);
});
test("a gradient tone (dots growing left to right): filled, at the local dot size", () => {
  const r = run(dots(6.3, 0.3, (px) => 0.6 + 2 * Math.max(0, Math.min(1, px / W)))); show(r);
  assert.ok(r.filled, "refused");
  assert.ok(r.err < 0.5 * r.amp, `error ${r.err.toFixed(1)} vs texture ${r.amp.toFixed(1)}`);
});
test("diagonal hatching: filled", () => {
  const r = run((x) => { x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.strokeStyle = "#222"; x.lineWidth = 1.6; for (let k = -H; k < W + H; k += 7) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + H, H); x.stroke(); } x.strokeStyle = "#999"; for (let k = -H; k < W + H; k += 7) { x.beginPath(); x.moveTo(k + 3, 0); x.lineTo(k + 3 - H * 0.2, H); x.stroke(); } }); show(r);
  assert.ok(r.filled, "refused");
  assert.ok(r.err < 0.5 * r.amp, `error ${r.err.toFixed(1)} vs texture ${r.amp.toFixed(1)}`);
});
test("art (shapes, no period): refused", () => {
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const r = run((x) => { x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); for (let i = 0; i < 40; i++) { x.strokeStyle = rnd() < 0.5 ? "#000" : "#777"; x.lineWidth = 1 + rnd() * 3; x.beginPath(); x.moveTo(rnd() * W, rnd() * H); x.bezierCurveTo(rnd() * W, rnd() * H, rnd() * W, rnd() * H, rnd() * W, rnd() * H); x.stroke(); } }); show(r);
  assert.ok(!r.filled, `filled (score ${r.info.score?.toFixed(2)})`);
});
test("noise grain: refused", () => {
  let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const r = run((x) => { const d = x.createImageData(W, H); for (let i = 0; i < W * H; i++) { const v = 150 + rnd() * 80; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; } x.putImageData(d, 0, 0); }); show(r);
  assert.ok(!r.filled, `filled (score ${r.info.score?.toFixed(2)})`);
});
test("smooth shading: refused (no texture to continue)", () => {
  const r = run((x) => { const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#fff"); g.addColorStop(1, "#888"); x.fillStyle = g; x.fillRect(0, 0, W, H); }); show(r);
  assert.ok(!r.filled);
});
test("the copy stays on the given surface (source mask)", () => {
  // tone on the left half, black on the right: with the source limited to the tone, no black comes in
  const c = createCanvas(W, H), x = c.getContext("2d"); dots(6, 0, 1.6)(x); x.fillStyle = "#000"; x.fillRect(150, 0, 70, H);
  const d = x.getImageData(0, 0, W, H);
  const rgba = cv.matFromImageData(d), rgb = new cv.Mat(); cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB); rgba.delete();
  const hole = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0)), src = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(0));
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { if (xx >= 110 && xx < 146 && y >= 40 && y < 100) hole.data[y * W + xx] = 255; if (xx < 148) src.data[y * W + xx] = 255; }
  const out = latticeFill(cv, rgb, hole, src, { margin: 0 });
  assert.ok(out, "refused");
  let dark = 0; for (let y = 40; y < 100; y++) for (let xx = 110; xx < 146; xx++) if (out.data[(y * W + xx) * 3] < 60) dark++;
  assert.ok(dark < 0.05 * 36 * 60, `${dark} black pixels`);
  out.delete(); rgb.delete(); hole.delete(); src.delete();
});
console.log(`\n${passed} passed`);
