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
import { layout, roomShape, erode } from "../extension/engine/layout.js";
import { LAYOUT } from "../extension/engine/tuning.js";
import { erase, penOf, ofPen } from "../extension/engine/erase.js";
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

await test("with the learned mask, an untagged line's box holding nothing found is erased as a region of its own; the line is placed as without it", () => {
  const items = () => [item([300, 300, 200, 60], "Over here!"), item([600, 600, 10, 10], "Hm."), item([100, 100, 200, 50], "Tagged", 7)];
  const base = analysis([block(7, para(100, 100, 200, 40))], []), without = layout(base, items());
  const an = analysis([block(7, para(100, 100, 200, 40))], []), withBoxes = layout(an, items(), { readerBoxes: true });
  const made = an.regions.filter((r) => r.fromBox);
  // the first line only: the second's box is under a letter, the third is tagged to a region
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].box, { x: 300, y: 300, w: 200, h: 60 });
  assert.ok(withBoxes.regionIds.has(made[0].id));
  assert.deepEqual(withBoxes.placements, without.placements, "placed as without it");
  assert.ok(!withBoxes.placements.some((p) => p.tag === made[0].id));
  assert.equal(base.regions.filter((r) => r.fromBox).length, 0, "not without the learned mask");
  assert.equal(an.fromBoxes, undefined);
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

await test("a line kept as drawn keeps its own small block, even when Claude's box only grazes it or misses it", () => {
  // a joined bubble as on a 2.14.0 page: "AH..." in a small lobe (a block too small to anchor a
  // translation to) above the main lettering; Claude's box for "AH..." lies beside it
  const ah = para(260, 115, 39, 14, { bubble: 1, region: 1, letter: 8 }), main = para(203, 149, 73, 98, { bubble: 1, region: 1, letter: 12 });
  const bubble = () => ({ ...bubbleAt(1, { x: 183, y: 94, w: 128, h: 177 }, [ah, main]), letter: 12 });
  for (const [label, box] of [["grazed", [213, 127, 50, 20]], ["missed", [210, 130, 45, 12]]]) {
    const an = boxShapes(analysis([bubble()], [ah, main]));
    const { placements } = layout(an, [{ ...item(box, "Ah...", 1, "bubble"), same: true }, item([188, 146, 75, 108], "Miss, bring another beer, please.", 1, "bubble")]);
    assert.deepEqual(an.regions[0].kept, [ah.gbox], `${label}: the lettering kept is "AH..."'s own`);
    assert.deepEqual(placements.map((p) => p.text), ["Miss, bring another beer, please."]);
  }
});

await test("a line in an oval gets the oval's room row by row, short of its outline (2.14.1)", () => {
  const box = { x: 100, y: 100, w: 120, h: 180 }, words = para(140, 150, 40, 80, { bubble: 1, region: 1 });
  const an = analysis([bubbleAt(1, box, [words])], [words]);
  an.insideOf = () => (x, y) => ((x - 160) / 60) ** 2 + ((y - 190) / 90) ** 2 <= 1;
  const [p] = layout(an, [item([140, 150, 40, 80], "Does that mean it's because I'm an idiot?", 1, "bubble")]).placements;
  assert.ok(p.shape, "a shape");
  const row = (y) => p.shape.half[Math.floor((y - p.shape.top) / p.shape.step)];
  const edge = Math.max(LAYOUT.edgeMinPx, LAYOUT.edgeLetters * 24), cx = p.shape.cx;
  const inOval = (y) => Math.min(cx - (160 - 60 * Math.sqrt(1 - ((y - 190) / 90) ** 2)), 160 + 60 * Math.sqrt(1 - ((y - 190) / 90) ** 2) - cx);
  for (const y of [130, 160, 190, 220, 250]) assert.ok(Math.abs(row(y) - (inOval(y) - edge)) <= 2.5, `row ${y}: ${row(y)} against ${(inOval(y) - edge).toFixed(1)}`);
  assert.ok(row(190) > p.rect.w / 2, "wider than the box at the oval's middle");
});

await test("a slanted bubble: the room row by row stays inside its outline where the lettering's box reaches past it (2.15)", () => {
  // a parallelogram leaning right 0.5 px per row, 120 wide and 160 tall; the lettering's box (as the
  // detector draws it, upright) has its top-left and bottom-right corners past the slanted sides
  const inside = (x, y) => y >= 100 && y < 260 && x >= 100 + (y - 100) * 0.5 && x < 220 + (y - 100) * 0.5;
  const words = para(150, 120, 100, 120, { bubble: 1, region: 1 });
  const an = analysis([bubbleAt(1, { x: 100, y: 100, w: 200, h: 160 }, [words])], [words]);
  an.insideOf = () => inside;
  const [p] = layout(an, [item([150, 120, 100, 120], "It's leaning, the whole thing is leaning!", 1, "bubble")]).placements;
  assert.ok(p.shape, "a shape");
  const cx = p.shape.cx;
  p.shape.half.forEach((h, k) => {
    if (!h) return;
    const y = p.shape.top + (k + 0.5) * p.shape.step;
    assert.ok(inside(cx - h, y) && inside(cx + h, y), `row ${y.toFixed(0)}: ${(cx - h).toFixed(0)} to ${(cx + h).toFixed(0)} past the outline`);
  });
});

await test("a steeply slanted bubble whose lettering's box reaches past its sides, its lines inside: a bubble, not art (2.15)", () => {
  // a parallelogram leaning 1 px per row; the block's upright box has its top-left and bottom-right
  // corners well past the slanted sides (judged on the box, under 85% held: taken for art and set
  // to the box, across the slant), while each line, centred on the bubble at its height, is inside
  const inside = (x, y) => y >= 100 && y < 260 && x >= 100 + (y - 100) && x < 230 + (y - 100);
  const rows = [0, 1, 2, 3].map((k) => ({ x: 155 + 30 + 34 * k - 40, y: 120 + 34 * k, w: 80, h: 26 }));
  const words = para(145, 120, 202, 128, { bubble: 1, region: 1, parts: rows, lineLetters: rows.map(() => 24) });
  const an = analysis([bubbleAt(1, { x: 100, y: 100, w: 290, h: 160 }, [words])], [words]);
  an.insideOf = () => inside;
  const boxHeld = (() => { let n = 0, k = 0; for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { n++; if (inside(145 + (i + 0.5) * 202 / 8, 120 + (j + 0.5) * 128 / 8)) k++; } return k / n; })();
  assert.ok(boxHeld < 0.85, `the guard: the block's box is ${boxHeld.toFixed(2)} held`);
  const [p] = layout(an, [item([145, 120, 202, 128], "It's leaning, the whole thing is leaning!", 1, "bubble")]).placements;
  assert.ok(p.shape, "a shape, not the box");
  const cx = p.shape.cx;
  p.shape.half.forEach((h, k) => {
    if (!h) return;
    const y = p.shape.top + (k + 0.5) * p.shape.step;
    assert.ok(inside(cx - h, y) && inside(cx + h, y), `row ${y.toFixed(0)}: ${(cx - h).toFixed(0)} to ${(cx + h).toFixed(0)} past the outline`);
  });
});

await test("a 'bubble' that does not hold the lettering (light art around text drawn over it): the text is set to the lettering's box (2.15)", () => {
  // the interior found is a small patch beside the lettering; the shape alone would set the text
  // tiny, and the art's lines around it are no outline: the box is the room, with no shape
  const inside = (x, y) => x >= 100 && x < 140 && y >= 100 && y < 260;
  const words = para(110, 110, 120, 140, { bubble: 1, region: 1 });
  const an = analysis([bubbleAt(1, { x: 100, y: 100, w: 140, h: 160 }, [words])], [words]);
  an.insideOf = () => inside;
  const [p] = layout(an, [item([110, 110, 120, 140], "Over the art", 1, "bubble")]).placements;
  assert.ok(!p.shape && !p.bound && !p.alt, "no shape: the box is the room");
  assert.ok(p.rect.x <= 110 && p.rect.x + p.rect.w >= 230 && p.rect.y <= 110 && p.rect.y + p.rect.h >= 250, `the box ${JSON.stringify(p.rect)} holds the lettering's (110, 110, 120 × 140)`);
});

await test("two captions' lettering merged into one paragraph: each line takes its own lines of it (2.15)", () => {
  // an L-shaped caption: one text top right, the other bottom left, their lines merged by the analysis
  const lines = [[300, 110], [300, 140], [300, 170], [300, 200], [130, 220], [130, 250], [130, 280]].map(([x, y]) => ({ x, y, w: 120, h: 22 }));
  const merged = para(130, 110, 290, 192, { bubble: 1, region: 1, parts: lines, lineLetters: lines.map(() => 24) });
  const an = boxShapes(analysis([bubbleAt(1, { x: 110, y: 90, w: 330, h: 230 }, [merged])], [merged]));
  const { placements } = layout(an, [item([295, 105, 130, 120], "First, I need to leave the city", 1, "bubble"), item([125, 215, 130, 92], "Once I've lost them, I strike back", 1, "bubble")]);
  const first = placements.find((p) => p.text.startsWith("First")), then = placements.find((p) => p.text.startsWith("Once"));
  const cx = (r) => r.x + r.w / 2;
  assert.ok(cx(first.rect) > 300 && cx(then.rect) < 270, `centres ${cx(first.rect).toFixed(0)} and ${cx(then.rect).toFixed(0)}`);
});

await test("two captions merged into one paragraph, Claude's first box over its first line only: each item takes a whole caption (2.15)", () => {
  // the same L-shaped caption; the first item's box covers the first caption's top line only, the
  // second's the rest of it and all of the second caption. Line by line, the first caption's last three
  // lines went to the second item, and the first item's text was set in one line's room (page 6, 16 px)
  const lines = [[300, 110], [300, 140], [300, 170], [300, 200], [130, 220], [130, 250], [130, 280]].map(([x, y]) => ({ x, y, w: 120, h: 22 }));
  const merged = para(130, 110, 290, 192, { bubble: 1, region: 1, parts: lines, lineLetters: lines.map(() => 24) });
  const an = boxShapes(analysis([bubbleAt(1, { x: 110, y: 90, w: 330, h: 230 }, [merged])], [merged]));
  const { placements } = layout(an, [item([120, 105, 300, 28], "First, I need to leave the city", 1, "bubble"), item([120, 140, 300, 165], "Once I've lost them, I strike back", 1, "bubble")]);
  const first = placements.find((p) => p.text.startsWith("First")), then = placements.find((p) => p.text.startsWith("Once"));
  const cx = (r) => r.x + r.w / 2;
  assert.ok(first.rect.h >= 100 && cx(first.rect) > 300, `the first caption's room ${JSON.stringify(first.rect)}: all four of its lines (one line's, 40 px tall, before)`);
  assert.ok(cx(then.rect) < 270 && then.rect.x + then.rect.w <= 300, `the second caption's room ${JSON.stringify(then.rect)}: its own lines (across both captions, before)`);
});

await test("two boxes one region, a border across it: each line's room stays its side of the border (2.15)", () => {
  // one white region 200 × 100 (the bubble model's mask over two caption boxes drawn side by side); the
  // left box's border at x = 170 runs across it from top to bottom, in the ink mask: not midway between
  // the two lettering, where the region is cut between speakers anyway
  const W2 = 400, H2 = 300, inkData = new Uint8Array(W2 * H2);
  for (let y = 100; y < 200; y++) for (let x = 169; x < 172; x++) inkData[y * W2 + x] = 255;
  const left = para(110, 130, 40, 40, { bubble: 1, region: 1 }), right = para(240, 130, 40, 40, { bubble: 1, region: 1 });
  const an = { ...analysis([bubbleAt(1, { x: 100, y: 100, w: 200, h: 100 }, [left, right])], [left, right]), W: W2, H: H2 };
  an.insideOf = () => (x, y) => x >= 100 && x < 300 && y >= 100 && y < 200;
  an.polarities = [{ dark: false, inkMask: { data: inkData, cols: W2, rows: H2 } }, { dark: true, inkMask: { data: new Uint8Array(W2 * H2), cols: W2, rows: H2 } }];
  const { placements } = layout(an, [item([105, 125, 50, 50], "Left side", 1, "bubble"), item([235, 125, 50, 50], "Right side", 1, "bubble")]);
  for (const p of placements) {
    const cx = p.shape.cx, side = p.text.startsWith("Left") ? -1 : 1;
    for (const h of p.shape.half) if (h) assert.ok(side < 0 ? cx + h < 169 : cx - h > 171, `${p.text}: ${(cx - h).toFixed(0)} to ${(cx + h).toFixed(0)} across the border`);
  }
});

await test("lettering Claude read as Hangul is set at its syllables' height; other lettering at its letter (2.15)", () => {
  const words = para(140, 150, 60, 60, { bubble: 1, region: 1, letter: 20, lineLetters: [20], syllable: 24, lineSyllables: [24] });
  const at = (source) => {
    const an = boxShapes(analysis([{ ...bubbleAt(1, { x: 120, y: 130, w: 100, h: 100 }, [words]), letter: 20 }], [words]));
    return layout(an, [{ ...item([140, 150, 60, 60], "What is it?", 1, "bubble"), source }]).placements[0].letter;
  };
  assert.equal(at("뭐야?"), 24);
  assert.equal(at("なに？"), 20);
  assert.equal(at("Quoi ?"), 20);
  assert.equal(at(undefined), 20);
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

await test("lettering a translated line's box holds, that no line names, is erased with it (one line found as two regions)", () => {
  // a shout found as two columns, two regions; Claude's one line stamped on the first
  const a = para(300, 100, 60, 200, { vertical: true }), b = para(230, 110, 60, 180, { vertical: true });
  const an = analysis([block(1, a), block(2, b)], [a, b]);
  const { placements, regionIds } = layout(an, [item([225, 95, 140, 210], "Ahem!! Ahem!!", 1)]);
  assert.ok(regionIds.has(1) && regionIds.has(2), [...regionIds].join());
  assert.equal(placements.length, 1);
  // never a region another line names, nor one only grazed by the box
  const c = para(230, 110, 60, 180, { vertical: true });
  const an2 = analysis([block(1, a), block(2, c)], [a, c]);
  const { regionIds: ids2 } = layout(an2, [item([225, 95, 140, 210], "Ahem!!", 1), { ...item([230, 110, 60, 180], "", 2), kind: "sfx" }]);
  assert.ok(!ids2.has(2), "a sound effect's region stays");
  const an3 = analysis([block(1, a), block(2, para(330, 110, 120, 180, { vertical: true }))], []);
  const { regionIds: ids3 } = layout(an3, [item([295, 95, 70, 210], "Ahem!!", 1)]);
  assert.ok(!ids3.has(2), "a region the box only grazes stays");
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

await test("black lettering in a white outline over dark art, found only on Claude's box, is erased letter and outline", async () => {
  const img = page((x) => {
    x.fillStyle = "#111"; x.fillRect(300, 100, 400, 400); // dark art
    x.font = "bold 40px 'Comic Neue', sans-serif"; x.lineJoin = "round";
    x.strokeStyle = "#fff"; x.lineWidth = 8; x.strokeText("RUN NOW", 360, 320);
    x.fillStyle = "#000"; x.fillText("RUN NOW", 360, 320);
  });
  const area = { x: 350, y: 280, w: 230, h: 55 };
  const white = (im) => { let n = 0; for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) { const p = (y * im.width + x) * 4; if (im.data[p] > 200) n++; } return n; };
  const before = white(img);
  const an = await analyzePage(img);
  const items = [{ tag: null, box: [352 / 900, 282 / 600, 226 / 900, 50 / 600], text: "Corre ya", size: "normal", kind: "sign" }];
  const { regionIds } = layout(an, items);
  const out = erase(cv, img, an, regionIds, { outline: 0.3 }).image;
  an.dispose();
  assert.ok(before > 800, `the outline is there (${before} px)`);
  assert.ok(white(out) < 0.25 * before, `${white(out)} of ${before} outline pixels left`);
});

await test("a long vowel mark run past the detector's box in a bubble is erased with its column", async () => {
  const img = page((x) => {
    x.fillStyle = "#fff"; x.strokeStyle = "#000"; x.lineWidth = 4;
    x.beginPath(); x.ellipse(450, 300, 110, 230, 0, 0, 2 * Math.PI); x.fill(); x.stroke();
    x.fillStyle = "#000"; x.font = "36px 'Noto Sans CJK JP', sans-serif";
    ["え", "っ"].forEach((ch, i) => x.fillText(ch, 432, 150 + i * 42));
    x.fillRect(447, 205, 6, 180); // the stretched mark (apart from the glyphs), far past two glyphs' length
  });
  const an = await analyzePage(img);
  const bub = an.regions.find((r) => r.kind === "bubble");
  assert.ok(bub, "the bubble is found");
  const { regionIds } = layout(an, [{ tag: bub.id, box: [425 / 900, 115 / 600, 50 / 900, 280 / 600], text: "Ehhh?!", size: "normal", kind: "bubble" }]);
  const out = erase(cv, img, an, regionIds).image;
  an.dispose();
  let dark = 0; for (let y = 300; y < 380; y++) for (let x = 444; x < 456; x++) if (out.data[(y * 900 + x) * 4] < 100) dark++;
  assert.ok(dark < 40, `${dark} dark pixels of the mark's lower part left`);
});

await test("lettering close to a white bubble's outline is erased without the outline (3.0)", async () => {
  // the eraser grows over lettering outlines by a share of the letter size; the bubble model's
  // interior takes in the bubble's own outline, and the growth took the outline beside the column
  const ring = (x, y) => Math.abs(Math.hypot((x - 450) / 70, (y - 300) / 200) - 1) < 0.02;
  const img = page((x) => {
    x.fillStyle = "#fff"; x.strokeStyle = "#000"; x.lineWidth = 5;
    x.beginPath(); x.ellipse(450, 300, 70, 200, 0, 0, 2 * Math.PI); x.fill(); x.stroke();
    x.fillStyle = "#000"; x.font = "34px 'Noto Sans CJK JP', sans-serif";
    ["そ", "う", "だ", "よ"].forEach((ch, i) => x.fillText(ch, 472, 225 + i * 38)); // its right side ~8 px off the outline
  });
  const outline = (im) => { let n = 0; for (let y = 190; y < 370; y++) for (let x = 480; x < 530; x++) if (ring(x, y) && im.data[(y * 900 + x) * 4] < 100) n++; return n; };
  const before = outline(img);
  const an = await analyzePage(img);
  const bub = an.regions.find((r) => r.kind === "bubble");
  assert.ok(bub, "the bubble is found");
  const { regionIds } = layout(an, [{ tag: bub.id, box: [468 / 900, 190 / 600, 40 / 900, 160 / 600], text: "That's it!", size: "normal", kind: "bubble" }]);
  const out = erase(cv, img, an, regionIds, { outline: 0.3 }).image;
  an.dispose();
  let letters = 0; for (let y = 195; y < 365; y++) for (let x = 472; x < 506; x++) if (!ring(x, y) && out.data[(y * 900 + x) * 4] < 100) letters++;
  assert.ok(before > 100, `the outline is there (${before} px)`);
  assert.ok(outline(out) > 0.9 * before, `${outline(out)} of ${before} outline pixels left`);
  assert.ok(letters < 40, `${letters} lettering pixels left`);
});

await test("lettering the image's edge cuts through is erased by the rules: the image's edge is no edge of a line's window (3.2.1)", async () => {
  // a webtoon's images part anywhere, through lettering too; the window round a line ends at the
  // image's edge, and a letter the cut runs through touched it as a stroke crossing the window does
  const E = { cx: 450, cy: 10, rx: 230, ry: 120 };
  const img = page((x) => {
    x.fillStyle = "#fff"; x.strokeStyle = "#000"; x.lineWidth = 4;
    x.beginPath(); x.ellipse(E.cx, E.cy, E.rx, E.ry, 0, 0, 2 * Math.PI); x.fill(); x.stroke();
    x.fillStyle = "#000"; x.font = "bold 34px 'Gytakusub Comic'"; x.textBaseline = "top";
    x.fillText("WAIT FOR ME", 340, -9); x.fillText("PLEASE!", 380, 32);
    x.fillRect(318, 0, 6, 100); // a stroke of art from the image's edge down through the lines and past them
  });
  const inner = (X, Y) => ((X - E.cx) / (E.rx - 8)) ** 2 + ((Y - E.cy) / (E.ry - 8)) ** 2 <= 1;
  const an = await analyzePage(img);
  const reg = an.regions.find((r) => r.box.y < 10 && r.box.x < 450 && r.box.x + r.box.w > 450);
  assert.ok(reg, "the lettering's region is found");
  const { regionIds } = layout(an, [{ tag: reg.id, box: [335 / 900, 0, 240 / 900, 70 / 600], text: "Wait for me, please!", size: "normal", kind: reg.kind === "bubble" ? "bubble" : "sign" }]);
  const out = erase(cv, img, an, regionIds).image;
  an.dispose();
  let letters = 0, top = 0, stroke = 0;
  for (let y = 0; y < 70; y++) for (let x = 335; x < 580; x++) if (inner(x, y) && out.data[(y * 900 + x) * 4] < 100) { letters++; if (y < 6) top++; }
  for (let y = 0; y < 100; y++) for (let x = 318; x < 324; x++) if (out.data[(y * 900 + x) * 4] < 100) stroke++;
  assert.ok(letters < 40, `${letters} lettering pixels left (${top} in the rows the cut runs by)`);
  assert.ok(stroke > 0.9 * 600, `${stroke} of 600 pixels of the stroke left: it crosses its window's far side`);
});

await test("a stroke the image's edge cuts, in a line's window but off its box, is left: past the edge its size isn't seen (3.2.1)", () => {
  // hair over a column at the top of a real page (Manga109, looked at): it passes for a mark of the
  // line by its pen and size; the line's own box (here given) says what lettering is
  const img = page((x) => {
    x.fillStyle = "#000"; x.font = "36px 'Noto Sans CJK JP', sans-serif";
    ["な", "に", "が", "あ"].forEach((ch, i) => x.fillText(ch, 432, 44 + i * 40));
    x.fillRect(471, 0, 4, 8); // a stroke of art the image's top cuts, beside the column's box, in its window
  });
  const ink = new cv.Mat(600, 900, cv.CV_8UC1, new cv.Scalar(0)), none = new cv.Mat(600, 900, cv.CV_8UC1, new cv.Scalar(0));
  for (let i = 0; i < 900 * 600; i++) if (img.data[i * 4] < 128) ink.data[i] = 255;
  const g = { x: 434, y: 6, w: 33, h: 160 }; // the column's box: its window reaches the image's top
  const an = { W: 900, H: 600, letter: 29, learned: true, lines: [], polarities: [{ dark: false, inkMask: ink }, { dark: true, inkMask: none }], insideOf: () => null,
    regions: [{ id: 1, kind: "block", letter: 29, dark: false, box: g, ref: { gbox: g, letter: 29, vertical: true, parts: [g], lineBoxes: [g] } }] };
  const out = erase(cv, img, an, new Set([1])).image;
  ink.delete(); none.delete();
  let stroke = 0, letters = 0;
  for (let y = 0; y < 8; y++) for (let x = 471; x < 475; x++) if (out.data[(y * 900 + x) * 4] < 100) stroke++;
  for (let y = 8; y < 170; y++) for (let x = 425; x < 470; x++) if (out.data[(y * 900 + x) * 4] < 100) letters++;
  assert.ok(letters < 20, `${letters} lettering pixels left`);
  assert.equal(stroke, 32, `${stroke} of 32 pixels of the stroke left`);
});

await test("a mark swept up beside a line is its lettering only when drawn with its pen; a thin pen judges nothing (3.1)", () => {
  // brush lettering: strokes about 20 px thick (most of the ink), a few thin hairs at their ends
  const pen = penOf([{ t: 22, a: 5000 }, { t: 20, a: 4000 }, { t: 3, a: 100 }]);
  assert.ok(pen >= 20 && pen <= 22, `the pen ${pen}`);
  assert.ok(!ofPen(3, pen), "a panel's frame line, 3 px, beside it is art");
  assert.ok(ofPen(12, pen), "a dash of the same brush, thinner, is lettering");
  // dialogue: a pen of 4 px; a 2 px mark is not judged (the share would be under 2 px)
  assert.ok(ofPen(2, penOf([{ t: 4, a: 300 }])), "a thin pen judges nothing");
  assert.equal(penOf([]), 0);
});

// ---------- 3.0: the margin in every direction, each row read over all its pixel rows ----------
await test("erode: a room less every cell closer than r px to its edge (Euclidean)", () => {
  const w = 21, h = 21, g = new Uint8Array(w * h).fill(1);
  const k = erode(g, w, h, 3);
  // a cell's edge at least 3 px from the border's (the cells just outside the grid): columns 3..17 kept
  assert.equal(k[10 * w + 2], 0); assert.equal(k[10 * w + 3], 1); assert.equal(k[10 * w + 17], 1); assert.equal(k[10 * w + 18], 0);
  assert.equal(k[3 * w + 3], 1, "the corner cell 3 px in on both axes is kept");
  const disc = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) disc[y * w + x] = (x - 10) ** 2 + (y - 10) ** 2 <= 81 ? 1 : 0;
  const kd = erode(disc, w, h, 3); let n = 0; for (const v of kd) n += v;
  assert.ok(n > 0 && n < 120, `a disc of radius 9 eroded by 3 keeps about a disc of radius 5 (${n} cells)`);
});

await test("a room's margin is kept above and below too: no row within the margin of a curved top or bottom", () => {
  // an ellipse 160 × 80: before 3.0 the margin came off the sides only, and the first row sat on the top curve
  const inside = (x, y) => ((x - 100) / 80) ** 2 + ((y - 60) / 40) ** 2 <= 1;
  const bbox = { x: 20, y: 20, w: 160, h: 80 }, rect = { x: 70, y: 45, w: 60, h: 30 }, edge = 4;
  const s = roomShape(inside, bbox, rect, [], [], edge);
  assert.ok(s.top >= 20 + edge, `the first row starts ${s.top - 20} px under the top, the margin is ${edge}`);
  assert.ok(s.top + s.half.length * s.step <= 100 - edge, "the last row ends the margin over the bottom");
  // and every row's half-width keeps the margin from the outline over all the rows it spans
  for (let k = 0; k < s.half.length; k++) {
    if (!s.half[k]) continue;
    for (let y = s.top + k * s.step; y < s.top + (k + 1) * s.step; y++) {
      const reach = 80 * Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 60) / 40) ** 2));
      assert.ok(s.half[k] <= reach - edge + 1, `row ${k}: half ${s.half[k]} at y ${y}, room ${reach.toFixed(1)}`);
    }
  }
});

await test("a room keeps its own centre line: lettering off a bubble's middle offers the text centred in the bubble", () => {
  const inside = (x, y) => ((x - 100) / 80) ** 2 + ((y - 60) / 40) ** 2 <= 1;
  const s = roomShape(inside, { x: 20, y: 20, w: 160, h: 80 }, { x: 40, y: 45, w: 50, h: 30 }, [], [], 3);
  assert.ok(Math.abs(s.axis - 100) <= 1.5, `the room's centre line at ${s.axis}, the bubble's at 100`);
  assert.ok(Math.abs(s.cx - 65) < 1e-9, "the shape itself stays on the text's centre line");
});

console.log(`\nFREETEXT TESTS PASSED (${passed})`);
