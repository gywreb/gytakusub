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

  // A word is split only when it has 8 letters or more, with 3 letters at least on each side
  // (punctuation not counted): "CY-CLONE!", "TRIG-GER!", "ex-pect-ed..." and "un-deresti-mate" read
  // badly; a letterer would sooner set the line a little smaller (2.14).
  const HYPHEN_MIN_WORD = 8, HYPHEN_MIN_SIDE = 3;
  const lettersIn = (s) => [...s].filter((c) => LETTER_RE.test(c)).length;

  /** Split `word` at its hyphenation points: ["impos","si","ble"]; [word] if none. */
  function syllables(word, hyphenate = englishHyphenator()) {
    if (!hyphenate || !WORD_RE.test(word)) return [word];
    const total = lettersIn(word);
    if (total < HYPHEN_MIN_WORD) return [word];
    const parts = hyphenate(word).split(SHY).filter(Boolean);
    // join the pieces across points that would leave fewer than 3 letters on a side
    const out = [];
    let before = 0;
    for (const p of parts) {
      if (out.length && (before < HYPHEN_MIN_SIDE || total - before < HYPHEN_MIN_SIDE)) out[out.length - 1] += p;
      else out.push(p);
      before += lettersIn(p);
    }
    return out.length > 1 ? out : [word];
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
    // maxW: one width for every line, or each line's own (k) => width (a bubble's shape, 2.14.1)
    const widthOf = typeof maxW === "function" ? maxW : () => maxW;
    const toks = tokens(text, opts.lang);
    const hyph = opts.hyphenator === undefined ? englishHyphenator() : opts.hyphenator;
    const lines = [];
    let cur = "", broken = false, hyphens = 0;
    const join = (line, tok) => (line ? line + (tok.gap ? " " : "") + tok.t : tok.t);
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      const t = join(cur, tok);
      if (measure(t) <= widthOf(lines.length)) { cur = t; i++; continue; }
      // try to hyphenate the word across the line boundary
      const parts = opts.hyphenate === false || tok.tight ? [tok.t] : syllables(tok.t, hyph);
      if (parts.length > 1) {
        let best = 0;
        for (let k = 1; k < parts.length; k++) {
          const cand = join(cur, { t: parts.slice(0, k).join("") + "-", gap: tok.gap });
          if (measure(cand) <= widthOf(lines.length)) best = k; else break;
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
        const pieces = cutWord(measure, tok.t, widthOf(lines.length), false);
        lines.push(...pieces.slice(0, -1)); cur = pieces.at(-1) || ""; i++; continue;
      }
      broken = true;
      if (!opts.force) { lines.push(tok.t); i++; continue; } // report; fitText will try a smaller size
      const pieces = cutWord(measure, tok.t, widthOf(lines.length), true);
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
    if (opts.shape) {
      // the shape's fit, or the box's when it is larger and its lines stay in the room: the box is
      // the lettering's own box with the room around it, and its corners may lie past a curved or
      // slanted side, where its lines crossed the outline (2.15, the owner's French chapter)
      const shaped = fitShape(text, rect, opts.shape, setFont, measure, opts);
      const boxed = fitText(text, rect, setFont, measure, { ...opts, shape: null });
      // (judged on the room as the bubble's ink bounds it, when the layout gives it: `bound`)
      const pick = shaped && shaped.size >= boxed.size ? shaped : !shaped ? boxed : (setFont(boxed.size), outsideRoom(boxed, rect, opts.bound || opts.shape, measure, true) <= (opts.outsideOk ?? 0.03)) ? boxed : shaped;
      setFont(pick.size); return pick;
    }
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
    // before they are ever cut letter by letter, which is unreadable. Across only: lines
    // past the box's top and bottom ran out of narrow bubbles (2.15, the owner's French chapter).
    setFont(minSize);
    const whole = wrapInfo(measure, text, rect.w, { ...how, hyphenate: false });
    if (whole.lines.length * minSize * lh <= rect.h && Math.max(0, ...whole.lines.map(measure)) <= rect.w * 1.3) return { size: minSize, lines: whole.lines, lineHeight: minSize * lh, hyphens: 0, overflow: true };
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

  /**
   * fitText() in a bubble's shape (engine/layout.js roomShape): each line as wide as the room on
   * both sides of the box's centre line over that line's height (the shape keeps its own margin off
   * the outline: before 2.15 a fifth of the size more came off each side, and lines a bubble could
   * hold at 0.7 of their size came out smaller), the block centred on the box as drawLines() centres it. The largest size that fits,
   * unhyphenated first as in fitText(); null when nothing fits at the floor (fitText then fits the
   * box). A rectangle in an oval leaves its widest rows unused: 140 of the 171 lines set under 0.7
   * of their original size sat in boxes under 5 letters wide (2.14.1).
   */
  function fitShape(text, rect, shape, setFont, measure, opts) {
    const lh = opts.lineHeightRatio ?? 1.15;
    const top0 = rect.y + shape.dy, bottom0 = top0 + shape.half.length * shape.step;
    const cy = rect.y + rect.h / 2;
    const tall = 2 * Math.min(cy - top0, bottom0 - cy); // the most a block centred on the box can take
    const minSize = Math.max(6, Math.round(opts.minSize ?? 8));
    const maxSize = Math.floor(Math.min(opts.maxSize ?? 72, tall / lh));
    if (!(maxSize >= minSize)) return null;
    const halfOver = (y0, y1) => {
      if (y0 < top0 || y1 > bottom0) return 0;
      let h = Infinity;
      const k1 = Math.min(shape.half.length - 1, Math.floor((y1 - top0) / shape.step));
      for (let k = Math.floor((y0 - top0) / shape.step); k <= k1; k++) h = Math.min(h, shape.half[k]);
      return h === Infinity ? 0 : h;
    };
    const widths = (n, size) => {
      const line = size * lh, top = cy - (n * line) / 2;
      // (the shape already keeps its margin off the outline: layout.js roomShape, LAYOUT.edgeLetters)
      return Array.from({ length: n }, (_, k) => Math.max(0, 2 * halfOver(top + k * line, top + (k + 1) * line)));
    };
    const how = { lang: opts.lang, hyphenator: opts.hyphenator };
    const linesAt = (size, hyphenate) => {
      setFont(size);
      for (let n = 1; n * size * lh <= tall; n++) {
        const ws = widths(n, size);
        if (ws.some((w) => w <= 0)) break; // past the shape: more lines only reach further
        const w = wrapInfo(measure, text, (k) => ws[Math.min(k, n - 1)], { ...how, hyphenate });
        if (w.broken || w.lines.length > n) continue;
        const got = w.lines.length === n ? ws : widths(w.lines.length, size); // fewer lines sit closer to the middle
        if (w.lines.every((l, j) => measure(l) <= got[j])) return w;
      }
      return null;
    };
    // the largest size that fits, by halving (a smaller size fits wherever a larger one does, but
    // for rare line-break accidents: then a size that would fit can be passed over)
    const largest = (hyphenate) => {
      let lo = minSize, hi = maxSize, found = null;
      while (lo <= hi) { const mid = (lo + hi) >> 1; const w = linesAt(mid, hyphenate); if (w) { found = { size: mid, w }; lo = mid + 1; } else hi = mid - 1; }
      return found;
    };
    const plain = largest(false), hy = largest(true);
    const pick = (f, hyphens) => f && { size: f.size, lines: f.w.lines, lineHeight: f.size * lh, hyphens, shaped: true };
    if (plain && (!hy || !hy.w.hyphens || plain.size >= hy.size * (opts.hyphenRatio ?? 0.75))) { setFont(plain.size); return pick(plain, 0); }
    if (hy && hy.w.hyphens) { setFont(hy.size); return pick(hy, hy.w.hyphens); }
    return null;
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

  /**
   * The share of a fitted text's letters (each line's width and middle 0.8 of its size) that lies
   * outside its room: the rectangle, or in a
   * bubble's shape the width the shape gives on each line's rows (engine/layout.js roomShape; with
   * `toOutline`, up to the outline, not the margin the shape keeps off it). The debug report records
   * it per line (2.15): text that ran past its bubble showed in the owner's chapters, and nothing
   * measured it.
   */
  function outsideRoom(fit, rect, shape, measure, toOutline = false) {
    const total = fit.lines.length * fit.lineHeight, top = rect.y + (rect.h - total) / 2;
    const top0 = shape ? rect.y + shape.dy : rect.y, bottom0 = shape ? top0 + shape.half.length * shape.step : rect.y + rect.h;
    const more = toOutline ? shape?.edge || 0 : 0; // (the shape keeps a margin off the outline: up to the outline itself)
    const halfAt = (y0, y1) => {
      if (!shape) return rect.w / 2;
      let h = Infinity;
      for (let k = Math.max(0, Math.floor((y0 - top0) / shape.step)); k <= Math.min(shape.half.length - 1, Math.floor((y1 - top0) / shape.step)); k++) h = Math.min(h, shape.half[k] ? shape.half[k] + more : 0);
      return h === Infinity ? 0 : h;
    };
    // each line's letters: its width, and the middle 0.8 of its size (not the leading between lines)
    let all = 0, out = 0;
    fit.lines.forEach((line, k) => {
      const body = 0.8 * fit.size, y0 = top + k * fit.lineHeight + (fit.lineHeight - body) / 2, y1 = y0 + body, w = measure(line), a = w * body;
      const iy0 = Math.max(y0, top0), iy1 = Math.min(y1, bottom0), half = iy1 > iy0 ? halfAt(iy0, iy1) : 0;
      all += a; out += a - Math.max(0, iy1 - iy0) * Math.min(w, 2 * half);
    });
    return all ? +(out / all).toFixed(3) : 0;
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
   * @param {{fontFamily?:string, uppercase?:boolean, lang?:string|null, hyphenator?:Function|null, pageTexts?:string[], skip?:object|null, sizes?:number[], fits?:object[]}} opts
   *   `lang`: the target language's BCP 47 tag (line breaking, upper case, CJK font); with it,
   *   only `hyphenator` hyphenates (English's is built in). Without `lang`: English rules.
   *   `pageTexts`: every line of the page, when drawing only some, so the font stays the same.
   *   `skip`: a placement fitted but not drawn (the line peeked at: its bubble's other lines keep
   *   their size, which depends on it). `sizes`, `fits`: filled per placement, drawn or not.
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
    // Each line's fit: the size its room allows (`plans`), then the lines of one bubble whose
    // lettering was one size kept within 20% of each other's size, as the letterer set them alike
    // (2.15: in a two-lobe bubble of the owner's French chapter, one translation came out at 31 px and
    // the other at 20). Never below 0.7 of a line's own lettering for that: when one line can only be
    // set smaller, the others don't follow it. (All at the smallest size set 11 more lines of 456
    // under 0.7 on real pages; within 20%, 3.)
    const plans = placements.map((p, i) => {
      const text = texts[i];
      // `letter` is the original cap height. The translation's capitals (or a Han character's
      // ink) are made about as tall: 1.45 × letter for Comic Neue, scaled by each font's own
      // cap height. Inside a bubble it may grow up to 30% beyond that when there is room
      // (letterers fill a roomy bubble a little); over artwork it keeps the original size.
      // Claude's size ("small", "large") scales only a letter size guessed for the page: one measured
      // on the lettering the line replaces has its size already, and was scaled twice (2.15)
      const target = p.letter * 1.45 * (BASE_CAP / look.cap) * (p.measured ? 1 : SIZE_MUL[p.size] || 1);
      const inBubble = p.tag != null && !p.halo;
      const how = { maxSize: inBubble ? target * 1.3 : target, minSize: Math.max(7, target * 0.35), lang, hyphenator };
      return { p, text, inBubble, how, target, ...fitBest(text, p, inBubble, how) };
    });
    function fitBest(text, p, inBubble, how) {
      // the placement's room, or another the layout offers (the room centred on the lettering itself):
      // the one that fits the text larger, the placement's own on a tie
      let fit = null, at = p;
      for (const t of inBubble ? [p, ...(p.alt || [])] : [p]) {
        const f = fitText(text, t.rect, setFont, measure, { ...how, shape: inBubble ? t.shape : null, bound: inBubble ? t.bound : null });
        if (!fit || f.size > fit.size) { fit = f; at = t; }
      }
      return { fit, at };
    }
    const bubbles = new Map();
    for (const q of plans) if (q.inBubble) { if (!bubbles.has(q.p.tag)) bubbles.set(q.p.tag, []); bubbles.get(q.p.tag).push(q); }
    for (const group of bubbles.values()) {
      if (group.length < 2) continue;
      const letters = group.map((q) => q.p.letter);
      if (Math.max(...letters) > Math.min(...letters) * 1.2) continue; // lettering of two sizes: a shout beside a whisper keeps both
      const least = Math.min(...group.map((q) => q.fit.size));
      for (const q of group) {
        const size = Math.max(Math.floor(1.2 * least), Math.floor(0.7 * q.target));
        if (q.fit.size > size) Object.assign(q, fitBest(q.text, q.p, true, { ...q.how, maxSize: size, minSize: Math.min(q.how.minSize, size) }));
      }
    }
    let n = 0;
    plans.forEach(({ p, fit, at, inBubble }, i) => {
      setFont(fit.size);
      if (p !== opts.skip) { drawLines(ctx, fit, at.rect, p.color, family, p.halo); n++; }
      if (opts.sizes) opts.sizes[i] = fit.size; // the size each line was drawn at, for callers that need it
      if (opts.fits) opts.fits[i] = { size: fit.size, lines: fit.lines.length, outside: outsideRoom(fit, at.rect, inBubble ? at.bound || at.shape : null, measure, true) };
    });
    return n;
  }

  root.GyText = { draw, fitText, wrapInfo, syllables, tokens, lettering, outsideRoom, DEFAULT_FONT };
})(typeof globalThis !== "undefined" ? globalThis : this);
