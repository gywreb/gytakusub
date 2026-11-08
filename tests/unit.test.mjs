import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- load bubble.js (IIFE on globalThis) ---
new Function(readFileSync("../extension/bubble.js", "utf8"))();
const G = globalThis.GyT;

// --- synthetic page 400x300: grey bg, white ellipse bubble with black outline, black text strokes ---
const W = 400, H = 300;
const data = new Uint8ClampedArray(W * H * 4);
const set = (x, y, v) => { const i = (y * W + x) * 4; data[i] = data[i+1] = data[i+2] = v; data[i+3] = 255; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 140);           // grey artwork
const cx = 200, cy = 150, rx = 120, ry = 70;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  if (d <= 1) set(x, y, 255);                                                    // bubble interior
  if (d > 0.93 && d <= 1) set(x, y, 0);                                          // outline
}
for (let row = 0; row < 4; row++)                                                 // "text" strokes
  for (let x = 150; x < 250; x += 7) for (let dy = 0; dy < 10; dy++) for (let dx = 0; dx < 3; dx++)
    set(x + dx, 118 + row * 18 + dy, 10);

const img = { data, width: W, height: H };
const box = { x: 150, y: 115, w: 100, h: 70 };   // Claude's approximate text box
const b = G.findBubble(img, box);
assert.ok(b, "bubble should be found");
console.log("bbox", b.bbox, "fillRatio", b.fillRatio.toFixed(3), "color", b.color);
assert.ok(Math.abs(b.bbox.x - (cx - rx * Math.sqrt(0.93))) < 4, "left edge stops at outline");
assert.ok(b.bbox.w > 200 && b.bbox.w < 240, "width ≈ inner ellipse");
assert.ok(b.fillRatio > 0.6 && b.fillRatio < 0.85, "ellipse-like fill ratio");
assert.deepEqual(b.color, [255, 255, 255]);

// row-span ∩ col-span must cover the text strokes
const covered = (x, y) => {
  const ry_ = (y - b.bbox.y) * 2, cx_ = (x - b.bbox.x) * 2;
  return b.rows[ry_] <= x && x <= b.rows[ry_+1] && b.cols[cx_] <= y && y <= b.cols[cx_+1];
};
assert.ok(covered(151, 120) && covered(248, 180), "text pixels covered by fill");
assert.ok(!covered(cx - rx + 2, cy - ry + 2), "corner outside ellipse not painted");

// text over open grey artwork -> no bubble (flood leaks)
assert.equal(G.findBubble(img, { x: 10, y: 10, w: 60, h: 30 }), null, "open background -> null");

// textRect inset
const tr = G.textRect(b);
assert.ok(tr.x > b.bbox.x && tr.w < b.bbox.w);

// fitText with a fake monospace measure (8px per char at size 16 -> 0.5*size per char)
let size = 16;
const fit = G.fitText("Hello there, this is a fairly long translated line of dialogue.", { x: 0, y: 0, w: 120, h: 80 },
  (s) => { size = s; }, (str) => str.length * size * 0.5, { maxSize: 40 });
console.log("fit", fit.size, fit.lines);
assert.ok(fit.lines.every((l) => l.length * fit.size * 0.5 <= 120));
assert.ok(fit.lines.length * fit.lineHeight <= 80);

// wrap breaks very long words
const lines = G.wrap((s) => s.length * 10, "Supercalifragilistic", 50);
assert.ok(lines.every((l) => l.length <= 5));

// --- extractJson from background.js (stub chrome) ---
globalThis.chrome = {
  runtime: { onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  tabs: { onRemoved: { addListener() {} } },
  storage: { onChanged: { addListener() {} } },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
};
const bg = await import("../extension/prompt.js");
assert.deepEqual(bg.extractJson('Here you go:\n```json\n{"items":[],"terms":[]}\n```'), { items: [], terms: [] });
assert.deepEqual(bg.extractJson('{"items":[{"box":[1,2,3,4]}]}'), { items: [{ box: [1,2,3,4] }] });
assert.throws(() => bg.extractJson("no json here"));
console.log("ALL TESTS PASSED");

// --- v0.1.1: word-splitting preference + pixel-box conversion ---
{
  let sz = 16;
  const measure = (s) => s.length * sz * 0.5;
  const setFont = (s) => { sz = s; };
  // "SHOTARO..." in a narrow box: must shrink the font rather than split the word
  const f = G.fitText("SHOTARO...", { x: 0, y: 0, w: 100, h: 60 }, setFont, measure, { maxSize: 40, minSize: 8 });
  assert.equal(f.broken, false, "should not split a word when a comparable size fits it whole");
  assert.deepEqual(f.lines, ["SHOTARO..."]);
  // very narrow + tall: hyphenated break beats a tiny single line
  const h = G.fitText("SHOTARO", { x: 0, y: 0, w: 40, h: 120 }, setFont, measure, { maxSize: 40, minSize: 8 });
  assert.equal(h.broken, true);
  assert.ok(h.lines[0].endsWith("-"), "hyphen on letter break: " + h.lines[0]);
  assert.ok(h.size > 8);
  // impossible even at minSize -> splits, flagged
  const g = G.fitText("SUPERCALIFRAGILISTIC", { x: 0, y: 0, w: 30, h: 60 }, setFont, measure, { maxSize: 40, minSize: 8 });
  assert.equal(g.broken, true);
  sz = 12;
  assert.equal(G.longestWordWidth(measure, "it's a crime!"), "crime!".length * 6);
}
console.log("v0.1.1 TESTS PASSED");

// --- detectBubbles on a synthetic page: one bubble, one border-touching white area, one empty white box ---
{
  const W = 600, H = 400;
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, v) => { const i = (y * W + x) * 4; data[i] = data[i+1] = data[i+2] = v; data[i+3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 120);          // grey art
  for (let y = 0; y < H; y++) for (let x = 0; x < 60; x++) set(x, y, 255);         // white gutter touching border
  for (let y = 300; y < 380; y++) for (let x = 400; x < 560; x++) set(x, y, 255);  // empty white box (no ink)
  const cx = 300, cy = 150, rx = 80, ry = 50;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d <= 1) set(x, y, 255);
    if (d > 0.93 && d <= 1) set(x, y, 0);
  }
  for (let row = 0; row < 3; row++) for (let x = 260; x < 340; x += 8) for (let dy = 0; dy < 12; dy++) for (let dx = 0; dx < 3; dx++) set(x + dx, 125 + row * 20 + dy, 10);
  const cands = G.detectBubbles({ data, width: W, height: H });
  assert.equal(cands.length, 1, "exactly the bubble: " + JSON.stringify(cands.map(c => c.bbox)));
  const b = cands[0].bbox;
  assert.ok(Math.abs(b.x - (cx - rx)) < 8 && Math.abs(b.w - 2 * rx) < 12, "bbox ≈ ellipse: " + JSON.stringify(b));
  assert.ok(cands[0].color[0] > 240);
  const est = G.estimateLetterSize({ data, width: W, height: H }, { x: b.x + b.w * 0.1, y: b.y + b.h * 0.1, w: b.w * 0.8, h: b.h * 0.8 }, null);
  assert.ok(est > 10 && est < 22, "letter size from 12px strokes ≈ 15: " + est);
}
console.log("v0.3 TESTS PASSED");
