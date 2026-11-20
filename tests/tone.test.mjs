// The eraser on the cases 2.11 got wrong on real chapters (2.12.0), on a procedural page
// (fixtures/tone-00.png, make-tone-page.py): white-outlined lettering on a screentone bubble,
// on a gradient bubble, in a white bubble, and as narration on screentone. The page is analysed,
// the stand-in answers laid out, and erased both ways; each area is measured (residue.mjs).
// 2.11's eraser must show the failure (so the test can see it) and 2.12's must leave no marks.
//   node tone.test.mjs [--out dir]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "canvas";
import { cv, analyzePage } from "./cv-node.mjs";
import { layout } from "../extension/engine/layout.js";
import { erase, fillTexture, NotLoaded } from "../extension/engine/erase.js";
import { OUTLINE } from "../extension/engine/page.js";
import { getOrt, createSession, run } from "../extension/engine/ort.js";
import { marksLeft } from "./residue.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", null);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

const img = await loadImage("fixtures/tone-00.png");
const truth = JSON.parse(fs.readFileSync("fixtures/tone-00.truth.json", "utf8"));
const W = img.width, H = img.height;
const c = createCanvas(W, H), x = c.getContext("2d"); x.drawImage(img, 0, 0);
const pixels = x.getImageData(0, 0, W, H);
const before = new Uint8ClampedArray(pixels.data);
const an = await analyzePage(pixels);

// stand-in answers: one line per truth area, tagged with the region that holds its lettering
const regionOf = (t) => {
  const cx = t.lettering[0] + t.lettering[2] / 2, cy = t.lettering[1] + t.lettering[3] / 2;
  let best = null; for (const r of an.regions) if (cx >= r.box.x && cy >= r.box.y && cx <= r.box.x + r.box.w && cy <= r.box.y + r.box.h && (!best || r.box.w * r.box.h < best.box.w * best.box.h)) best = r;
  return best;
};
const items = truth.map((t, index) => ({ tag: regionOf(t)?.id ?? null, box: [t.lettering[0] / W, t.lettering[1] / H, t.lettering[2] / W, t.lettering[3] / H], text: "x", size: "normal", kind: t.kind, index }));
test("every text area of the page is found as a region", () => assert.ok(items.every((i) => i.tag != null), JSON.stringify(items.map((i) => i.tag))));
const { regionIds } = layout(an, items);

const ort = getOrt();
const { session } = await createSession(new Uint8Array(fs.readFileSync("../extension/vendor/inpaint.onnx")), { gpu: false });
const model = { ort, session, run };
const old = erase(cv, new ImageData(new Uint8ClampedArray(before), W, H), an, regionIds).image;
const res = erase(cv, new ImageData(new Uint8ClampedArray(before), W, H), an, regionIds, { keepMask: true, outline: OUTLINE });
const now = await fillTexture(cv, model, res.image, res);
console.log("  fills:", res.rois.map((r) => r.filled || r.fill).join(", "));
res.mask.delete(); res.surface.delete();

if (out) {
  fs.mkdirSync(out, { recursive: true });
  for (const [name, im] of [["2.11", old], ["2.12", now]]) { const o = createCanvas(W, H); o.getContext("2d").putImageData(im, 0, 0); fs.writeFileSync(path.join(out, `tone-00-${name}.png`), o.toBuffer("image/png")); }
}
const measure = (after) => truth.map((t) => { const r = regionOf(t); return { t, m: marksLeft(before, after.data, W, H, r, r.kind === "bubble" ? an.insideOf(r.id) : null) }; });
const then = measure(old), nowM = measure(now);
for (const [i, { t, m }] of nowM.entries()) console.log(`  ${t.surface.padEnd(8)} ${t.kind.padEnd(9)} 2.11: ${then[i].m ? then[i].m.left.toFixed(2) : "–"}  2.12: ${m ? m.left.toFixed(2) : "–"}`);
if (process.env.GYT_DEBUG) for (const [i, { m }] of nowM.entries()) console.log("   ", JSON.stringify(then[i].m), JSON.stringify(m));

test("2.11's eraser leaves marks on the outlined lettering on screentone (the failure this guards)", () => {
  const toned = then.filter(({ t }) => t.surface === "tone");
  assert.ok(toned.some(({ m }) => m?.dirty), JSON.stringify(toned.map(({ m }) => m?.left)));
});
for (const [i, { t, m }] of nowM.entries()) {
  test(`2.12: no marks left on the ${t.surface} ${t.kind}`, () => { assert.ok(m && !m.dirty, `left ${m?.left?.toFixed(2)} (2.11: ${then[i].m?.left?.toFixed(2)})`); });
}
test("2.12: the white bubble is filled flat, with its own white", () => {
  const r = regionOf(truth.find((t) => t.surface === "white"));
  const area = res.rois.find((q) => q.x <= r.box.x + r.box.w && q.x + q.w >= r.box.x && q.y <= r.box.y + r.box.h && q.y + q.h >= r.box.y);
  assert.equal(area?.fill, "flat"); assert.deepEqual(area.color, [255, 255, 255]);
});
// The prefill (engine/page.js prefillPage): every region erased and its textured areas filled into a
// cache while the translation is on the way; the finish then reuses what matches. It must only save
// time: the page comes out exactly as without it, when every region got a translation and when one
// did not (its neighbours' inputs may then differ, and those areas are filled again).
const fillWith = async (ids, cache, m = model) => {
  const e = erase(cv, new ImageData(new Uint8ClampedArray(before), W, H), an, ids, { keepMask: true, outline: OUTLINE });
  const im = await fillTexture(cv, m, e.image, e, { cache });
  const hits = e.rois.filter((r) => r.fillHit).length, textured = e.rois.filter((r) => r.fill === "texture").length;
  const later = e.rois.filter((r) => r.filled === "later").length, kinds = e.rois.map((r) => r.filled).filter(Boolean);
  e.mask.delete(); e.surface.delete();
  return { im, hits, textured, later, kinds };
};
const same = (a, b) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
for (const [label, ids] of [["every region translated", regionIds], ["one region left out", new Set([...regionIds].slice(1))]]) {
  const plain = await fillWith(ids, null);
  const cache = new Map();
  await fillWith(new Set(an.regions.map((r) => r.id)), cache); // the prefill
  const fin = await fillWith(ids, cache);
  test(`prefill, ${label}: the same page, and the areas found filled (${fin.hits} of ${fin.textured})`, () => {
    assert.ok(same(plain.im, fin.im), "the page differs from the one filled without the prefill");
    assert.ok(fin.hits > 0, "no area was reused");
  });
}

// The model not loaded yet when the prefill runs (it loads beside the queue, engine/page.js warmInpainter):
// the areas that need it are left for a second pass, the others filled at once; the same page again.
{
  const all = new Set(an.regions.map((r) => r.id));
  const plain = await fillWith(regionIds, null);
  const cache = new Map();
  const first = await fillWith(all, cache, () => { throw new NotLoaded(); });
  await fillWith(all, cache); // once it is loaded
  const fin = await fillWith(regionIds, cache);
  test(`prefill before the model is loaded: ${first.later} area(s) left for later, ${first.kinds.filter((k) => k === "tone").length} screentone filled at once; the same page`, () => {
    assert.ok(first.later > 0, "no area needed the model: " + first.kinds.join(","));
    assert.ok(first.kinds.includes("tone"), "the screentone was not filled in the first pass: " + first.kinds.join(","));
    assert.ok(!first.kinds.includes("learned") && !first.kinds.includes("telea"), first.kinds.join(","));
    assert.equal(fin.hits, fin.textured);
    assert.ok(same(plain.im, fin.im), "the page differs from the one filled without the prefill");
  });
}

an.dispose();
console.log(`\n${passed} passed`);
