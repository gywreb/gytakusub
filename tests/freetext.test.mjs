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

await test("a line with nothing to translate (only dots or marks) is left as drawn: not erased, not drawn again", () => {
  const dots = para(100, 100, 60, 20), marks = para(300, 100, 30, 40);
  const words = { id: 1, kind: "bubble", ref: { blocks: [para(500, 400, 80, 30)], fill: null }, box: { x: 480, y: 380, w: 140, h: 80 }, letter: 24 };
  const an = analysis([block(2, dots), words], [dots, marks]);
  const { placements, regionIds } = layout(an, [item([95, 95, 70, 30], "……", 2), item([295, 95, 40, 50], "!?"), item([480, 390, 140, 50], "Wait…", 1, "bubble"), item([480, 430, 140, 20], "…♪", 1, "bubble")]);
  assert.deepEqual([...regionIds], [1]);
  assert.deepEqual(placements.map((p) => p.text), ["Wait…"]);
  assert.equal(an.regions.length, 2, "the marks' lettering is not adopted");
});

// bubbles whose shape is their box
const bubbleAt = (id, box, blocks) => ({ id, kind: "bubble", ref: { blocks, fill: null }, box, letter: 24, dark: false });
const boxShapes = (an) => { an.insideOf = (id) => { const b = an.regions.find((q) => q.id === id).box; return (x, y) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h; }; return an; };

await test("two lines given one bubble's stamp: the one boxed on a neighbour's lettering goes to that neighbour", () => {
  const a = para(120, 110, 80, 40, { bubble: 1, region: 1 }), b = para(120, 230, 80, 40, { bubble: 2, region: 2 });
  const an = boxShapes(analysis([bubbleAt(1, { x: 100, y: 90, w: 120, h: 100 }, [a]), bubbleAt(2, { x: 100, y: 210, w: 120, h: 100 }, [b])], [a, b]));
  const { placements, regionIds } = layout(an, [item([110, 100, 100, 60], "Love stuff, coffee, milk", 1, "bubble"), item([110, 170, 100, 90], "Well then, make her buy them", 1, "bubble")]);
  assert.deepEqual([...regionIds].sort(), [1, 2]);
  assert.deepEqual(placements.map((p) => [p.tag, p.text.split(" ")[0]]).sort(), [[1, "Love"], [2, "Well"]]);
});

await test("two lines given one bubble's stamp, one boxed off the bubble: that one takes the lettering under its box", () => {
  const own = para(400, 420, 80, 30, { bubble: 1, region: 1 }), shout = para(400, 300, 90, 40);
  const an = boxShapes(analysis([bubbleAt(1, { x: 380, y: 400, w: 140, h: 80 }, [own])], [own, shout]));
  const { placements, regionIds } = layout(an, [item([390, 415, 100, 40], "Ah, okay!", 1, "bubble"), item([395, 295, 100, 50], "Eh?!", 1, "bubble")]);
  assert.equal(an.regions.length, 2);
  const eh = placements.find((p) => p.text === "Eh?!");
  assert.equal(eh.tag, an.regions[1].id);
  assert.ok(regionIds.has(an.regions[1].id));
  // one line alone with its box drifted off the bubble keeps the stamp, and takes nothing beside it
  const an2 = boxShapes(analysis([bubbleAt(1, { x: 380, y: 400, w: 140, h: 80 }, [own])], [own, shout]));
  layout(an2, [item([395, 295, 100, 50], "Eh?!", 1, "bubble")]);
  assert.equal(an2.regions.length, 1);
});

await test("in a bubble with two lines, the one with nothing to translate keeps its lettering: the other's text keeps off it", () => {
  const dots = para(450, 100, 40, 90, { bubble: 1, region: 1, vertical: true }), ah = para(430, 210, 50, 80, { bubble: 1, region: 1, vertical: true });
  const an = boxShapes(analysis([bubbleAt(1, { x: 410, y: 85, w: 100, h: 230 }, [dots, ah])], [dots, ah]));
  const { placements, regionIds } = layout(an, [item([460, 125, 40, 60], "......!", 1, "bubble"), item([425, 255, 60, 50], "Ah...", 1, "bubble")]);
  assert.deepEqual([...regionIds], [1]);
  assert.deepEqual(placements.map((p) => p.text), ["Ah..."]);
  assert.deepEqual(an.regions[0].kept, [dots.gbox]);
  const r = placements[0].rect, k = dots.gbox;
  assert.ok(r.y >= k.y + k.h || r.x >= k.x + k.w || r.x + r.w <= k.x, `text ${JSON.stringify(r)} over the kept dots`);
});

await test("a line Claude gave back as drawn (`same`: a name, credits) keeps its lettering like a line of only marks", () => {
  const name = para(450, 100, 40, 90, { bubble: 1, region: 1, vertical: true }), ah = para(430, 210, 50, 80, { bubble: 1, region: 1, vertical: true });
  const an = boxShapes(analysis([bubbleAt(1, { x: 410, y: 85, w: 100, h: 230 }, [name, ah])], [name, ah]));
  const { placements, regionIds } = layout(an, [{ ...item([460, 125, 40, 60], "Luke...", 1, "bubble"), same: true }, item([425, 255, 60, 50], "Ah...", 1, "bubble")]);
  assert.deepEqual([...regionIds], [1]);
  assert.deepEqual(placements.map((p) => p.text), ["Ah..."]);
  assert.deepEqual(an.regions[0].kept, [name.gbox]);
  // alone in its bubble: the bubble is not translated at all
  const an2 = boxShapes(analysis([bubbleAt(1, { x: 410, y: 85, w: 100, h: 230 }, [name])], [name]));
  const two = layout(an2, [{ ...item([460, 125, 40, 60], "TRANSLATOR Sebasdgd", 1, "bubble"), same: true }]);
  assert.equal(two.regionIds.size, 0); assert.equal(two.placements.length, 0);
});

await test("a tight box on the core of big lettering takes it; a small box in a large paragraph does not", () => {
  const shout = para(100, 100, 110, 70, { letter: 60 });
  const an = analysis([], [shout]);
  layout(an, [item([115, 110, 80, 30], "Eh?!")]);
  assert.equal(an.regions.length, 1);
  const credits = para(100, 400, 400, 200);
  const an2 = analysis([], [credits]);
  layout(an2, [item([150, 450, 80, 30], "Translator")]);
  assert.equal(an2.regions.length, 0);
  // and a corner of a large box (the rest of a title not found) is not taken for the whole line
  const corner = para(600, 100, 50, 45);
  const an3 = analysis([], [corner]);
  layout(an3, [item([500, 0, 250, 320], "The Tearing")]);
  assert.equal(an3.regions.length, 0);
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
