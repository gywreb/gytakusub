// Free text and coloured lettering (2.12.0, ADR 0014):
//  - layout.js adoptLettering: lettering the analysis set aside is erased when a translated line's
//    box holds it; each piece goes to the box that fits it best; never a bubble line's, never a box
//    sliced into three or more guessed lines (a logo), never lettering far above dialogue size
//  - layout.js: a loose box between two regions does not override the stamp
//  - erase.js: blue and orange lettering on a plain surround is erased whole (2.11's grey masks
//    took only its darkest strokes)
//   node freetext.test.mjs
import assert from "node:assert/strict";
import { createCanvas } from "canvas";
import { cv, analyzePage } from "./cv-node.mjs";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";
import { loadLettering } from "./lettering-setup.mjs";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

// ---- adoption, on an analysis made by hand (pure geometry) ----
const W = 1000, H = 1000;
const para = (x, y, w, h, extra = {}) => ({ box: { x, y, w, h }, gbox: { x, y, w, h }, letter: 24, lineLetters: [extra.letter || 24], vertical: false, dark: false, score: 0.9, glyphCount: 5, region: null, bubble: null, ...extra });
const item = (box, text, tag = null, kind = "sign") => ({ tag, box: [box[0] / W, box[1] / H, box[2] / W, box[3] / H], text, size: "normal", kind });
const analysis = (regions, blocks, lines = []) => ({ W, H, letter: 24, regions, blocks, lines, insideOf: () => null });
const block = (id, p) => { const r = { id, kind: "block", ref: { ...p, region: id }, box: { ...p.gbox }, letter: p.letter, dark: false }; return r; };

await test("an untagged line's box holding set-aside lettering gets a region over it, erased", () => {
  const an = analysis([], [para(100, 100, 200, 40)]);
  const items = [item([95, 95, 210, 50], "Going in!!")];
  const { placements, regionIds } = layout(an, items);
  assert.equal(an.regions.length, 1);
  assert.ok(regionIds.has(an.regions[0].id));
  assert.equal(placements[0].tag, an.regions[0].id);
});

await test("the rest of a tagged title is added to its region (one line of two found)", () => {
  const found = para(100, 100, 60, 200, { vertical: true }), rest = para(40, 100, 55, 120, { vertical: true });
  const an = analysis([block(1, found)], [found, rest]);
  layout(an, [item([35, 95, 130, 210], "True Kiss Big Operation", 1)]);
  assert.equal(an.regions.length, 1);
  const r = an.regions[0];
  assert.ok(r.box.x <= 40 && r.box.x + r.box.w >= 160, JSON.stringify(r.box));
  assert.equal(r.ref.parts.length, 2);
  assert.deepEqual(r.ref.lineAdopted, [false, true]);
});

await test("lettering two boxes reach goes to the one that fits it: a long caption's box does not take the credits", () => {
  const caption = para(100, 500, 400, 30), credits = [para(820, 495, 150, 10), para(820, 512, 120, 18)];
  const an = analysis([block(1, caption)], [caption, ...credits]);
  const items = [item([95, 495, 870, 40], "Using the skill, I'll live...", 1), item([815, 492, 160, 14], "HAMO & AOBA PRESENTS"), item([815, 510, 128, 22], "[Character Design]")];
  const { placements } = layout(an, items);
  assert.equal(an.regions.find((r) => r.id === 1).box.w, 400, "the caption's region kept its own extent");
  assert.equal(placements.length, 3, "three lines, three placements (none joined)");
});

await test("a box sliced into three or more lines and set aside (a logo) is not adopted", () => {
  const slices = [0, 1, 2, 3].map((i) => para(100, 100 + i * 40, 800, 40, { pieces: 4 }));
  const an = analysis([], slices);
  layout(an, [item([110, 90, 760, 170], "ONE PIECE")]);
  assert.equal(an.regions.length, 0);
});

await test("a line in a bubble adopts nothing; lettering far above dialogue size is never adopted", () => {
  const bubble = { id: 1, kind: "bubble", ref: { blocks: [para(400, 400, 80, 30)], fill: null }, box: { x: 380, y: 380, w: 140, h: 80 }, letter: 24 };
  const beside = para(530, 400, 80, 30), huge = para(100, 700, 600, 150, { letter: 150 });
  const an = analysis([bubble], [beside, huge]);
  layout(an, [item([380, 390, 240, 50], "Hi", 1, "bubble"), item([90, 690, 620, 170], "BOOM")]);
  assert.equal(an.regions.length, 1);
});

await test("a loose box straddling two regions does not override the stamp", () => {
  const a = para(100, 100, 100, 160), b = para(230, 100, 160, 160);
  const an = analysis([block(1, a), block(2, b)], [a, b]);
  // centre just inside region 2, but nearly half of the box on region 1
  const { placements } = layout(an, [item([150, 140, 110, 80], "Nobody answers!", 1)]);
  assert.equal(placements[0].tag, 1);
});

// ---- coloured lettering, through the real analysis and eraser ----
loadLettering();
const page = (draw) => { const c = createCanvas(900, 600), x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 900, 600); draw(x); return x.getImageData(0, 0, 900, 600); };
const colourLeft = (img, box, rgb) => { let n = 0; for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { const p = (y * img.width + x) * 4; if (Math.abs(img.data[p] - rgb[0]) < 50 && Math.abs(img.data[p + 1] - rgb[1]) < 50 && Math.abs(img.data[p + 2] - rgb[2]) < 50) n++; } return n; };
for (const [name, rgb] of [["blue", [60, 140, 230]], ["orange", [250, 140, 20]]]) {
  await test(`${name} lettering on white, which the analysis drops, is erased whole on Claude's box`, async () => {
    const img = page((x) => { x.fillStyle = `rgb(${rgb})`; x.font = "bold 44px 'Comic Neue', sans-serif"; x.fillText("WE LEAVE AT DAWN", 160, 300); });
    const area = { x: 130, y: 240, w: 640, h: 90 };
    const before = colourLeft(img, area, rgb);
    const an = await analyzePage(img);
    // Claude's answer: the line, untagged (no region was stamped on it), its box loosely round the text
    const items = [{ tag: null, box: [150 / 900, 255 / 600, 410 / 900, 60 / 600], text: "Nous partons à l'aube", size: "normal", kind: "sign" }];
    const { regionIds } = layout(an, items);
    const out = erase(cv, img, an, regionIds).image;
    const after = colourLeft(out, area, rgb);
    an.dispose();
    assert.ok(before > 500, `the page has ${name} lettering (${before} px)`);
    assert.ok(after < 0.05 * before, `${after} of ${before} ${name} pixels left`);
  });
}

console.log(`\nFREETEXT TESTS PASSED (${passed})`);
