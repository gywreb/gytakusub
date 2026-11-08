// Engine tests: text fitting (text.js), prompt helpers, and the OpenCV engine
// on the synthetic page against its ground truth (fixtures/demo-truth.json).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCanvas, loadImage, registerFont } from "canvas";
import { cv, detector } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";
import * as prompt from "../extension/prompt.js";

registerFont("../extension/fonts/ComicNeue-Bold.ttf", { family: "Gytakusub Comic", weight: "bold" });
new Function(fs.readFileSync("../extension/vendor/hyphen-en.js", "utf8"))();
new Function(fs.readFileSync("../extension/text.js", "utf8"))();
const GyText = globalThis.GyText;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };

// ---------- text.js ----------
{
  // fake monospace: 6px per char at any size → width = 6/16*size per char
  const state = { size: 16 };
  const setFont = (s) => { state.size = s; };
  const measure = (s) => s.replace(/­/g, "").length * state.size * 0.375;
  test("fitText keeps a word whole when a comparable size fits it", () => {
    const f = GyText.fitText("SHOTARO...", { x: 0, y: 0, w: 100, h: 60 }, setFont, measure, { maxSize: 40, minSize: 8 });
    assert.deepEqual(f.lines, ["SHOTARO..."]); assert.equal(f.hyphens, 0);
  });
  test("fitText hyphenates at a syllable, not mid-letter, when the line is narrow", () => {
    const f = GyText.fitText("impossible", { x: 0, y: 0, w: 60, h: 200 }, setFont, measure, { maxSize: 30, minSize: 8 });
    assert.ok(f.hyphens >= 1, "hyphenated: " + JSON.stringify(f));
    assert.ok(["im-", "impos-", "impossi-"].includes(f.lines[0]), "syllable break: " + f.lines[0]);
    assert.ok(f.size > 8, "size kept reasonable: " + f.size);
  });
  test("fitText never splits a short name", () => {
    const n = GyText.fitText("Nikaido", { x: 0, y: 0, w: 40, h: 120 }, setFont, measure, { maxSize: 40, minSize: 8 });
    assert.deepEqual(n.lines, ["Nikaido"]);
  });
  test("wrapInfo wraps on spaces and reports no break for fitting words", () => {
    state.size = 16;
    const r = GyText.wrapInfo(measure, "we leave at dawn no excuses", 60);
    assert.ok(r.lines.length >= 3 && !r.broken && r.lines.every((l) => measure(l) <= 60));
  });
  test("forced fit stays inside the box", () => {
    const g = GyText.fitText("SUPERCALIFRAGILISTIC", { x: 0, y: 0, w: 30, h: 60 }, setFont, measure, { maxSize: 40, minSize: 8 });
    assert.ok(g.lines.every((l) => measure(l) <= 30 + 1e-6));
  });
}

// ---------- prompt.js ----------
test("extractJson tolerates fences and prose", () => {
  assert.deepEqual(prompt.extractJson('Here you go:\n```json\n{"items":[],"terms":[]}\n```'), { items: [], terms: [] });
  assert.throws(() => prompt.extractJson("no json here"));
});
test("normalizeItems maps slice pixels to page fractions and validates tags", () => {
  const s = { x: 0, y: 100, w: 1000, h: 500, cw: 500, ch: 250, tagFrom: 3, tagTo: 5 };
  const [a, b] = prompt.normalizeItems([{ tag: 4, box: [50, 25, 100, 50], text: "hi" }, { tag: 9, box: [0, 0, 10, 10], text: "x" }], s, 1000, 1000);
  assert.deepEqual(a.box, [0.1, 0.15, 0.2, 0.1]); assert.equal(a.tag, 4);
  assert.equal(b.tag, null, "tag outside the slice's range is dropped");
});

// ---------- engine on the synthetic pages ----------
// demo-page.png (hand-laid, with a joined bubble) plus the procedural gen-NN pages
// (Latin and Japanese, light and dark bubbles, captions, free text, sound effects).
const pages = [["demo", "fixtures/demo-page.png", "fixtures/demo-truth.json", "fixtures/demo-items.json"]];
for (const f of fs.readdirSync("fixtures").filter((f) => /^gen-\d+\.png$/.test(f)).sort()) {
  const base = "fixtures/" + f.replace(/\.png$/, "");
  pages.push([f.replace(/\.png$/, ""), base + ".png", base + ".truth.json", base + ".items.json"]);
}
const iou = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); const i = ix * iy; return i / (a.w * a.h + b.w * b.h - i); };
const contains = (outer, inner, tol = 0.05) => inner.x >= outer.x - outer.w * tol && inner.y >= outer.y - outer.h * tol && inner.x + inner.w <= outer.x + outer.w * (1 + tol) && inner.y + inner.h <= outer.y + outer.h * (1 + tol);

for (const [name, png, truthPath, itemsPath] of pages) {
  const img = await loadImage(png);
  const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
  const rawItems = JSON.parse(fs.readFileSync(itemsPath, "utf8"));
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const W = Math.round(img.width * scale), H = Math.round(img.height * scale);
  const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, W, H);
  const pixels = ctx.getImageData(0, 0, W, H);
  const sc = (b) => ({ x: b[0] * scale, y: b[1] * scale, w: b[2] * scale, h: b[3] * scale });
  const T = (t, fn) => test(`[${name}] ${t}`, fn);

  const an = analyze(cv, pixels, { detector });
  const matched = new Map(); // truth index → region
  T("every ground-truth region is detected with the right kind (IoU ≥ 0.6)", () => {
    truth.forEach((t, i) => {
      const tb = sc(t.box);
      // a detected text box may hug the letters more tightly than the generator's text box
      const r = an.regions.find((r) => iou(r.box, tb) >= 0.6 && r.kind === t.kind) || an.regions.find((r) => t.kind === "bubble" && r.kind === "bubble" && contains(r.box, tb, 0.02))
        || an.regions.find((r) => t.kind === "block" && r.kind === "block" && contains(tb, r.box, 0.15) && r.box.w >= 0.6 * tb.w);
      assert.ok(r, `truth #${i} (${t.kind} ${JSON.stringify(t.box)}) not found among ${JSON.stringify(an.regions.map((r) => [r.kind, r.box]))}`);
      matched.set(i, r);
    });
  });
  T("no false regions (faces, sound effects, panel backgrounds)", () => {
    const ids = new Set([...matched.values()].map((r) => r.id));
    const extra = an.regions.filter((r) => !ids.has(r.id));
    assert.equal(extra.length, 0, "extra regions: " + JSON.stringify(extra.map((r) => [r.kind, r.box, r.letter])));
  });
  T("letter sizes are plausible for 22–34 px fonts (scaled)", () => {
    for (const r of an.regions) assert.ok(r.letter >= 11 && r.letter <= 34, `letter ${r.letter} for ${JSON.stringify(r.box)}`);
  });
  if (name === "demo") T("analysis is deterministic", () => {
    const again = analyze(cv, pixels, { detector });
    assert.deepEqual(again.regions.map((r) => [r.id, r.kind, r.box, r.letter]), an.regions.map((r) => [r.id, r.kind, r.box, r.letter]));
    again.dispose();
  });

  // items tagged like a model reading the stamps
  const items = rawItems.map((it, i) => {
    const ti = truth.findIndex((t) => t.items.includes(i));
    return { tag: matched.get(ti)?.id ?? null, box: null, text: it.text, size: it.size, kind: it.kind };
  });
  const { placements, regionIds } = layout(an, items);
  T("every item is placed inside its region", () => {
    assert.equal(placements.length, items.length);
    for (const p of placements) {
      const r = an.regions.find((r) => r.id === p.tag);
      const pad = r.kind === "block" ? r.letter : 0; // free text keeps its footprint plus half a letter of air
      const grown = r && { x: r.box.x - pad, y: r.box.y - pad, w: r.box.w + 2 * pad, h: r.box.h + 2 * pad };
      assert.ok(r && contains(grown, p.rect, 0.1), `placement ${JSON.stringify(p.rect)} outside region ${JSON.stringify(r && r.box)}`);
      if (r.kind === "bubble") { const inside = an.insideOf(r.id); assert.ok(inside(p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2), "rect centre inside the bubble shape"); }
      assert.ok(p.rect.w >= 0.3 * r.box.w && p.rect.h >= 0.25 * r.box.h, `text area too small for its region: ${JSON.stringify(p.rect)} in ${JSON.stringify(r.box)}`);
    }
  });
  if (name === "demo") T("joined bubble: two speakers get two stacked, non-overlapping areas", () => {
    const joined = matched.get(truth.findIndex((t) => t.items.length === 2));
    const ps = placements.filter((p) => p.tag === joined.id);
    assert.equal(ps.length, 2);
    const [a, b] = ps.sort((p, q) => p.rect.y - q.rect.y);
    assert.ok(a.rect.y + a.rect.h <= b.rect.y + 1, "stacked without overlap");
  });
  T("placements never overlap each other", () => {
    for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) assert.ok(iou(placements[i].rect, placements[j].rect) === 0);
  });

  const inkIn = (data, inside, box, dark) => { let ink = 0, n = 0; for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { if (!inside(x, y)) continue; n++; const p = (y * W + x) * 4, l = (data[p] + data[p + 1] + data[p + 2]) / 3; if (dark ? l > 150 : l < 110) ink++; } return ink / Math.max(1, n); };
  T("erase removes the lettering from every bubble but keeps the outline", () => {
    const clean = erase(cv, pixels, an, regionIds).image;
    for (const r of an.regions.filter((r) => r.kind === "bubble")) {
      const inside = an.insideOf(r.id);
      const before = inkIn(pixels.data, inside, r.box, r.dark), after = inkIn(clean.data, inside, r.box, r.dark);
      assert.ok(before > 0.004, `bubble ${r.id} had lettering (${before})`);
      assert.ok(after < Math.max(0.003, 0.12 * before), `bubble ${r.id} still has lettering after erase: ${after} (before ${before})`);
    }
    // outline check: dark pixels along the border of a light elliptical bubble survive
    const ti = truth.findIndex((t) => t.kind === "bubble" && !t.dark && t.shape === "ellipse");
    if (ti >= 0) {
      const t0 = sc(truth[ti].box); let dark = 0, n = 0;
      for (let a = 0; a < Math.PI * 2; a += 0.05) { const x = Math.round(t0.x + t0.w / 2 + Math.cos(a) * (t0.w / 2 - 2)), y = Math.round(t0.y + t0.h / 2 + Math.sin(a) * (t0.h / 2 - 2)); if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; const p = (y * W + x) * 4; if ((clean.data[p] + clean.data[p + 1] + clean.data[p + 2]) / 3 < 120) dark++; }
      assert.ok(dark / n > 0.4, `outline survived: ${dark}/${n}`);
    }
  });
  T("text draws without throwing and fills every placement", () => {
    const n = GyText.draw(ctx, placements, {});
    assert.equal(n, placements.length);
  });
  an.dispose();
}
console.log(`ENGINE TESTS PASSED (${passed})`);
