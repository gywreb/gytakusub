// Lettering in every listed target language (text.js with the real fonts, as the pages draw it):
// which font a page gets, line breaking without spaces (Chinese, Japanese, Thai), line-start and
// line-end rules, hyphenation per language, upper case, and the generated font table.
//   node lettering.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCanvas, registerFont } from "canvas";
import { LANGUAGES, letteringFor } from "../extension/languages.js";
import { readFont, FONTS } from "../scripts/vendor-fonts.mjs";

new Function(fs.readFileSync("../extension/vendor/hyphen-en.js", "utf8"))();
new Function(fs.readFileSync("../extension/vendor/lettering-fonts.js", "utf8"))();
new Function(fs.readFileSync("../extension/text.js", "utf8"))();
const { GyText, GyFonts, GyHyphen } = globalThis;
for (const f of GyFonts) registerFont(path.join("../extension", f.file), { family: f.family, weight: "bold" });

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok -", name); };
const ctx = createCanvas(600, 600).getContext("2d");
const patterns = (name) => GyHyphen.create(JSON.parse(fs.readFileSync(`../extension/vendor/hyphen/${name}.json`, "utf8")));

/** Fit `text` the way draw() does, in `lang`'s font and rules. */
function fit(text, lang, w = 120, h = 160, extra = {}) {
  const { hyphen } = letteringFor(LANGUAGES.find((l) => l.tag === lang)?.name);
  const hyphenator = hyphen === "en-us" ? GyHyphen.hyphenateEn : hyphen ? patterns(hyphen) : null;
  const look = GyText.lettering([text], { lang });
  const setFont = (s) => { ctx.font = `bold ${s}px ${look.family}`; };
  const measure = (s) => ctx.measureText(s).width;
  return { look, measure, ...GyText.fitText(text, { x: 0, y: 0, w, h }, setFont, measure, { maxSize: 30, minSize: 8, lang, hyphenator, ...extra }) };
}

// ---------- the font table matches the font files ----------
test("vendor/lettering-fonts.js lists every font with the characters its file has", () => {
  assert.deepEqual(GyFonts.map((f) => f.file), FONTS.map((f) => f.file));
  for (const f of GyFonts) {
    const { codepoints } = readFont(fs.readFileSync(path.join("../extension", f.file)));
    const listed = f.ranges.reduce((n, [a, b]) => n + b - a + 1, 0);
    assert.equal(listed, codepoints.length, f.file);
  }
});

// ---------- one font per page, chosen by its letters ----------
const fontOf = (text, lang) => GyText.lettering([text], { lang }).font?.family || GyText.lettering([text], { lang }).cjk;
test("English, Spanish, French, German, Portuguese: Comic Neue", () => {
  for (const t of ["I don't know!", "¿Qué dices? ¡No!", "Ça m'étonne, garçon.", "Größer, schöner, Übermut", "Não sei, irmão."]) assert.equal(fontOf(t), "Gytakusub Comic", t);
});
test("Vietnamese gets a font with all its letters (Comic Neue has 3 of them)", () => {
  assert.equal(fontOf("Tôi không biết người ta nói gì nữa!", "vi"), "Gytakusub Mali");
});
test("Russian, Ukrainian, Polish, Turkish: Comic Relief", () => {
  for (const t of ["Я не знаю, что ты имеешь в виду!", "Ґанок і їжак", "Gdzież się podziałeś?", "Ne demek istediğini bilmiyorum!"]) assert.equal(fontOf(t), "Gytakusub Comic Relief", t);
});
test("Thai: Mali", () => { assert.equal(fontOf("ฉันไม่รู้ว่าคุณพูดอะไร", "th"), "Gytakusub Mali"); });
test("Chinese, Japanese, Korean: the system font for that language", () => {
  assert.equal(fontOf("我不知道。", "zh-Hans"), "zh-Hans");
  assert.equal(fontOf("我不知道。", "zh-Hant"), "zh-Hant");
  assert.equal(fontOf("分からない。", "ja"), "ja");
  assert.equal(fontOf("모르겠어.", "ko"), "ko");
  assert.equal(fontOf("分からない。", null), "ja", "kana without a language: Japanese");
  assert.equal(fontOf("모르겠어.", null), "ko");
});
test("one Vietnamese line makes the whole page Vietnamese-ready, so no word mixes two fonts", () => {
  const look = GyText.lettering(["Wait!", "Đi thôi, người ơi!"], { lang: "vi" });
  assert.equal(look.font.family, "Gytakusub Mali");
});
test("a font set in Settings comes first, with the right fallback after it", () => {
  const look = GyText.lettering(["Đi thôi, người ơi!"], { fontFamily: '"Bangers"', lang: "vi" });
  assert.ok(look.family.startsWith('"Bangers", "Gytakusub Mali"'), look.family);
});
test("each font's size follows its own cap height (Comic Neue's sizes are unchanged)", () => {
  assert.equal(GyText.lettering(["Wait"]).cap, 0.67);
  assert.ok(GyText.lettering(["Я"]).cap > 0.7);
});

// ---------- scripts without spaces ----------
const NO_START = [..."、。，．！？」』）ー"];
for (const [lang, text] of [["zh-Hans", "我不知道你在说什么，但是我们必须马上离开这里。"], ["ja", "お前が何を言っているのか分からないけど、今すぐここを出なきゃ。「待って！」"], ["zh-Hant", "我不知道你在說什麼，但是我們必須馬上離開這裡。"]]) {
  test(`${lang}: wraps between words at a readable size (was the minimum, 8 px)`, () => {
    const r = fit(text, lang);
    assert.ok(!r.forced && !r.overflow, JSON.stringify(r.lines));
    assert.ok(r.size >= 16, `size ${r.size}`);
    assert.ok(r.lines.every((l) => r.measure(l) <= 120 + 0.5), "inside the box");
    assert.equal(r.lines.join(""), text, "no characters lost or added (no hyphens)");
  });
  test(`${lang}: no line starts with a closing mark or ends with an opening one`, () => {
    for (const w of [70, 90, 110, 140]) {
      const r = fit(text, lang, w, 400);
      for (const l of r.lines) { assert.ok(!NO_START.includes(l[0]), `"${l}" (width ${w})`); assert.ok(!"「『（".includes(l.at(-1)), `"${l}"`); }
    }
  });
}
test("Thai: wraps between words", () => {
  const text = "ฉันไม่รู้ว่าคุณกำลังพูดถึงอะไร แต่เราต้องออกไปจากที่นี่เดี๋ยวนี้";
  const r = fit(text, "th");
  assert.ok(!r.forced && r.size >= 16, `${r.size} ${JSON.stringify(r.lines)}`);
  assert.equal(r.lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
});
test("Korean keeps breaking at spaces", () => {
  const r = fit("네가 무슨 말을 하는지 모르겠지만 지금 당장 여기서 나가야 해.", "ko");
  assert.ok(r.lines.every((l) => !l.startsWith(" ")) && r.lines.length > 2 && r.size >= 16);
  assert.equal(r.lines.join(" "), "네가 무슨 말을 하는지 모르겠지만 지금 당장 여기서 나가야 해.");
});
test("a Japanese word longer than the line is cut between characters, without hyphens", () => {
  const r = fit("ドンドコドンドコドンドコドンドコ", "ja", 60, 200);
  assert.ok(r.lines.length > 1 && !r.lines.some((l) => l.includes("-")), JSON.stringify(r.lines));
});

// ---------- hyphenation per language ----------
test("German hyphenates with German patterns", () => {
  const word = "Donaudampfschifffahrtsgesellschaftskapitän";
  const r = fit(`${word} wartet.`, "de", 120, 300);
  assert.ok(r.hyphens >= 1, JSON.stringify(r.lines));
  // every break is one of the German patterns' break points in the word
  const allowed = new Set(), parts = GyText.syllables(word, patterns("de-1996"));
  parts.reduce((at, p) => { allowed.add(at + p.length); return at + p.length; }, 0);
  let at = 0;
  for (const l of r.lines.filter((x) => x.endsWith("-"))) { at += l.length - 1; assert.ok(allowed.has(at), `break after "${word.slice(0, at)}"`); }
});
// Short words are not split, nor are two letters left on a side (2.14: "CY-CLONE!", "TRIG-GER!",
// "ex-pect-ed...", "un-deresti-mate" on a Kamen Rider chapter).
test("words under 8 letters are never split; every split leaves 3 letters at least on each side", () => {
  const en = GyHyphen.hyphenateEn;
  for (const w of ["CYCLONE!", "TRIGGER!", "MAXIMUM", "expected...", "Kyoko!"]) assert.deepEqual(GyText.syllables(w, en), [w], w);
  for (const w of ["underestimate", "impossible", "unbelievable!", "Kyoko-san's"]) {
    const parts = GyText.syllables(w, en), letters = (x) => [...x].filter((c) => /\p{L}/u.test(c)).length, total = letters(w);
    let before = 0;
    for (const p of parts.slice(0, -1)) { before += letters(p); assert.ok(before >= 3 && total - before >= 3, `${w}: ${parts.join("-")}`); }
    assert.equal(parts.join(""), w);
  }
  assert.ok(GyText.syllables("underestimate", en).length > 1, "a long word still splits");
});
test("a word joined by a hyphen may end a line after it, no hyphen added; never leaving under 3 letters on a side", () => {
  const look = GyText.lettering(["remote-controlled"], { lang: "en" });
  ctx.font = `bold 20px ${look.family}`;
  const measure = (s) => ctx.measureText(s).width;
  const w = measure("remote-controlled") * 0.7;
  const r = GyText.wrapInfo(measure, "remote-controlled artillery", w, { lang: "en", hyphenate: false });
  assert.deepEqual(r.lines.slice(0, 2), ["remote-", "controlled"]);
  assert.ok(!r.broken && r.hyphens === 0);
  // "e-mail": one letter before the hyphen, so the word stays whole (and is reported too wide)
  const e = GyText.wrapInfo(measure, "e-mailing", measure("e-mailing") * 0.6, { lang: "en", hyphenate: false });
  assert.deepEqual(e.lines, ["e-mailing"]);
  // French: "peut-être" breaks after the hyphen like any other
  const f = GyText.wrapInfo(measure, "peut-être", measure("peut-être") * 0.7, { lang: "fr", hyphenate: false });
  assert.deepEqual(f.lines, ["peut-", "être"]);
});
test("a short shout in a narrow box stays whole (set smaller rather than split)", () => {
  for (const w of ["CYCLONE!", "TRIGGER!"]) {
    const r = fit(w, "en", 52, 120);
    assert.equal(r.hyphens, 0, JSON.stringify(r.lines)); assert.equal(r.lines.join(""), w);
  }
});
test("every bundled pattern file loads and splits a long word of its language", () => {
  const words = { "de-1996": "Geschwindigkeitsbegrenzung", es: "desafortunadamente", fr: "malheureusement", it: "sfortunatamente", nl: "onvoorstelbaar", pl: "niewiarygodnie", pt: "infelizmente", uk: "неймовірно" };
  for (const [name, word] of Object.entries(words)) assert.ok(GyText.syllables(word, patterns(name)).length > 1, name);
  const listed = LANGUAGES.map((l) => l.hyphen).filter((h) => h && h !== "en-us").sort();
  assert.deepEqual(listed, Object.keys(words).sort(), "languages.js names exactly the bundled files");
  for (const name of listed) assert.ok(fs.existsSync(`../extension/vendor/hyphen/${name}.json`), name);
});
test("Vietnamese and languages without patterns are never hyphenated", () => {
  assert.equal(letteringFor("Vietnamese").hyphen, null);
  const r = fit("nghiêng nghiêng nghiêng", "vi", 40, 300);
  assert.equal(r.hyphens, 0);
  assert.ok(!r.lines.some((l) => l.endsWith("-")), JSON.stringify(r.lines));
});
test("a language typed under Other gets no hyphenation and no language rules", () => {
  assert.deepEqual(letteringFor("Klingon"), { lang: null, hyphen: null });
});

// ---------- draw() ----------
test("draw() upper-cases with the language's rules (Turkish i → İ, German ß → SS)", () => {
  const seen = [];
  const fake = { measureText: (s) => ({ width: s.length * 5 }), fillText: (s) => seen.push(s), strokeText() {}, set font(v) {}, get font() { return ""; } };
  const place = (text) => [{ text, rect: { x: 0, y: 0, w: 500, h: 100 }, letter: 10, color: "#000", tag: 1 }];
  GyText.draw(fake, place("istiyorum"), { uppercase: true, lang: "tr", hyphenator: null });
  GyText.draw(fake, place("Straße"), { uppercase: true, lang: "de", hyphenator: null });
  assert.deepEqual(seen, ["İSTİYORUM", "STRASSE"]);
});
test("draw() keeps one font for the page while a line is hidden (peeking)", () => {
  const fonts = [];
  const fake = { measureText: (s) => ({ width: s.length * 5 }), fillText() {}, strokeText() {}, set font(v) { fonts.push(v); }, get font() { return ""; } };
  const p = (text) => ({ text, rect: { x: 0, y: 0, w: 500, h: 100 }, letter: 10, color: "#000", tag: 1 });
  GyText.draw(fake, [p("Wait!")], { lang: "vi", hyphenator: null, pageTexts: ["Wait!", "Đi thôi, người ơi!"] });
  assert.ok(fonts.every((f) => f.includes('"Gytakusub Mali"')), fonts.at(-1));
});

test("in an oval, lines are set to its shape: larger than in the inscribed rectangle, every line inside (2.14.1)", () => {
  // an oval 120 × 180 (half-axes 60 and 90); its largest rectangle is 85 × 127
  const A = 60, B = 90, step = 2, half = [];
  for (let y = 0; y < 2 * B; y += step) { const d = (y + step / 2 - B) / B; half.push(Math.floor(A * Math.sqrt(Math.max(0, 1 - d * d)))); }
  const rect = { x: A - A / Math.SQRT2, y: B - B / Math.SQRT2, w: A * Math.SQRT2, h: B * Math.SQRT2 };
  const shape = { dy: -rect.y, step, half };
  const text = "Does that mean it's because I'm an idiot?";
  const look = GyText.lettering([text], { lang: "en" });
  const setFont = (s) => { ctx.font = `bold ${s}px ${look.family}`; };
  const measure = (s) => ctx.measureText(s).width;
  const opts = { maxSize: 40, minSize: 8, lang: "en", hyphenator: GyHyphen.hyphenateEn };
  const boxed = GyText.fitText(text, rect, setFont, measure, opts);
  const shaped = GyText.fitText(text, rect, setFont, measure, { ...opts, shape });
  assert.ok(shaped.shaped, "set to the shape");
  assert.ok(shaped.size >= boxed.size * 1.1, `${shaped.size} px in the shape against ${boxed.size} px in the rectangle`);
  // every line within the oval at its own height (where drawLines sets it: centred on the box, an
  // oval's widest place)
  setFont(shaped.size);
  assert.equal(shaped.cy, rect.y + rect.h / 2, "an oval is widest at its middle: the block stays centred on the box");
  const top = shaped.cy - (shaped.lines.length * shaped.lineHeight) / 2;
  shaped.lines.forEach((line, k) => {
    for (const y of [top + k * shaped.lineHeight, top + (k + 1) * shaped.lineHeight]) {
      const d = (y - B) / B, room = 2 * A * Math.sqrt(Math.max(0, 1 - d * d));
      assert.ok(measure(line) <= room, `"${line}" (${measure(line).toFixed(0)} px) at y ${y.toFixed(0)}, where the oval is ${room.toFixed(0)} px`);
    }
  });
  // no room at all: the box is fitted as before
  const none = GyText.fitText(text, rect, setFont, measure, { ...opts, shape: { dy: 0, step: 2, half: [1, 1] } });
  assert.ok(!none.shaped && none.size === boxed.size);
});

// ---------- text stays in its bubble (2.15) ----------
// An oval 120 × 180 drawn from 0,0; the shape is read short of the outline by `edge`, as layout.js
// roomShape reads it, and carries that margin
const oval = (edge, rect) => {
  const A = 60, B = 90, step = 2, half = [];
  for (let y = 0; y < 2 * B; y += step) { const d = (y + step / 2 - B) / B; const h = Math.floor(A * Math.sqrt(Math.max(0, 1 - d * d))); half.push(h ? Math.max(0, h - edge) : 0); }
  return { dy: -rect.y, step, half, edge };
};
const fitter = (text) => {
  const look = GyText.lettering([text], { lang: "en" });
  return { setFont: (s) => { ctx.font = `bold ${s}px ${look.family}`; }, measure: (s) => ctx.measureText(s).width, opts: { maxSize: 60, minSize: 8, lang: "en", hyphenator: GyHyphen.hyphenateEn } };
};
test("a box whose corners lie past the bubble: the text is set to the bubble's shape, every line inside", () => {
  // the box is the oval's own bounding box (the lettering's box with the room around it, as layout.js
  // makes it): fitted to the box alone, the lines run past the curve at the top and bottom
  const rect = { x: 0, y: 0, w: 120, h: 180 }, shape = oval(3, rect), text = "Does that mean it's because I'm an idiot, then?";
  const { setFont, measure, opts } = fitter(text);
  const boxed = GyText.fitText(text, rect, setFont, measure, opts);
  setFont(boxed.size);
  assert.ok(GyText.outsideRoom(boxed, rect, shape, measure, true) > 0.03, "the guard: the box's fit crosses the oval");
  const fit = GyText.fitText(text, rect, setFont, measure, { ...opts, shape });
  assert.ok(fit.shaped, `set to the shape (${fit.size} px; the box's ${boxed.size} px)`);
  setFont(fit.size);
  assert.ok(GyText.outsideRoom(fit, rect, shape, measure, true) <= 0.001, "inside the oval");
});
test("a box whose lines stay inside the outline but cross the margin is set to the shape, keeping the margin", () => {
  // a box well inside the oval (its middle), the shape read with a wide margin off the outline: the
  // box's fit is larger and inside the outline, but its lines reach into the margin, where they
  // came to touch the outline (2.15: before, the box was judged on the outline alone, and kept)
  const rect = { x: 25, y: 50, w: 70, h: 80 }, shape = oval(30, rect), text = "No way!! Really?";
  const { setFont, measure, opts } = fitter(text);
  const boxed = GyText.fitText(text, rect, setFont, measure, opts);
  setFont(boxed.size);
  assert.ok(GyText.outsideRoom(boxed, rect, shape, measure, true) <= 0.03, "the guard: the box's lines are inside the outline");
  assert.ok(GyText.outsideRoom(boxed, rect, shape, measure) > 0.03, "the guard: ...and cross the margin");
  const fit = GyText.fitText(text, rect, setFont, measure, { ...opts, shape });
  assert.ok(fit.shaped && fit.size < boxed.size, `set to the shape (${fit.size} px; the box's ${boxed.size} px)`);
  setFont(fit.size);
  assert.ok(GyText.outsideRoom(fit, rect, shape, measure) <= 0.001, "every line keeps the margin");
});
test("a shape keeps its own centre line when the box is trimmed afterwards: the lines stay in the room", () => {
  // layout.js separate() trims two overlapping boxes on their facing sides after their shapes are read;
  // centred on the trimmed box, the text sat 8 px off its room, against a caption's border (page 6)
  const room = { x: 0, y: 0, w: 120, h: 100 };
  const shape = { dy: 0, step: 2, half: Array(50).fill(54), edge: 6, cx: 60, top: 0 };
  const trimmed = { x: 16, y: 0, w: 104, h: 100 }; // its centre 68, the room's 60
  const text = "Even though losing these three hurts";
  const { setFont, measure, opts } = fitter(text);
  const fit = GyText.fitText(text, trimmed, setFont, measure, { ...opts, shape });
  assert.equal(fit.cx, 60, "drawn on the room's centre line, not the box's");
  setFont(fit.size);
  assert.ok(GyText.outsideRoom(fit, trimmed, shape, measure) <= 0.001, "every line inside the room, margin kept");
  // the guard: the same lines centred on the trimmed box leave the room
  assert.ok(GyText.outsideRoom({ ...fit, cx: undefined }, trimmed, shape, measure) > 0.001, "the guard: centred on the box, they cross");
});
test("font sizes go in quarter pixels: a room that holds a line a fraction of a pixel larger gets it", () => {
  // 3.0: whole pixels are 5–7% apart at dialogue sizes; most lines a bubble could hold at 0.7 of their size sat a pixel under it
  const text = "Even though";
  const look = GyText.lettering([text]), setFont = (s) => { ctx.font = `bold ${s}px ${look.family}`; }, measure = (s) => ctx.measureText(s).width;
  setFont(20); const w20 = measure(text); setFont(21); const w21 = measure(text);
  const w = (w20 + w21) / 2; // room between the two whole sizes
  const f = GyText.fitText(text, { x: 0, y: 0, w, h: 25 }, setFont, measure, { maxSize: 30, minSize: 8 }); // (one line only)
  assert.ok(f.size > 20 && f.size < 21 && Number.isInteger(f.size * 4), `size ${f.size}`);
  setFont(f.size); assert.ok(measure(text) <= w);
});

test("a box fit is judged by its letters' ink: a descender over the room's bottom counts as outside", () => {
  const look = GyText.lettering(["gypsy"]), setFont = (s) => { ctx.font = `bold ${s}px ${look.family}`; }, measure = (s) => ctx.measureText(s).width;
  setFont(40);
  const ink = (s) => { ctx.textAlign = "center"; ctx.textBaseline = "middle"; const m = ctx.measureText(s); return { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent }; };
  const fit = { size: 40, lines: ["gypsy"], lineHeight: 46, cy: 100 };
  const m = ink("gypsy");
  // a room whose rows end just under the line's middle 0.8 but over its descenders
  const shape = { dy: 0, step: 1, half: Array(Math.round(0.4 * 40 + 23)).fill(200), edge: 0, cx: 100, top: 100 - 23 };
  const rect = { x: 0, y: 77, w: 200, h: 46 };
  assert.ok(m.d > 0.4 * 40 + 1, "the font's descenders reach past the middle 0.8");
  assert.equal(GyText.outsideRoom(fit, rect, shape, measure), 0, "by the middle 0.8: all inside");
  assert.ok(GyText.outsideRoom(fit, rect, shape, measure, false, ink) > 0, "by the ink: the descenders are outside");
});

test("a room that narrows under the lettering: the block moves to where the room is wide, every line inside", () => {
  // a caption box whose room is wide over its top 80 px and a strip below (the bubble's tail, a
  // corner): centred on the box, the block could take 60 px at most; above, it takes up to 80
  const rect = { x: 0, y: 0, w: 120, h: 100 };
  const shape = { dy: 0, step: 2, half: [...Array(40).fill(60), ...Array(10).fill(12)], edge: 0 };
  const text = "Where did everyone go so late tonight, and why?";
  const { setFont, measure, opts } = fitter(text);
  const fit = GyText.fitText(text, rect, setFont, measure, { ...opts, shape });
  assert.ok(fit.shaped, "set to the shape");
  assert.ok(fit.cy < rect.y + rect.h / 2, `moved up (centre ${fit.cy})`);
  assert.ok(fit.lines.length * fit.lineHeight > 60, `taller than a centred block could be (${fit.lines.length} × ${fit.lineHeight.toFixed(1)} px)`);
  setFont(fit.size);
  assert.ok(GyText.outsideRoom(fit, rect, shape, measure) <= 0.001, "every line inside the room");
  // a room as wide at the lettering as anywhere: the block stays centred on it
  const even = GyText.fitText(text, rect, setFont, measure, { ...opts, shape: { dy: 0, step: 2, half: Array(50).fill(60), edge: 0 } });
  assert.equal(even.cy, rect.y + rect.h / 2);
});
test("nothing fits at the floor: words may run past the box's sides a little, never past its top and bottom", () => {
  // a narrow bubble's box: the floor is too large for the lines it needs; before 2.15 they were set at
  // the floor anyway and ran out of the bubble above and below
  const rect = { x: 0, y: 0, w: 60, h: 40 }, text = "Wait, what is that over there?"; // (main: 4 lines, 64 px)
  const { setFont, measure } = fitter(text);
  const fit = GyText.fitText(text, rect, setFont, measure, { maxSize: 30, minSize: 14, lang: "en", hyphenator: null });
  assert.ok(fit.lines.length * fit.lineHeight <= rect.h + 0.5 || fit.forced, `${fit.lines.length} lines of ${fit.lineHeight.toFixed(1)} px in ${rect.h} px`);
});
test("the share of a fit outside its room: none in the box, all of it past a shape with no room", () => {
  const rect = { x: 0, y: 0, w: 200, h: 60 }, text = "Hello there";
  const { setFont, measure, opts } = fitter(text);
  const fit = GyText.fitText(text, rect, setFont, measure, opts); setFont(fit.size);
  assert.equal(GyText.outsideRoom(fit, rect, null, measure), 0);
  assert.equal(GyText.outsideRoom(fit, rect, { dy: 0, step: 6, half: Array(10).fill(0) }, measure), 1);
});

test("the lines of one bubble stay within 20% of each other's size; lettering of two sizes keeps both; the line peeked at keeps its sibling's", () => {
  const c = createCanvas(600, 400).getContext("2d");
  const line = (text, rect, letter = 20) => ({ text, rect, letter, measured: true, tag: 7, halo: false, color: "#000" });
  const roomy = line("Okay.", { x: 10, y: 10, w: 260, h: 200 }), tight = line("That is a long thing to say in here.", { x: 300, y: 10, w: 110, h: 120 });
  const alone = (p) => { const s = []; GyText.draw(c, [{ ...p, tag: p === roomy ? 1 : 2 }], { sizes: s }); return s[0]; };
  assert.ok(alone(roomy) > alone(tight) * 1.2, `the guard: ${alone(roomy)} px and ${alone(tight)} px alone`);
  const both = []; GyText.draw(c, [roomy, tight], { sizes: both });
  assert.ok(both[0] <= Math.floor(1.2 * both[1]) && both[0] > both[1], `${both.join(" and ")} px`);
  assert.equal(both[1], alone(tight));
  const peeked = []; const drawn = GyText.draw(c, [roomy, tight], { sizes: peeked, skip: tight });
  assert.equal(drawn, 1); assert.deepEqual(peeked, both);
  const shout = []; GyText.draw(c, [{ ...roomy, letter: 30 }, tight], { sizes: shout });
  assert.ok(shout[0] > shout[1], `lettering 30 and 20 px: ${shout.join(" and ")}`);
  // a line that can only be set far under its lettering's size: the other keeps 0.7 of its own
  const cramped = line("This is far too much text for a bubble this small, really.", { x: 300, y: 10, w: 60, h: 50 });
  const pair = []; GyText.draw(c, [roomy, cramped], { sizes: pair });
  assert.ok(pair[1] < 0.7 * 20 * 1.45, `the guard: the cramped line at ${pair[1]} px`);
  assert.ok(pair[0] >= Math.floor(0.7 * 20 * 1.45) && pair[0] > pair[1], `the roomy line at ${pair[0]} px beside ${pair[1]} px`);
});
test("a placement's other room (centred on the lettering) is used when the text fits it larger", () => {
  const c = createCanvas(600, 400).getContext("2d");
  const p = { text: "Somewhere over there, far away.", rect: { x: 10, y: 10, w: 60, h: 100 }, letter: 20, measured: true, tag: 1, halo: false, color: "#000" };
  const s1 = [], s2 = [];
  GyText.draw(c, [p], { sizes: s1 });
  GyText.draw(c, [{ ...p, alt: [{ rect: { x: 10, y: 10, w: 200, h: 120 } }] }], { sizes: s2 });
  assert.ok(s2[0] > s1[0], `${s2[0]} px with the other room, ${s1[0]} px without`);
});

// ---------- Claude's size label scales only a guessed size (2.15) ----------
test("a line on measured lettering is drawn at its size whatever Claude's label; a guessed size follows the label", () => {
  const at = (size, measured) => { const sizes = []; GyText.draw(createCanvas(600, 400).getContext("2d"), [{ text: "Hey!", rect: { x: 10, y: 10, w: 500, h: 300 }, letter: 30, size, tag: measured ? 1 : null, halo: false, color: "#000", ...(measured ? { measured: true } : {}) }], { sizes }); return sizes[0]; };
  assert.equal(at("small", true), at("normal", true));
  assert.equal(at("large", true), at("normal", true));
  assert.ok(at("small", false) < at("normal", false));
  assert.ok(at("large", false) > at("normal", false));
});

console.log(`lettering: ${passed} checks passed`);
