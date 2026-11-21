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
  // every line within the oval at its own height (centred on the box, as drawLines sets it)
  setFont(shaped.size);
  const top = rect.y + rect.h / 2 - (shaped.lines.length * shaped.lineHeight) / 2;
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

console.log(`lettering: ${passed} checks passed`);
