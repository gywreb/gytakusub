// The letter size of a row of lettering (engine/analyze.js rowLetter), on ink drawn here:
// hand-drawn capitals whose ink sits in heavy bars measured 4–7 px for 18 px letters (2.13.1),
// so their lettering was left on the page and the translation drawn tiny.
import assert from "node:assert/strict";
import { cv } from "./cv-node.mjs";
import { rowLetter, bubbleLetter } from "../extension/engine/analyze.js";
import { loadLettering } from "./lettering-setup.mjs";

loadLettering();
const GyText = globalThis.GyText;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const W = 260, H = 120;
const page = () => new Uint8Array(W * H);
const rect = (I, x, y, w, h) => { for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) I[r * W + c] = 255; };
const measure = (I, box) => { const m = cv.matFromArray(H, W, cv.CV_8UC1, I); try { return rowLetter(cv, m, box.x, box.y, box.x + box.w, box.y + box.h).letter; } finally { m.delete(); } };
// the band alone, as before 2.13.1
const bandOnly = (I, box) => {
  const prof = []; for (let y = box.y; y < box.y + box.h; y++) { let n = 0; for (let x = box.x; x < box.x + box.w; x++) if (I[y * W + x]) n++; prof.push(n); }
  const peak = Math.max(...prof); let best = 0, run = 0; for (const v of prof) { run = v >= 0.3 * peak ? run + 1 : 0; best = Math.max(best, run); }
  return Math.max(4, best * 1.15);
};

// "QUE"-like capitals 18 px tall: a thin 2 px stem, a heavy 3-row bar at the foot, a light one on top
const capitals = (I, x0, y0, n, h = 18) => {
  for (let i = 0; i < n; i++) {
    const x = x0 + i * 16;
    rect(I, x, y0, 2, h); // stem
    rect(I, x, y0 + h - 3, 12, 3); // heavy foot
    rect(I, x + 2, y0, 4, 2); // a short stroke on top
    rect(I, x + 2, y0 + 8, 3, 1); // a hairline across the middle
  }
};
test("capitals with heavy feet measure their height, not their feet", () => {
  const I = page(); capitals(I, 20, 40, 3);
  const box = { x: 20, y: 40, w: 3 * 16, h: 18 };
  assert.ok(bandOnly(I, box) < 8, "the guard: the band alone measured " + bandOnly(I, box));
  const L = measure(I, box);
  assert.ok(L >= 17 && L <= 24, "measured " + L.toFixed(1));
});

test("an S beside a dash: the S sets the size, not the dash", () => {
  const I = page(), x = 30, y = 30, h = 22;
  rect(I, x, y, 14, 3); rect(I, x, y + 9, 14, 3); rect(I, x, y + h - 3, 14, 3); // three bars
  rect(I, x, y, 2, 10); rect(I, x + 12, y + 10, 2, 11); // thin sides
  rect(I, x + 18, y + 9, 8, 3); // the dash
  const box = { x, y, w: 26, h };
  assert.ok(bandOnly(I, box) < 8, "the guard: " + bandOnly(I, box));
  const L = measure(I, box);
  assert.ok(L >= 21 && L <= 28, "measured " + L.toFixed(1));
});

test("a lowercase line keeps its band (x-height), its tall letters don't take over", () => {
  const I = page(), y = 40, xh = 10;
  for (let i = 0; i < 10; i++) {
    const x = 10 + i * 12, tall = i % 3 === 0, desc = i % 4 === 1;
    rect(I, x, y, 8, xh); rect(I, x + 2, y + 2, 4, xh - 4); // an "o"-like body
    for (let r = y + 2; r < y + xh - 2; r++) for (let c = x + 2; c < x + 6; c++) I[r * W + c] = 0;
    if (tall) rect(I, x, y - 5, 2, 5); // ascender
    if (desc) rect(I, x + 6, y + xh, 2, 4); // descender
  }
  const box = { x: 10, y: y - 5, w: 120, h: xh + 9 };
  const L = measure(I, box), band = bandOnly(I, box);
  assert.equal(L, band, `measured ${L.toFixed(1)}, band ${band.toFixed(1)}`);
});

test("a stray tall mark at the box's edge (a bubble outline) does not set the size", () => {
  const I = page();
  for (const [row, n] of [[20, 2], [40, 4], [60, 3]]) for (let i = 0; i < n; i++) { const x = 30 + i * 14; rect(I, x, row, 10, 14); for (let r = row + 3; r < row + 11; r++) for (let c = x + 3; c < x + 7; c++) I[r * W + c] = 0; }
  rect(I, 20, 15, 2, 70); // the outline, caught in the box
  const box = { x: 20, y: 15, w: 70, h: 70 };
  const L = measure(I, box);
  assert.ok(L <= 18, "measured " + L.toFixed(1));
});

// A page whose only lettering found is its sound effects measures their size (125 px on a
// Kamen Rider page); a bubble's own line was set at it, 64 px letters in a 97 px box.
test("a bubble whose lettering measured small keeps to its own shape, not the sound effects' size", () => {
  const box = { w: 109, h: 190 };
  const L = bubbleLetter([{ letter: 20, glyphCount: 8 }], 125, box);
  assert.ok(L >= 20 && L <= 0.25 * 109 + 1e-9, "letter " + L);
  assert.ok(bubbleLetter([], 125, box) <= 0.25 * 109 + 1e-9);
});
test("an ordinary bubble keeps its measured size; one holding only dots takes the page's", () => {
  assert.equal(bubbleLetter([{ letter: 18, glyphCount: 12 }], 20, { w: 140, h: 160 }), 18);
  assert.equal(bubbleLetter([{ letter: 4, glyphCount: 3 }], 20, { w: 140, h: 160 }), 20);
});

// the fit (text.js): a floor too big for the box gives way before any word is cut letter by letter
{
  const state = { size: 16 };
  const setFont = (s) => { state.size = s; };
  const measure = (s) => s.replace(/\u00ad/g, "").length * state.size * 0.375;
  test("a floor too big for the box gives way before a word is cut", () => {
    const f = GyText.fitText("There you are!", { x: 0, y: 0, w: 60, h: 100 }, setFont, measure, { maxSize: 80, minSize: 64 });
    assert.ok(!f.forced, JSON.stringify(f));
    assert.equal(f.lines.join(" ").replace(/-\s?/g, ""), "There you are!", JSON.stringify(f.lines));
    assert.ok(f.size < 64 && f.lines.every((l) => measure(l) <= 60), JSON.stringify(f));
  });
}

console.log(`\nLETTER SIZE TESTS PASSED (${passed})`);
