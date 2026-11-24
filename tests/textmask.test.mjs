// The learned text mask (engine/textmask.js, 3.2): its crops, the model on lettering it was never
// shown, and the eraser taking its mask in place of its rules.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createCanvas } from "canvas";
globalThis.require ??= createRequire(import.meta.url);
const { cv, analyzePage, textMasksFor } = await import("./cv-node.mjs");
const { textCrops, maskText, masksFor, textMasker, INPUT } = await import("../extension/engine/textmask.js");
const { createSession } = await import("../extension/engine/ort.js");
const { layout } = await import("../extension/engine/layout.js");
const { erase } = await import("../extension/engine/erase.js");
const { loadLettering } = await import("./lettering-setup.mjs");
loadLettering();

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log("ok -", name); };
const page = (draw, W = 900, H = 600) => { const c = createCanvas(W, H), x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); draw(x); return x.getImageData(0, 0, W, H); };

await test("crops: one per region erased, round its lines, padded by half a letter; none for a region not erased, nor a plain bubble", () => {
  const an = {
    regions: [
      { id: 1, kind: "bubble", letter: 20, box: { x: 40, y: 40, w: 200, h: 160 }, ref: { blocks: [{ gbox: { x: 100, y: 100, w: 80, h: 20 } }, { gbox: { x: 110, y: 130, w: 60, h: 20 } }] } },
      { id: 2, kind: "free", letter: 16, ref: { gbox: { x: 400, y: 50, w: 200, h: 120 }, parts: [{ x: 400, y: 50, w: 200, h: 18 }, { x: 420, y: 150, w: 150, h: 20 }] } },
      { id: 3, kind: "free", letter: 16, ref: { gbox: { x: 10, y: 10, w: 50, h: 20 } } },
    ],
    // a detector's line in the bubble reaching past its block (coloured lettering sized by its core)
    lines: [{ x: 95, y: 128, w: 90, h: 26 }], insideOf: (id) => (id === 1 ? (x, y) => x >= 40 && y >= 40 && x < 240 && y < 200 : null),
  };
  // the bubble's surface a gradient (a webtoon's dark bubble): the model's
  const toned = page((x) => { const g = x.createLinearGradient(40, 40, 240, 200); g.addColorStop(0, "#0b0506"); g.addColorStop(1, "#8a0d12"); x.fillStyle = g; x.fillRect(40, 40, 200, 160); });
  assert.deepEqual(textCrops(an, new Set([1, 2]), toned), [{ region: 1, x: 85, y: 90, w: 110, h: 74 }, { region: 2, x: 392, y: 42, w: 216, h: 136 }]);
  // plain white: the rules'
  assert.deepEqual(textCrops(an, new Set([1, 2]), page(() => {})).map((c) => c.region), [2]);
  // a crop at the page's edge stops there
  const edge = textCrops({ regions: [{ id: 4, kind: "free", letter: 20, ref: { gbox: { x: 0, y: 590, w: 40, h: 10 } } }], lines: [] }, new Set([4]), page(() => {}));
  assert.deepEqual(edge[0], { region: 4, x: 0, y: 580, w: 50, h: 20 });
});

const session = (await createSession(new Uint8Array(fs.readFileSync(new URL("../extension/vendor/textmask.onnx", import.meta.url))), { gpu: false })).session;
const info = JSON.parse(fs.readFileSync(new URL("../extension/vendor/textmask.json", import.meta.url), "utf8"));
const masker = textMasker(session, { threshold: info.threshold });

await test("the model: red lettering on a dark gradient is text, the gradient away from it is not", async () => {
  const img = page((x) => {
    const g = x.createLinearGradient(100, 100, 400, 260); g.addColorStop(0, "#0b0506"); g.addColorStop(1, "#8a0d12");
    x.fillStyle = g; x.fillRect(100, 100, 300, 160);
    x.fillStyle = "#ff2a2a"; x.font = "bold 30px 'Gytakusub Comic'";
    x.fillText("WHERE ARE", 160, 170); x.fillText("YOU GOING?", 155, 210);
  });
  const [m] = await maskText(masker, img, [{ region: 1, x: 120, y: 120, w: 260, h: 120 }]);
  // lettering pixels, and the gradient more than 4 px from any of them (a mask hugs its letters)
  const isRed = (X, Y) => { const p = (Y * img.width + X) * 4; return img.data[p] > 200 && img.data[p + 1] < 80; };
  const nearRed = (X, Y) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (isRed(X + dx, Y + dy)) return true; return false; };
  let red = 0, redHit = 0, ground = 0, groundHit = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const X = m.x + x, Y = m.y + y, v = m.mask[y * m.w + x];
    if (isRed(X, Y)) { red++; redHit += v; } else if (!nearRed(X, Y)) { ground++; groundHit += v; }
  }
  assert.ok(redHit > 0.9 * red, `${redHit} of ${red} lettering pixels`);
  assert.ok(groundHit < 0.02 * ground, `${groundHit} of ${ground} gradient pixels away from the letters`);
});

await test("a lettering's outline is in its mask whole: white round black letters on dark art, dark round white on grey", async () => {
  for (const [ground, outline, letters] of [["#111", "#fff", "#000"], ["#888", "#000", "#fff"]]) for (const lw of [4, 12]) {
    const img = page((x) => {
      x.fillStyle = ground; x.fillRect(300, 100, 400, 400);
      x.font = "bold 40px 'Gytakusub Comic'"; x.lineJoin = "round";
      x.strokeStyle = outline; x.lineWidth = lw; x.strokeText("RUN NOW", 360, 320);
      x.fillStyle = letters; x.fillText("RUN NOW", 360, 320);
    });
    const [m] = await maskText(masker, img, [{ region: 1, x: 330, y: 260, w: 280, h: 90 }]);
    const want = outline === "#fff" ? (p) => img.data[p] > 200 : (p) => img.data[p] < 60;
    let n = 0, hit = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const p = ((m.y + y) * img.width + m.x + x) * 4; if (want(p)) { n++; hit += m.mask[y * m.w + x]; } }
    assert.ok(n > 500 && hit > 0.97 * n, `${outline} outline ${lw}px: ${hit} of ${n} pixels in the mask`);
  }
});

await test("a region's mask is made once for its crop, and again when the layout adopts lines into it", async () => {
  const img = page((x) => { x.fillStyle = "#000"; x.font = "bold 26px 'Gytakusub Comic'"; x.fillText("FIRST LINE", 100, 120); x.fillText("SECOND LINE", 100, 160); x.fillText("A SIGN", 500, 300); });
  const an = { regions: [
    { id: 1, kind: "free", letter: 20, ref: { gbox: { x: 98, y: 100, w: 150, h: 26 } } },
    { id: 2, kind: "free", letter: 20, ref: { gbox: { x: 498, y: 280, w: 100, h: 26 } } },
  ], lines: [] };
  const cache = new Map(), ids = new Set([1, 2]);
  const first = await masksFor(masker, img, an, ids, cache);
  assert.equal(first.made, 2);
  // the prefill's masks again: none made
  const again = await masksFor(masker, img, an, ids, cache);
  assert.equal(again.made, 0);
  assert.ok(again.masks[1] === first.masks[1]);
  // the layout adopts the second line into region 1 (a new ref, a wider box): its mask is made again and takes the line
  an.regions[0].ref = { ...an.regions[0].ref, gbox: { x: 98, y: 100, w: 165, h: 66 }, parts: [{ x: 98, y: 100, w: 150, h: 26 }, { x: 98, y: 140, w: 165, h: 26 }] };
  const after = await masksFor(masker, img, an, ids, cache);
  assert.equal(after.made, 1, "only the region whose crop changed");
  assert.ok(after.masks[1] === first.masks[1], "the other keeps its mask");
  const m = after.masks[0]; let low = 0;
  for (let y = 140 - m.y; y < 166 - m.y; y++) for (let x = 0; x < m.w; x++) low += m.mask[y * m.w + x];
  assert.ok(low > 300, `${low} pixels of the adopted line in the mask`);
});

await test("a crop larger than the input is run scaled down, its mask at its own size", async () => {
  const img = page((x) => { x.fillStyle = "#000"; x.font = "bold 60px 'Gytakusub Comic'"; x.fillText("BIG TITLE", 100, 300); }, 900, 600);
  const [m] = await maskText(masker, img, [{ region: 1, x: 50, y: 200, w: 800, h: 160 }]);
  assert.equal(m.mask.length, 800 * 160);
  assert.ok(800 > INPUT);
  let hit = 0; for (const v of m.mask) hit += v;
  assert.ok(hit > 3000, `${hit} pixels of lettering found`);
});

// (the rules alone, 3.1, leave about a third of this lettering: measured, 807 of 2692 pixels)
await test("the eraser takes the learned mask in place of its rules: red lettering in a dark bubble is erased", async () => {
  const img = page((x) => {
    x.fillStyle = "#fff"; x.strokeStyle = "#000"; x.lineWidth = 4;
    x.beginPath(); x.ellipse(450, 300, 220, 130, 0, 0, 2 * Math.PI);
    const g = x.createLinearGradient(230, 170, 670, 430); g.addColorStop(0, "#0b0506"); g.addColorStop(1, "#8a0d12");
    x.fillStyle = g; x.fill(); x.strokeStyle = "#e0141c"; x.stroke();
    x.fillStyle = "#ff2a2a"; x.font = "bold 32px 'Gytakusub Comic'";
    x.fillText("I KNEW IT FROM", 330, 290); x.fillText("THE START.", 360, 330);
  });
  const reds = (im) => { let k = 0; for (let y = 250; y < 345; y++) for (let x = 320; x < 590; x++) { const p = (y * 900 + x) * 4; if (im.data[p] > 200 && im.data[p + 1] < 80) k++; } return k; };
  const an = await analyzePage(img);
  const r = an.regions.find((q) => q.box.x < 450 && q.box.x + q.box.w > 450 && q.box.y < 300 && q.box.y + q.box.h > 300);
  assert.ok(r, "the lettering is found");
  const { regionIds } = layout(an, [{ tag: r.id, box: [320 / 900, 255 / 600, 270 / 900, 90 / 600], text: "I knew it from the start.", size: "normal", kind: "bubble" }]);
  const textMasks = await textMasksFor(img, an, regionIds);
  assert.ok(textMasks.length, "masked");
  const out = erase(cv, img, an, regionIds, { outline: 0.3, textMasks }).image;
  an.dispose();
  assert.ok(reds(out) < 0.05 * reds(img), `${reds(out)} of ${reds(img)} red lettering pixels left`);
});

await test("an area the model painted is not grown by the letter size: a wrong size leaves the art beside it", () => {
  // free text the analysis sized 53 px (a dark bubble read as one block) whose letters the model
  // painted: a bar 4 px thick. The art: thin lines 10 px from it.
  const img = page((x) => {
    x.fillStyle = "#123"; x.fillRect(100, 100, 400, 200);
    x.strokeStyle = "#fff"; x.lineWidth = 1; for (let y = 120; y < 300; y += 6) { x.beginPath(); x.moveTo(100, y); x.lineTo(500, y); x.stroke(); }
  });
  const mask = new Uint8Array(200 * 40); for (let y = 18; y < 22; y++) mask.fill(1, y * 200 + 20, y * 200 + 180);
  const crop = { region: 1, x: 200, y: 180, w: 200, h: 40, mask };
  const an = { W: 900, H: 600, letter: 17, learned: true, lines: [], polarities: [{}, {}], insideOf: () => null,
    regions: [{ id: 1, kind: "block", letter: 53, dark: false, box: { x: 220, y: 198, w: 160, h: 4 }, ref: { gbox: { x: 220, y: 198, w: 160, h: 4 }, letter: 53 } }] };
  const er = erase(cv, img, an, new Set([1]), { keepMask: true, outline: 0.3, textMasks: [crop] });
  let far = 0; for (let y = 0; y < 600; y++) for (let x = 0; x < 900; x++) if (er.mask.data[y * 900 + x] && (y < 192 || y > 207)) far++;
  er.mask.delete(); er.surface.delete();
  assert.equal(far, 0, `${far} mask pixels over 6 px from what the model painted`);
});

await test("a mask over most of a bubble is the model taking the bubble for lettering: the rules erase it", async () => {
  const img = page((x) => {
    x.fillStyle = "#fff"; x.strokeStyle = "#000"; x.lineWidth = 4;
    x.beginPath(); x.ellipse(450, 300, 200, 120, 0, 0, 2 * Math.PI); x.fill(); x.stroke();
    x.fillStyle = "#000"; x.font = "bold 30px 'Gytakusub Comic'"; x.fillText("WHERE ARE", 370, 290); x.fillText("YOU GOING?", 365, 330);
  });
  const an = await analyzePage(img);
  const r = an.regions.find((q) => q.kind === "bubble");
  assert.ok(r, "the bubble is found");
  const { regionIds } = layout(an, [{ tag: r.id, box: [360 / 900, 260 / 600, 200 / 900, 80 / 600], text: "Where are you going?", size: "normal", kind: "bubble" }]);
  const all = { region: r.id, x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h, mask: new Uint8Array(r.box.w * r.box.h).fill(1) };
  const byRules = erase(cv, img, an, regionIds, { outline: 0.3 }).image, withMask = erase(cv, img, an, regionIds, { outline: 0.3, textMasks: [all] }).image;
  an.dispose();
  let differ = 0; for (let i = 0; i < byRules.data.length; i++) if (byRules.data[i] !== withMask.data[i]) differ++;
  assert.equal(differ, 0, `${differ} values differ from the rules' erasing`);
});

await test("a piece of the mask thicker than its line is high is a shape, not lettering: the rules erase the region", async () => {
  const img = page((x) => { x.fillStyle = "#000"; x.font = "bold 30px 'Gytakusub Comic'"; x.fillText("WE LEAVE AT DAWN", 300, 300); });
  const an = await analyzePage(img);
  const { regionIds } = layout(an, [{ tag: null, box: [290 / 900, 270 / 600, 330 / 900, 45 / 600], text: "Nous partons", size: "normal", kind: "sign" }]);
  const ids = [...regionIds];
  assert.equal(ids.length, 1, "one region to erase");
  // a disc 90 px across over the line (about 30 px high): the model taking a filled shape for a glyph
  const blob = { region: ids[0], x: 360, y: 230, w: 100, h: 100, mask: new Uint8Array(100 * 100) };
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) if ((x - 50) ** 2 + (y - 50) ** 2 < 45 ** 2) blob.mask[y * 100 + x] = 1;
  const byRules = erase(cv, img, an, regionIds, { outline: 0.3 }).image, withMask = erase(cv, img, an, regionIds, { outline: 0.3, textMasks: [blob] }).image;
  an.dispose();
  let differ = 0; for (let i = 0; i < byRules.data.length; i++) if (byRules.data[i] !== withMask.data[i]) differ++;
  assert.equal(differ, 0, `${differ} values differ from the rules' erasing`);
});

await test("only pieces of the mask that reach into the region's lines are lettering: a ring along a bubble's edge is not", () => {
  const img = page(() => {});
  const an = { W: 900, H: 600, letter: 17, learned: true, lines: [], polarities: [{}, {}], insideOf: () => null,
    regions: [{ id: 1, kind: "block", letter: 17, dark: false, box: { x: 220, y: 196, w: 160, h: 8 }, ref: { gbox: { x: 220, y: 196, w: 160, h: 8 }, letter: 17 } }] };
  const c = { region: 1, x: 200, y: 170, w: 200, h: 60, mask: new Uint8Array(200 * 60) };
  for (let y = 28; y < 32; y++) c.mask.fill(1, y * 200 + 30, y * 200 + 170); // the lettering, on its line
  for (let x = 10; x < 190; x++) c.mask[4 * 200 + x] = c.mask[55 * 200 + x] = 1; // a ring above and below it
  const er = erase(cv, img, an, new Set([1]), { keepMask: true, outline: 0.3, textMasks: [c] });
  const at = (y) => { let n = 0; for (let x = 0; x < 900; x++) n += er.mask.data[y * 900 + x] ? 1 : 0; return n; };
  const lettering = at(200), ring = at(174) + at(225);
  er.mask.delete(); er.surface.delete();
  assert.ok(lettering >= 140, "the lettering is erased");
  assert.equal(ring, 0, "the ring is left");
});

console.log(`TEXTMASK TESTS PASSED (${n})`);
