// Page-side text fitting and drawing (classic script: content scripts cannot be
// modules). Exposes globalThis.GyText.
// - Fonts: vendor/lettering-fonts.js (globalThis.GyFonts) lists the bundled fonts and their
//   characters; a page is lettered in the first one that has every letter of its translations.
//   Chinese, Japanese and Korean use the system's font for that language.
// - Hyphenation: vendor/hyphen-en.js (globalThis.GyHyphen) for English; other languages pass a
//   hyphenator built from vendor/hyphen/<name>.json. Words are never split otherwise, unless
//   nothing else fits.
// - Scripts written without spaces (Chinese, Japanese, Thai) break between words
//   (Intl.Segmenter), never before a closing mark or after an opening one.
((root) => {
  "use strict";
  const SHY = "­";
  const WORD_RE = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u; // scripts that hyphenate with "-"
  const NO_SPACE_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
  // Line-start and line-end rules (Japanese kinsoku, also used for Chinese): these never start a line…
  const NO_START = new Set([..."、。，．・：；？！ー」』）〕］｝〉》】〙〗〟’”ゝゞヽヾ々〻っゃゅょゎぁぃぅぇぉッャュョヮァィゥェォヵヶ‐゠–〜～…‥,.!?:;)]}%％‼⁇⁈⁉"]);
  // …and these never end one.
  const NO_END = new Set([..."「『（〔［｛〈《【〘〖〝‘“([{"]);
  const LETTER_RE = /[\p{L}\p{M}]/u;
  const FALLBACK = '"Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  const DEFAULT_FONT = `"Gytakusub Comic", "Comic Neue", ${FALLBACK}`;
  // Chinese, Japanese and Korean: the system's font for each (rounded where there is one), so
  // shared Han characters take that language's forms.
  const CJK_FONTS = {
    ja: '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Yu Gothic UI", "Yu Gothic", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP", sans-serif',
    ko: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Noto Sans KR", sans-serif',
    "zh-Hant": '"PingFang TC", "Microsoft JhengHei", "Noto Sans CJK TC", "Noto Sans TC", sans-serif',
    "zh-Hans": '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif',
  };
  const CJK_CAP = 0.82; // ink height of a Han character, in em (estimate; caps are ~0.7 em in Latin fonts)
  const BASE_CAP = 0.67; // Comic Neue Bold's cap height: the size rules below were tuned with it
  const SIZE_MUL = { small: 0.8, normal: 1, large: 1.3 };
  const englishHyphenator = () => (root.GyHyphen && root.GyHyphen.hyphenateEn) || null;
  const segmenters = new Map();

  /** Split `word` at its hyphenation points: ["im","pos","si","ble"]; [word] if none. */
  function syllables(word, hyphenate = englishHyphenator()) {
    if (!hyphenate || [...word].length < 6 || !WORD_RE.test(word)) return [word];
    const parts = hyphenate(word).split(SHY).filter(Boolean);
    return parts.length > 1 ? parts : [word];
  }

  /** The language Intl.Segmenter should read a run of `text` as. */
  function segmentLang(text, lang) {
    if (lang && /^(ja|zh|th|lo|km|my)\b/i.test(lang)) return lang;
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) return "ja";
    if (/\p{Script=Thai}/u.test(text)) return "th";
    return "zh";
  }

  /**
   * The units a line may break between: words, each with `gap` (a space before it). Runs in a
   * script written without spaces are cut into words, with closing marks kept on the word before
   * and opening marks on the word after; those words are `tight` (no hyphen when cut).
   */
  function tokens(text, lang) {
    const out = [];
    for (const chunk of String(text).split(/\s+/).filter(Boolean)) {
      if (!NO_SPACE_RE.test(chunk) || typeof Intl === "undefined" || !Intl.Segmenter) { out.push({ t: chunk, gap: out.length > 0 }); continue; }
      const sl = segmentLang(chunk, lang);
      let seg = segmenters.get(sl);
      if (!seg) { try { seg = new Intl.Segmenter(sl, { granularity: "word" }); } catch { seg = new Intl.Segmenter(undefined, { granularity: "word" }); } segmenters.set(sl, seg); }
      const words = [];
      for (const { segment } of seg.segment(chunk)) {
        const prev = words.at(-1);
        if (prev && (NO_START.has(segment[0]) || NO_END.has(prev.at(-1)))) words[words.length - 1] = prev + segment;
        else words.push(segment);
      }
      words.forEach((w, i) => out.push({ t: w, gap: i === 0 && out.length > 0, tight: true }));
    }
    return out;
  }

  /** Cut a word that is wider than the line into pieces that fit, character by character. */
  function cutWord(measure, word, maxW, hyphen) {
    const pieces = [];
    let piece = "";
    for (const ch of [...word]) {
      const mark = hyphen && WORD_RE.test(ch) && piece && WORD_RE.test(piece.at(-1)) ? "-" : "";
      if (piece && measure(piece + ch + mark) > maxW && !NO_START.has(ch)) { pieces.push(piece + mark); piece = ch; }
      else piece += ch;
    }
    if (piece) pieces.push(piece);
    return pieces;
  }

  /**
   * Greedy line breaking with hyphenation. `broken` is set when a word had to be
   * split without a hyphenation point (or overflows the width). opts: `hyphenate`
   * (false: never), `hyphenator` (a function, null for none; English when absent),
   * `lang` (for line breaking), `force` (cut words that don't fit).
   */
  function wrapInfo(measure, text, maxW, opts = {}) {
    const toks = tokens(text, opts.lang);
    const hyph = opts.hyphenator === undefined ? englishHyphenator() : opts.hyphenator;
    const lines = [];
    let cur = "", broken = false, hyphens = 0;
    const join = (line, tok) => (line ? line + (tok.gap ? " " : "") + tok.t : tok.t);
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      const t = join(cur, tok);
      if (measure(t) <= maxW) { cur = t; i++; continue; }
      // try to hyphenate the word across the line boundary
      const parts = opts.hyphenate === false || tok.tight ? [tok.t] : syllables(tok.t, hyph);
      if (parts.length > 1) {
        let best = 0;
        for (let k = 1; k < parts.length; k++) {
          const cand = join(cur, { t: parts.slice(0, k).join("") + "-", gap: tok.gap });
          if (measure(cand) <= maxW) best = k; else break;
        }
        if (best > 0) {
          lines.push(join(cur, { t: parts.slice(0, best).join("") + "-", gap: tok.gap }));
          cur = ""; hyphens++;
          toks[i] = { t: parts.slice(best).join(""), gap: false }; // the remainder is wrapped like a word
          continue;
        }
      }
      if (cur) { lines.push(cur); cur = ""; continue; } // start a fresh line with this word
      // a lone word wider than the line
      if (tok.tight) { // Chinese, Japanese, Thai: any character boundary is a fair break
        const pieces = cutWord(measure, tok.t, maxW, false);
        lines.push(...pieces.slice(0, -1)); cur = pieces.at(-1) || ""; i++; continue;
      }
      broken = true;
      if (!opts.force) { lines.push(tok.t); i++; continue; } // report; fitText will try a smaller size
      const pieces = cutWord(measure, tok.t, maxW, true);
      lines.push(...pieces.slice(0, -1)); cur = pieces.at(-1) || ""; i++;
    }
    if (cur) lines.push(cur);
    return { lines, broken, hyphens };
  }

  /**
   * Largest font size (≤ target) whose wrapped lines fit in rect. At each size the
   * un-hyphenated wrap is tried first; hyphenation is a fallback for when it does
   * not fit (TeX's hyphen penalty, in spirit), and a clean fit wins unless it is
   * much smaller than the best hyphenated one.
   */
  function fitText(text, rect, setFont, measure, opts = {}) {
    const minSize = Math.max(6, Math.round(opts.minSize ?? 8));
    const maxSize = Math.max(minSize, Math.floor(Math.min(opts.maxSize ?? 72, rect.h)));
    const lh = opts.lineHeightRatio ?? 1.15;
    const fits = (w) => !w.broken && w.lines.length * size * lh <= rect.h && Math.max(0, ...w.lines.map(measure)) <= rect.w;
    const how = { lang: opts.lang, hyphenator: opts.hyphenator };
    let clean = null, hyph = null, size;
    for (size = maxSize; size >= minSize; size--) {
      setFont(size);
      const plain = wrapInfo(measure, text, rect.w, { ...how, hyphenate: false });
      if (fits(plain)) { clean = { size, lines: plain.lines, lineHeight: size * lh, hyphens: 0 }; break; }
      if (!hyph) {
        const h = wrapInfo(measure, text, rect.w, how);
        if (h.hyphens && fits(h)) hyph = { size, lines: h.lines, lineHeight: size * lh, hyphens: h.hyphens };
      }
    }
    if (clean && (!hyph || clean.size >= hyph.size * (opts.hyphenRatio ?? 0.75))) return clean;
    if (hyph) return hyph;
    // Nothing fits even at the minimum size. Words are kept whole and allowed to
    // run past the box a little (a letterer lets a long word kiss the outline)
    // before they are ever cut letter by letter, which is unreadable.
    setFont(minSize);
    const whole = wrapInfo(measure, text, rect.w, { ...how, hyphenate: false });
    if (Math.max(0, ...whole.lines.map(measure)) <= rect.w * 1.3) return { size: minSize, lines: whole.lines, lineHeight: minSize * lh, hyphens: 0, overflow: true };
    // Still too big: the floor (a share of the original lettering's size) is wrong for this box,
    // so it gives way before any word is cut. A floor of 64 px set "There you are!" in a 97 px
    // bubble as "e / you / ar- / e!" (2.13.1).
    for (size = minSize - 1; size >= (opts.lowest ?? 6); size--) {
      setFont(size);
      const plain = wrapInfo(measure, text, rect.w, { ...how, hyphenate: false });
      if (fits(plain)) return { size, lines: plain.lines, lineHeight: size * lh, hyphens: 0, below: true };
      const h = wrapInfo(measure, text, rect.w, how);
      if (h.hyphens && fits(h)) return { size, lines: h.lines, lineHeight: size * lh, hyphens: h.hyphens, below: true };
    }
    setFont(minSize);
    const { lines } = wrapInfo(measure, text, rect.w, { ...how, force: true });
    return { size: minSize, lines, lineHeight: minSize * lh, hyphens: 0, forced: true };
  }

  function drawLines(ctx, fit, rect, color, family, halo) {
    ctx.font = `bold ${fit.size}px ${family}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const total = fit.lines.length * fit.lineHeight;
    let y = rect.y + (rect.h - total) / 2 + fit.lineHeight / 2;
    const cx = rect.x + rect.w / 2;
    for (const line of fit.lines) {
      if (halo) { ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, fit.size * 0.22); ctx.strokeStyle = color === "#fff" ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.92)"; ctx.strokeText(line, cx, y); }
      ctx.fillStyle = color; ctx.fillText(line, cx, y); y += fit.lineHeight;
    }
  }

  const covers = (font, cp) => {
    const r = font.ranges;
    let lo = 0, hi = r.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (cp < r[mid][0]) hi = mid - 1; else if (cp > r[mid][1]) lo = mid + 1; else return true; }
    return false;
  };
  const cjkKey = (lang, letters) => {
    const l = String(lang || "").toLowerCase();
    if (/^ja\b/.test(l)) return "ja";
    if (/^ko\b/.test(l)) return "ko";
    if (/^zh\b/.test(l)) return /hant|-tw|-hk|-mo/.test(l) ? "zh-Hant" : "zh-Hans";
    if (letters.some((c) => /\p{Script=Hangul}/u.test(c))) return "ko";
    if (letters.some((c) => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(c))) return "ja";
    return "zh-Hans";
  };

  /**
   * The font for a page whose translations are `texts`: { family, cap, font }. The first bundled
   * font that has every letter, so no word is drawn in two fonts; Chinese, Japanese or Korean
   * text gets the system font for its language. A font set in Settings comes first either way.
   */
  function lettering(texts, opts = {}) {
    const letters = [...new Set(texts.flatMap((t) => [...String(t)]).filter((c) => LETTER_RE.test(c)))];
    const user = (opts.fontFamily || "").trim();
    const lead = user ? `${user}, ` : "";
    if (letters.some((c) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c))) {
      const key = cjkKey(opts.lang, letters);
      return { family: lead + CJK_FONTS[key], cap: CJK_CAP, font: null, cjk: key };
    }
    const fonts = root.GyFonts || [];
    const cps = letters.map((c) => c.codePointAt(0));
    const font = fonts.find((f) => cps.every((cp) => covers(f, cp))) || null;
    if (!fonts.length) return { family: lead + DEFAULT_FONT, cap: BASE_CAP, font: null };
    // nothing bundled has them all (an unlisted script): the browser picks per character
    const family = font ? `"${font.family}", ${FALLBACK}` : `${fonts.map((f) => `"${f.family}"`).join(", ")}, ${FALLBACK}`;
    return { family: lead + family, cap: font ? font.cap : BASE_CAP, font };
  }

  function drawLines(ctx, fit, rect, color, family, halo) {
    ctx.font = `bold ${fit.size}px ${family}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const total = fit.lines.length * fit.lineHeight;
    let y = rect.y + (rect.h - total) / 2 + fit.lineHeight / 2;
    const cx = rect.x + rect.w / 2;
    for (const line of fit.lines) {
      if (halo) { ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, fit.size * 0.22); ctx.strokeStyle = color === "#fff" ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.92)"; ctx.strokeText(line, cx, y); }
      ctx.fillStyle = color; ctx.fillText(line, cx, y); y += fit.lineHeight;
    }
  }

  const upper = (text, lang) => { try { return text.toLocaleUpperCase(lang || undefined); } catch { return text.toUpperCase(); } };

  /**
   * Draw every placement onto ctx (which already shows the cleaned page).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} placements from engine/layout.js, in ctx pixel units
   * @param {{fontFamily?:string, uppercase?:boolean, lang?:string|null, hyphenator?:Function|null, pageTexts?:string[]}} opts
   *   `lang`: the target language's BCP 47 tag (line breaking, upper case, CJK font); with it,
   *   only `hyphenator` hyphenates (English's is built in). Without `lang`: English rules.
   *   `pageTexts`: every line of the page, when drawing only some, so the font stays the same.
   * @returns {number} count drawn
   */
  function draw(ctx, placements, opts = {}) {
    const lang = opts.lang || null;
    const hyphenator = opts.hyphenator !== undefined ? opts.hyphenator : !lang || /^en\b/i.test(lang) ? englishHyphenator() : null;
    const texts = placements.map((p) => (opts.uppercase ? upper(p.text, lang) : p.text));
    // one font for the whole page, even while some of its lines are hidden (peeking)
    const look = lettering(opts.pageTexts ? opts.pageTexts.map((t) => (opts.uppercase ? upper(t, lang) : t)) : texts, opts);
    if (lang && "lang" in ctx) { try { ctx.lang = lang; } catch { /* older browsers: no per-canvas language */ } }
    const family = look.family;
    const setFont = (size) => { ctx.font = `bold ${size}px ${family}`; };
    const measure = (s) => ctx.measureText(s).width;
    let n = 0;
    placements.forEach((p, i) => {
      const text = texts[i];
      // `letter` is the original cap height. The translation's capitals (or a Han character's
      // ink) are made about as tall: 1.45 × letter for Comic Neue, scaled by each font's own
      // cap height. Inside a bubble it may grow up to 30% beyond that when there is room
      // (letterers fill a roomy bubble a little); over artwork it keeps the original size.
      const target = p.letter * 1.45 * (BASE_CAP / look.cap) * (SIZE_MUL[p.size] || 1);
      const inBubble = p.tag != null && !p.halo;
      const fit = fitText(text, p.rect, setFont, measure, { maxSize: inBubble ? target * 1.3 : target, minSize: Math.max(7, target * 0.35), lang, hyphenator });
      drawLines(ctx, fit, p.rect, p.color, family, p.halo);
      if (opts.sizes) opts.sizes[i] = fit.size; // the size each line was drawn at, for callers that need it
      n++;
    });
    return n;
  }

  root.GyText = { draw, fitText, wrapInfo, syllables, tokens, lettering, DEFAULT_FONT };
})(typeof globalThis !== "undefined" ? globalThis : this);
