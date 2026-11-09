// Engine tests: text fitting (text.js), prompt helpers, and the OpenCV engine
// on the synthetic page against its ground truth (fixtures/demo-truth.json).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCanvas, loadImage, registerFont } from "canvas";
import { cv, detector, analyzePage } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";
import * as prompt from "../extension/prompt.js";

registerFont("../extension/fonts/ComicNeue-Bold.ttf", { family: "Gytakusub Comic", weight: "bold" });
new Function(fs.readFileSync("../extension/vendor/hyphen-en.js", "utf8"))();
new Function(fs.readFileSync("../extension/text.js", "utf8"))();
const GyText = globalThis.GyText;
let passed = 0;
const failures = [];
const test = (name, fn) => { try { fn(); passed++; console.log("ok -", name); } catch (e) { if (!process.env.GYT_ALL) throw e; failures.push(name); console.log("FAIL -", name, String(e.message).slice(0, 300)); } };

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
// callClaude against a fake API: what is asked for, and what each kind of answer becomes
{
  const settings = { model: "m", apiKey: "k", targetLang: "English", glossary: "", customPrompt: "", useContext: false, includeSource: false };
  const slice = { b64: "x", mediaType: "image/jpeg", cw: 10, ch: 10, tagFrom: 1, tagTo: 2 };
  const ctx = { terms: [], recent: [] };
  const sent = [];
  const fake = (...replies) => async (url, init) => {
    sent.push(JSON.parse(init.body));
    const [status, reply] = replies.length > 1 ? replies.shift() : replies[0];
    return { ok: status === 200, status, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  const answer = { items: [{ tag: 1, box: [1, 2, 3, 4], kind: "bubble", size: "normal", text: 'He said "stop" — twice' }], terms: [] };
  const good = [200, { content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn" }];
  const ok = await prompt.callClaude(settings, slice, ctx, fake(good));
  test("callClaude asks for structured output: a closed schema, every property required", () => {
    const f = sent[0].output_config?.format;
    assert.equal(f?.type, "json_schema");
    const walk = (o) => {
      if (o.type === "object") { assert.equal(o.additionalProperties, false); assert.deepEqual([...o.required].sort(), Object.keys(o.properties).sort()); Object.values(o.properties).forEach(walk); }
      if (o.type === "array") walk(o.items);
    };
    walk(f.schema);
    assert.ok(!("source" in f.schema.properties.items.items.properties));
    assert.ok("source" in prompt.answerSchema(true).properties.items.items.properties);
    assert.equal(ok.items[0].text, 'He said "stop" — twice');
  });
  const fails = async (...replies) => { try { await prompt.callClaude(settings, slice, ctx, fake(...replies)); return "no error"; } catch (e) { return e.message; } };
  const refusal = await fails([200, { content: [], stop_reason: "refusal" }]);
  const cut = await fails([200, { content: [{ type: "text", text: '{"items":[{"tag":1,' }], stop_reason: "max_tokens", usage: { output_tokens: 8192 } }]);
  const empty = await fails([200, { content: [], stop_reason: "end_turn" }]);
  const garbled = await fails([200, { content: [{ type: "text", text: '{"items":[{"text":"a" "b"}]}' }], stop_reason: "end_turn" }]);
  test("callClaude names why an answer cannot be read (refusal, cut off, empty, garbled)", () => {
    assert.match(refusal, /declined/);
    assert.match(cut, /cut off \(max_tokens, 8192/);
    assert.match(empty, /Empty model response \(stop_reason: end_turn\)/);
    assert.match(garbled, /Unreadable model answer .*stop_reason: end_turn/);
  });
  // last: the fallback is remembered for the rest of the process
  sent.length = 0;
  const fallback = await prompt.callClaude(settings, slice, ctx, fake([400, { error: { message: "output_config.format: unsupported for this model" } }], good));
  test("callClaude falls back to a plain request when structured output is rejected", () => {
    assert.equal(sent.length, 2);
    assert.ok(sent[0].output_config && !sent[1].output_config);
    assert.equal(fallback.items.length, 1);
  });
}
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

  const an = await analyzePage(pixels);
  const matched = new Map(); // truth index → region
  T("every ground-truth region is detected with the right kind (IoU ≥ 0.6)", () => {
    truth.forEach((t, i) => {
      const tb = sc(t.box);
      // a detected text box may hug the letters more tightly than the generator's text box
      let r = an.regions.find((r) => iou(r.box, tb) >= 0.6 && r.kind === t.kind) || an.regions.find((r) => t.kind === "bubble" && r.kind === "bubble" && contains(r.box, tb, 0.02))
        || an.regions.find((r) => t.kind === "block" && r.kind === "block" && contains(tb, r.box, 0.15) && r.box.w >= 0.6 * tb.w);
      // a joined bubble may come back as one region per lobe (the segmentation model
      // separates them): the lobes together must cover the truth box
      if (!r && t.kind === "bubble") {
        const parts = an.regions.filter((q) => q.kind === "bubble" && contains(tb, q.box, 0.08));
        if (parts.length >= 2) { const u = { x: Math.min(...parts.map((q) => q.box.x)), y: Math.min(...parts.map((q) => q.box.y)) }; u.w = Math.max(...parts.map((q) => q.box.x + q.box.w)) - u.x; u.h = Math.max(...parts.map((q) => q.box.y + q.box.h)) - u.y; if (iou(u, tb) >= 0.6) { r = parts[0]; r.parts = parts; } }
      }
      assert.ok(r, `truth #${i} (${t.kind} ${JSON.stringify(t.box)}) not found among ${JSON.stringify(an.regions.map((r) => [r.kind, r.box]))}`);
      matched.set(i, r);
    });
  });
  T("no false regions (faces, sound effects, panel backgrounds)", () => {
    const ids = new Set([...matched.values()].flatMap((r) => (r.parts || [r]).map((q) => q.id)));
    const extra = an.regions.filter((r) => !ids.has(r.id));
    assert.equal(extra.length, 0, "extra regions: " + JSON.stringify(extra.map((r) => [r.kind, r.box, r.letter])));
  });
  T("letter sizes are plausible for 22–34 px fonts (scaled)", () => {
    for (const r of an.regions) assert.ok(r.letter >= 11 && r.letter <= 34, `letter ${r.letter} for ${JSON.stringify(r.box)}`);
  });
  if (name === "demo") { const again = await analyzePage(pixels); T("analysis is deterministic", () => {
    assert.deepEqual(again.regions.map((r) => [r.id, r.kind, r.box, r.letter]), an.regions.map((r) => [r.id, r.kind, r.box, r.letter]));
    again.dispose();
  }); }

  // items tagged like a model reading the stamps
  const items = rawItems.map((it, i) => {
    const ti = truth.findIndex((t) => t.items.includes(i));
    const r = matched.get(ti);
    // a joined bubble found as separate lobes: its items go to the lobes top to bottom
    const parts = r?.parts && r.parts.slice().sort((a, b) => a.box.y - b.box.y);
    const tag = parts ? parts[Math.min(parts.length - 1, truth[ti].items.indexOf(i))].id : r?.id ?? null;
    return { tag, box: null, text: it.text, size: it.size, kind: it.kind };
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
    const ids = new Set((joined.parts || [joined]).map((q) => q.id));
    const ps = placements.filter((p) => ids.has(p.tag));
    assert.equal(ps.length, 2);
    const [a, b] = ps.sort((p, q) => p.rect.y - q.rect.y);
    assert.ok(a.rect.y + a.rect.h <= b.rect.y + 1, "stacked without overlap");
  });
  T("placements never overlap each other", () => {
    for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) assert.ok(iou(placements[i].rect, placements[j].rect) === 0);
  });

  // ink where the lettering was: inside the shape, within the detected text boxes grown by a few pixels
  // (a learned mask may run along the outline, whose ink is not the eraser's business)
  const inkIn = (data, inside, box, dark, blocks, letter) => { const pad = Math.min(4, letter / 2); const inText = (x, y) => blocks.some((b) => x >= b.gbox.x - pad && x < b.gbox.x + b.gbox.w + pad && y >= b.gbox.y - pad && y < b.gbox.y + b.gbox.h + pad); let ink = 0, n = 0; for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { if (!inside(x, y) || !inText(x, y)) continue; n++; const p = (y * W + x) * 4, l = (data[p] + data[p + 1] + data[p + 2]) / 3; if (dark ? l > 150 : l < 110) ink++; } return ink / Math.max(1, n); };
  T("erase removes the lettering from every bubble but keeps the outline", () => {
    const clean = erase(cv, pixels, an, regionIds).image;
    for (const r of an.regions.filter((r) => r.kind === "bubble")) {
      const inside = an.insideOf(r.id);
      const before = inkIn(pixels.data, inside, r.box, r.dark, r.ref.blocks, r.letter), after = inkIn(clean.data, inside, r.box, r.dark, r.ref.blocks, r.letter);
      assert.ok(before > 0.004, `bubble ${r.id} had lettering (${before})`);
      assert.ok(after < Math.max(0.01, 0.1 * before), `bubble ${r.id} still has lettering after erase: ${after} (before ${before})`);
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

// ---------- vertical Japanese with ruby (fixtures/ruby-00, make-ruby-page.py) ----------
// Columns of 30 px glyphs with their readings in 14 px kana beside them, one bubble
// at the right edge of a 1096 px page (where the detector's 32-px input grid makes
// the horizontal and vertical scales differ most).
{
  const img = await loadImage("fixtures/ruby-00.png");
  const truth = JSON.parse(fs.readFileSync("fixtures/ruby-00.truth.json", "utf8"));
  const W = img.width, H = img.height;
  const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, W, H);
  const T = (t, fn) => test(`[ruby] ${t}`, fn);
  const box = (b) => ({ x: b[0], y: b[1], w: b[2], h: b[3] });
  const an = await analyzePage(pixels);
  const regionOf = (t) => an.regions.find((r) => r.kind === "bubble" && contains(r.box, box(t.lettering), 0));
  T("detector boxes sit on the columns they found (per-axis scale back to the page)", () => {
    for (const t of truth) for (const col of t.columns) {
      const cx = col[0] + col[2] / 2, cy = col[1] + col[3] / 2;
      const line = an.lines.find((l) => cx >= l.x && cx <= l.x + l.w && cy >= l.y && cy <= l.y + l.h);
      assert.ok(line, `no detected line over the column at ${JSON.stringify(col)}`);
      assert.ok(Math.abs(line.x + line.w / 2 - cx) <= 0.25 * t.glyph, `line ${JSON.stringify(line)} off the column centre ${cx}`);
    }
  });
  T("each bubble is found, with the glyph size as its letter — not the ruby's", () => {
    for (const t of truth) {
      const r = regionOf(t);
      assert.ok(r, `bubble ${JSON.stringify(t.box)} not found among ${JSON.stringify(an.regions.map((q) => [q.kind, q.box]))}`);
      assert.ok(r.letter >= 0.75 * t.glyph && r.letter <= 1.3 * t.glyph, `letter ${r.letter} for ${t.glyph} px glyphs`);
    }
  });
  T("ruby joins its column: no paragraph of ruby size is left on its own", () => {
    for (const t of truth) for (const b of regionOf(t).ref.blocks) assert.ok(b.letter >= 0.6 * t.glyph || b.glyphCount <= 2, `block ${JSON.stringify(b.gbox)} letter ${b.letter}`);
  });
  const items = truth.map((t) => ({ tag: regionOf(t).id, box: null, text: "Are you really all right?", size: "normal", kind: "bubble" }));
  const { placements, regionIds } = layout(an, items);
  T("erase removes the columns and their ruby", () => {
    const clean = erase(cv, pixels, an, regionIds).image;
    for (const t of truth) {
      const L = box(t.lettering); let before = 0, after = 0;
      for (let y = L.y; y < L.y + L.h; y++) for (let x = L.x; x < L.x + L.w; x++) { const p = (y * W + x) * 4; if (pixels.data[p] < 110) before++; if (clean.data[p] < 110) after++; }
      assert.ok(before > 500 && after < 0.03 * before, `lettering ${JSON.stringify(L)}: ${after} of ${before} dark pixels left`);
    }
  });
  T("the translation is set at a readable size, from the glyphs", () => {
    for (const p of placements) assert.ok(p.letter >= 0.75 * truth[0].glyph, `placement letter ${p.letter}`);
  });
  an.dispose();
}
if (failures.length) { console.log(`ENGINE TESTS FAILED: ${failures.length}`); process.exit(1); }
console.log(`ENGINE TESTS PASSED (${passed})`);
