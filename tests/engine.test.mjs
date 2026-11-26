// Engine tests: text fitting (text.js), prompt helpers, and the OpenCV engine
// on the synthetic page against its ground truth (fixtures/demo-truth.json).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCanvas, loadImage, registerFont } from "canvas";
import { cv, detector, analyzePage } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout, tells } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";
import * as prompt from "../extension/prompt.js";
import { loadLettering } from "./lettering-setup.mjs";

loadLettering();
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
  const settings = { model: "m", apiKey: "k", targetLang: "English", glossary: "", customPrompt: "", useContext: false };
  const slice = { b64: "x", mediaType: "image/jpeg", cw: 10, ch: 10, tagFrom: 1, tagTo: 2 };
  const ctx = { terms: [], recent: [] };
  const sent = [];
  const fake = (...replies) => async (url, init) => {
    sent.push(JSON.parse(init.body));
    const [status, reply] = replies.length > 1 ? replies.shift() : replies[0];
    return { ok: status === 200, status, json: async () => reply, text: async () => JSON.stringify(reply) };
  };
  const answer = { items: [{ tag: 1, box: [1, 2, 3, 4], kind: "bubble", size: "normal", source: "Dijo «basta» — dos veces", text: 'He said "stop" — twice' }], terms: [] };
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
    assert.ok("source" in f.schema.properties.items.items.properties, "every line's original is asked for (2.14)");
    assert.equal(ok.items[0].text, 'He said "stop" — twice');
    assert.equal(sent.length, 1, "a translated line is not asked about again");
  });
  // A line given back as it is drawn (2.14): asked again on its own; translated, or kept as drawn
  {
    const page = (items) => [200, { content: [{ type: "text", text: JSON.stringify({ items, terms: [] }) }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } }];
    const lines = (texts) => [200, { content: [{ type: "text", text: JSON.stringify({ texts }) }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 10 } }];
    const line = (source, text, kind = "bubble") => ({ tag: 1, box: [1, 2, 3, 4], kind, size: "normal", source, text });
    sent.length = 0;
    const copied = await prompt.callClaude(settings, slice, ctx, fake(page([line("No hay nada que no pueda crear!", "No hay nada que no pueda crear!"), line("TRANSLATOR\nSebasdgd", "TRANSLATOR Sebasdgd"), line("Luke...", "Luke..."), line("¡Ahí estás!", "There you are!"), line("BAM", "BAM", "sfx")]), lines(["There's nothing I can't create!", "TRANSLATOR Sebasdgd"])));
    test("a line given back untranslated is asked again and takes the translation", () => {
      assert.equal(copied.items[0].text, "There's nothing I can't create!");
      assert.ok(!copied.items[0].same);
    });
    test("a line given back the same twice is already in the target language: kept as drawn", () => {
      assert.equal(copied.items[1].same, true);
    });
    test("a single word given back (a name, an interjection) is kept as drawn without asking", () => {
      assert.equal(copied.items[2].same, true);
      assert.deepEqual(sent[1].messages[0].content.match(/Lines \(JSON\):\n(.*)\n/)[1], JSON.stringify(["No hay nada que no pueda crear!", "TRANSLATOR\nSebasdgd"]), "one call for the page's longer lines only");
    });
    test("translated lines and sound effects are left alone; the second call's tokens are counted", () => {
      assert.equal(copied.items[3].text, "There you are!"); assert.ok(!copied.items[3].same && !copied.items[4].same);
      assert.equal(sent.length, 2);
      assert.deepEqual(copied.usage, { input_tokens: 120, output_tokens: 60 });
    });
    sent.length = 0;
    const joined = await prompt.callClaude(settings, slice, ctx, fake(page([line("S-SENPAI?", "S-senpai?"), line("HARU-CHAN.", "Haru-chan."), line("HTTPS://BIT.LY/ZAPAMA", "https://bit.ly/zapama", "sign")])));
    test("a name with a hyphen or a link is one word: kept as drawn without asking (2.14.1)", () => {
      assert.deepEqual(joined.items.map((i) => !!i.same), [true, true, true]);
      assert.equal(sent.length, 1);
    });
    sent.length = 0;
    const failed = await prompt.callClaude(settings, slice, ctx, fake(page([line("No hay nada que no pueda crear!", "No hay nada que no pueda crear!")]), [529, { error: { message: "Overloaded" } }]));
    test("asking again failing changes nothing: the page goes on", () => {
      assert.equal(failed.items[0].text, "No hay nada que no pueda crear!"); assert.ok(!failed.items[0].same);
    });
    test("normalizeItems keeps `same`; the layout leaves such a line as drawn", () => {
      const s2 = { x: 0, y: 0, w: 100, h: 100, cw: 100, ch: 100, tagFrom: 1, tagTo: 1 };
      const [a, b] = prompt.normalizeItems([{ ...line("Luke...", "Luke..."), same: true }, line("¡Ahí estás!", "There you are!")], s2, 100, 100);
      assert.equal(a.same, true); assert.ok(!b.same);
      assert.equal(tells(a), false); assert.equal(tells(b), true);
    });
    test("lines labelled sound effects or logos are left out, and listed for the debug report (2.14.1)", () => {
      const s2 = { x: 0, y: 0, w: 100, h: 100, cw: 100, ch: 100, tagFrom: 1, tagTo: 1 }, dropped = [];
      const kept = prompt.normalizeItems([line("ESTRANHO...", "Strange...", "sfx"), line("BAM", "BAM", "sfx"), line("¡Ahí estás!", "There you are!")], s2, 100, 100, dropped);
      assert.deepEqual(kept.map((i) => i.text), ["There you are!"]);
      assert.deepEqual(dropped.map(({ kind, source, text }) => ({ kind, source, text })), [{ kind: "sfx", source: "ESTRANHO...", text: "Strange..." }, { kind: "sfx", source: "BAM", text: "BAM" }]);
      assert.ok(dropped.every((d) => "tag" in d && "box" in d), "with where it was (3.3)");
    });
  }
  const fails = async (...replies) => { try { await prompt.callClaude(settings, slice, ctx, fake(...replies)); return "no error"; } catch (e) { return e.message; } };
  const refusal = await fails([200, { content: [], stop_reason: "refusal" }]);
  const cut = await fails([200, { content: [{ type: "text", text: '{"items":[{"tag":1,' }], stop_reason: "max_tokens", usage: { output_tokens: 8192 } }]);
  const empty = await fails([200, { content: [], stop_reason: "end_turn" }]);
  const garbled = await fails([200, { content: [{ type: "text", text: '{"items":[{"text":"a" "b"}]}' }], stop_reason: "end_turn" }]);
  const kept = await prompt.callClaude(settings, slice, ctx, fake([200, { content: [{ type: "text", text: '{"items":[{"tag":1,"box":[1,2,3,4],"kind":"bubble","size":"normal","source":"a","text":"Hi there."},{"tag":2,"box":[5,6' }], stop_reason: "max_tokens", usage: { output_tokens: 8192 } }]));
  test("an answer cut off keeps its complete items, and says how many (3.3)", () => {
    assert.equal(kept.items.length, 1); assert.equal(kept.items[0].text, "Hi there."); assert.equal(kept.cut, 1);
  });
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

// ---------- the answer contract (engine/contract.js, 3.3) ----------
{
  const { checkAnswer, parseAnswer, boxWay } = await import("../extension/engine/contract.js");
  // a 400 × 300 image with three regions, each with a line of lettering
  const s = { x: 0, y: 0, w: 400, h: 300, cw: 400, ch: 300, tagFrom: 1, tagTo: 3 };
  const found = { regions: [{ id: 1, box: { x: 20, y: 20, w: 100, h: 60 } }, { id: 2, box: { x: 250, y: 40, w: 120, h: 80 } }, { id: 3, box: { x: 60, y: 200, w: 140, h: 70 } }], lines: [{ x: 30, y: 35, w: 80, h: 20 }, { x: 260, y: 60, w: 90, h: 20 }, { x: 80, y: 220, w: 100, h: 25 }] };
  const px = [[30, 35, 80, 20], [260, 60, 90, 20], [80, 220, 100, 25]];
  const answer = (boxes) => boxes.map((box, i) => ({ tag: i + 1, box, kind: "bubble", size: "normal", source: `line ${i}`, text: `Line ${i}.` }));
  const ways = {
    "grid-yx-corners": px.map(([x, y, w, h]) => [y / 300 * 1000, x / 400 * 1000, (y + h) / 300 * 1000, (x + w) / 400 * 1000]),
    "frac-xy-size": px.map(([x, y, w, h]) => [x / 400, y / 300, w / 400, h / 300]),
    "px-xy-corners": px.map(([x, y, w, h]) => [x, y, x + w, y + h]),
  };
  test("boxes written another way are read that way (a 0–1000 grid y first, fractions, corners)", () => {
    for (const [way, boxes] of Object.entries(ways)) {
      const c = checkAnswer(answer(boxes), s, 400, 300, found);
      assert.equal(c.problems[0]?.way, way, way);
      c.items.forEach((it, i) => assert.ok(Math.abs(it.box[0] * 400 - px[i][0]) < 1 && Math.abs(it.box[1] * 300 - px[i][1]) < 1 && Math.abs(it.box[2] * 400 - px[i][2]) < 1, `${way}: box ${i}`));
    }
  });
  test("boxes in the contract's way stand, even with one off its lettering", () => {
    assert.equal(boxWay(answer(px), s, found).way, "px-xy-size");
    const off = answer([px[0], px[1], [330, 230, 40, 30]]);
    const c = checkAnswer(off, s, 400, 300, found);
    assert.deepEqual(c.problems, []); assert.deepEqual(c.items[2].box.map((v, k) => Math.round(v * (k % 2 ? 300 : 400))), [330, 230, 40, 30]);
    assert.equal(boxWay(answer([[30, 35, 80, 20]]), s, { regions: [], lines: [] }).way, "px-xy-size", "nothing found: the contract's way");
  });
  test("the same line twice is kept once; the same words elsewhere are another line", () => {
    const a = answer(px), twice = [a[0], { ...a[0] }, a[1], { ...a[1], box: [80, 220, 100, 25], tag: 3 }];
    const c = checkAnswer(twice, s, 400, 300, found);
    assert.equal(c.items.length, 3); assert.deepEqual(c.from, [0, 2, 3]);
    assert.equal(c.problems.filter((p) => p.what === "the same line twice").length, 1);
  });
  test("a line in a bubble labelled a sound effect is dialogue; one outside a bubble stays a sound effect", () => {
    const f2 = { ...found, regions: found.regions.map((r, i) => ({ ...r, kind: i === 0 ? "bubble" : "block" })) };
    const a = answer(px).map((it) => ({ ...it, kind: "sfx" })), dropped = [];
    const c = checkAnswer(a, s, 400, 300, f2, dropped);
    assert.deepEqual(c.items.map((it) => it.kind), ["bubble"]); assert.equal(dropped.length, 2);
    assert.equal(c.problems[0].what, "a line in a bubble labelled a sound effect");
  });
  test("an answer whose items are not a list gives none, and says so", () => {
    assert.deepEqual(checkAnswer({ oops: 1 }, s, 400, 300, found).items, []);
    assert.equal(checkAnswer(null, s, 400, 300, found).problems[0].what, "items not a list");
  });
  test("parseAnswer reads a whole answer, and the complete items of one broken partway", () => {
    assert.deepEqual(parseAnswer('```json\n{"items":[{"text":"a"}],"terms":[]}\n```'), { items: [{ text: "a" }], terms: [], salvaged: null });
    assert.deepEqual(parseAnswer('{"items":[{"text":"a \\"b\\" {c}"},{"text":"d"},{"text":"e'), { items: [{ text: 'a "b" {c}' }, { text: "d" }], terms: [], salvaged: 2 });
    assert.throws(() => parseAnswer('{"items":[{"text":'), /No complete item/);
    assert.throws(() => parseAnswer("no json here"));
  });
}

test("sound effects and logos are labelled, then left as drawn", () => {
  const s = { x: 0, y: 0, w: 100, h: 100, cw: 100, ch: 100, tagFrom: 1, tagTo: 0 };
  const kept = prompt.normalizeItems(["sign", "sfx", "logo", "narration"].map((kind) => ({ tag: null, box: [1, 1, 5, 5], kind, text: kind })), s, 100, 100);
  assert.deepEqual(kept.map((it) => it.kind), ["sign", "narration"]);
  assert.deepEqual(prompt.answerSchema().properties.items.items.properties.kind.enum, ["bubble", "narration", "sign", "sfx", "logo"]);
  assert.match(prompt.buildPrompt({ glossary: "", useContext: false, customPrompt: "", targetLang: "English" }, { terms: [], recent: [] }, { cw: 10, ch: 10, tagFrom: 1, tagTo: 0 }), /"sfx" \(a sound effect\) or "logo"/);
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
