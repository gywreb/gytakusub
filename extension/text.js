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
   * A word joined by hyphens ("remote-controlled", "peut-être") in the pieces a line may end on: after
   * a hyphen between two letters, as every reader breaks it, no hyphen added; the same 3 letters at
   * least on each side as a hyphenation point. (2.15: "remote-controlled" was one word too wide for
   * its bubble's lobe, and the line came out at 19 px where the lettering was 28.)
   */
  function compound(word) {
    const parts = word.split(/(?<=\p{L}-)(?=\p{L})/u);
    if (parts.length < 2) return parts;
    const total = lettersIn(word), out = [];
    let before = 0;
    for (const p of parts) {
      if (out.length && (before < HYPHEN_MIN_SIDE || total - before < HYPHEN_MIN_SIDE)) out[out.length - 1] += p;
      else out.push(p);
      before += lettersIn(p);
    }
    return out;
  }

  /**
   * The units a line may break between: words, each with `gap` (a space before it). Runs in a
   * script written without spaces are cut into words, with closing marks kept on the word before
   * and opening marks on the word after; those words are `tight` (no hyphen when cut).
   */
  function tokens(text, lang) {
    const out = [];
    for (const chunk of String(text).split(/\s+/).filter(Boolean)) {
      if (!NO_SPACE_RE.test(chunk) || typeof Intl === "undefined" || !Intl.Segmenter) { compound(chunk).forEach((t, k) => out.push({ t, gap: k === 0 && out.length > 0 })); continue; }
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
  // Font sizes go in quarter pixels: whole pixels are 5–7% apart at dialogue sizes, and a line
  // whose room held it a fraction of a pixel larger was set a whole pixel smaller (3.0: on generated
  // pages, most lines a bubble could hold at 0.7 of their size sat one pixel under it). Found by
  // whole pixels first, then the three quarters above tried, largest first.
  const STEP = 0.25;
  const finer = (size, cap, ok) => { for (let s = size + 1 - STEP; s > size; s -= STEP) if (s <= cap + 1e-9 && ok(s)) return s; return size; };
  const stepDown = (v) => Math.floor(v / STEP + 1e-9) * STEP, stepUp = (v) => Math.ceil(v / STEP - 1e-9) * STEP;

  function fitText(text, rect, setFont, measure, opts = {}) {
    if (opts.shape) {
      // the shape's fit, or the box's when it is larger and its lines keep to the shape, margin
      // included: the box is the lettering's own box with the room around it, and its corners may
      // lie past a curved or slanted side, where its lines crossed the outline (2.15, the owner's
      // French chapter). Judged short of the margin, the box's lines came to touch the outline.
      const shaped = fitShape(text, rect, opts.shape, setFont, measure, opts);
      const boxed = fitText(text, rect, setFont, measure, { ...opts, shape: null });
      const pick = shaped && shaped.size >= boxed.size ? shaped : !shaped ? boxed : (setFont(boxed.size), outsideRoom(boxed, rect, opts.shape, measure, false, opts.ink) <= (opts.outsideOk ?? 0.03)) ? boxed : shaped;
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
    const cap = Math.min(opts.maxSize ?? 72, rect.h);
    const refine = (f, hyphenate) => {
      const s = finer(f.size, cap, (t) => { setFont(t); const w = wrapInfo(measure, text, rect.w, { ...how, hyphenate }); size = t; return (hyphenate ? !!w.hyphens : true) && fits(w); });
      if (s === f.size) return f;
      setFont(s); const w = wrapInfo(measure, text, rect.w, { ...how, hyphenate });
      return { size: s, lines: w.lines, lineHeight: s * lh, hyphens: w.hyphens || 0 };
    };
    if (clean && (!hyph || clean.size >= hyph.size * (opts.hyphenRatio ?? 0.75))) { const f = refine(clean, false); setFont(f.size); return f; }
    if (hyph) { const f = refine(hyph, true); setFont(f.size); return f; }
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

  // the narrowest row of a shape between rows i and j, in constant time (a sparse table, kept per shape)
  const rowMins = new WeakMap();
  function rowMin(shape, key = "half") {
    const rows = shape[key] || shape.half; // (older reports' shapes have only `half`)
    let byKey = rowMins.get(shape);
    if (!byKey) rowMins.set(shape, (byKey = {}));
    if (byKey[key]) return byKey[key];
    const levels = [rows.slice()];
    for (let w = 1; 2 * w <= rows.length; w *= 2) {
      const p = levels[levels.length - 1], next = [];
      for (let i = 0; i + 2 * w <= rows.length; i++) next.push(Math.min(p[i], p[i + w]));
      levels.push(next);
    }
    const q = (i, j) => { const k = 31 - Math.clz32(j - i + 1); return Math.min(levels[k][i], levels[k][j - (1 << k) + 1]); };
    byKey[key] = q;
    return q;
  }

  /**
   * fitText() in a bubble's shape (engine/layout.js roomShape): each line as wide as its row of the
   * room over the rows its letters span, and centred in that row (`dx`, from the box's centre line;
   * 3.1: lines judged over their whole line slot, and centred on one line, came out smaller than the
   * bubble held, most in slanted bubbles). The shape keeps its own margin off the outline: before
   * 2.15 a fifth of the size more came off each side. The block is centred on the box (the lettering's
   * centre) when it fits there; else where the room is widest for it: the place where its narrowest
   * row is widest, nearest the box's centre on a tie. The fit then carries that centre (`cy`), and
   * drawLines() and outsideRoom() use it. (2.15: a caption whose room narrowed under its lettering
   * was set at 17 px, centred on the lettering, with room for more above it.) The largest size that fits,
   * unhyphenated first as in fitText(); null when nothing fits at the floor (fitText then fits the
   * box). A rectangle in an oval leaves its widest rows unused: 140 of the 171 lines set under 0.7
   * of their original size sat in boxes under 5 letters wide (2.14.1).
   */
  // where a shape sits: its own centre line and top when it has them (layout.js roomShape), else
  // the box's centre and the box's top with the shape's offset (older reports)
  const shapeTop = (shape, rect) => shape.top ?? rect.y + shape.dy;
  const shapeCx = (shape, rect) => shape.cx ?? rect.x + rect.w / 2;

  function fitShape(text, rect, shape, setFont, measure, opts) {
    const lh = opts.lineHeightRatio ?? 1.15;
    const top0 = shapeTop(shape, rect), bottom0 = top0 + shape.half.length * shape.step;
    const mid = rect.y + rect.h / 2; // the lettering's centre: the block's first place
    const minSize = Math.max(6, Math.round(opts.minSize ?? 8));
    // How far a line's letters reach above and below its middle, where drawLines() centres it: the
    // text's own ink, accents and descenders included, when the caller can measure it; else the whole
    // line slot. Each line is judged over the rows its letters span: the margin is from their ink to
    // the outline's (roomShape). Judged over its slot, the room's narrowing above a first line's
    // letters and below a last line's counted against them, a fifth of the size beyond the margin
    // (3.1: real lines set small 11.1%, 7.9% with no margin at all).
    const reach = (size) => {
      const m = opts.ink ? opts.ink(text) : null;
      return m && m.a + m.d > 0 ? { a: m.a, d: m.d } : { a: (size * lh) / 2, d: (size * lh) / 2 };
    };
    // the block of n lines centred (as drawn) on cy: from its first line's letters to its last's
    const span = (n, size, r) => ({ up: ((n - 1) * size * lh) / 2 + r.a, down: ((n - 1) * size * lh) / 2 + r.d });
    const maxSize = Math.floor(Math.min(opts.maxSize ?? 72, (bottom0 - top0) / lh));
    if (!(maxSize >= minSize)) return null;
    const leastL = rowMin(shape, "left"), leastR = rowMin(shape, "right");
    const rowsOver = (y0, y1) => {
      if (y0 < top0 - 1e-6 || y1 > bottom0 + 1e-6) return null;
      const k0 = Math.max(0, Math.floor((y0 - top0) / shape.step)), k1 = Math.min(shape.half.length - 1, Math.floor((y1 - top0) / shape.step));
      return k1 >= k0 ? [k0, k1] : null;
    };
    // the room left and right of the centre line over those rows: each line is centred in its own
    // row of the room, so lines follow a slanted bubble (3.1)
    const sidesOver = (y0, y1) => { const k = rowsOver(y0, y1); return k ? [leastL(k[0], k[1]), leastR(k[0], k[1])] : [0, 0]; };
    // where a block goes: centred on the lettering, or where its narrowest row is widest
    const across = (y0, y1) => { const [l, r] = sidesOver(y0, y1); return l + r; };
    const centres = ({ up, down }) => {
      const out = [];
      if (across(mid - up, mid + down) > 0) out.push(mid);
      let best = null, most = 0;
      for (let j = 0; top0 + j * shape.step + up + down <= bottom0 + 1e-6; j++) {
        const c = top0 + j * shape.step + up, h = across(c - up, c + down);
        if (h > most || (h === most && h > 0 && Math.abs(c - mid) < Math.abs(best - mid))) { most = h; best = c; }
      }
      if (best !== null && best !== mid) out.push(best);
      return out;
    };
    // each line's room: [left, right] of the centre line (the shape already keeps its margin off the
    // outline: layout.js roomShape, LAYOUT.edgeLetters)
    const rooms = (n, size, cy, r) => {
      const line = size * lh, top = cy - (n * line) / 2;
      return Array.from({ length: n }, (_, k) => { const yc = top + (k + 0.5) * line; return sidesOver(yc - r.a, yc + r.d); });
    };
    const widths = (n, size, cy, r) => rooms(n, size, cy, r).map(([l, rr]) => Math.max(0, l + rr));
    const how = { lang: opts.lang, hyphenator: opts.hyphenator };
    const linesAt = (size, hyphenate) => {
      setFont(size);
      const r = reach(size);
      for (let n = 1; span(n, size, r).up + span(n, size, r).down <= bottom0 - top0 + 1e-6; n++) {
        const at = centres(span(n, size, r));
        if (!at.length) break; // nowhere in the shape: more lines only need more
        for (const cy of at) {
          const ws = widths(n, size, cy, r);
          if (ws.some((w) => w <= 0)) continue;
          const w = wrapInfo(measure, text, (k) => ws[Math.min(k, n - 1)], { ...how, hyphenate });
          if (w.broken || w.lines.length > n) continue;
          const sides = rooms(w.lines.length, size, cy, r); // (fewer lines sit closer to the middle)
          // each line's letters left and right of its middle (their ink when it can be measured)
          const across = w.lines.map((l) => { const m = opts.ink ? opts.ink(l) : null; return m ? [m.l, m.r] : [measure(l) / 2, measure(l) / 2]; });
          if (w.lines.every((l, j) => measure(l) <= sides[j][0] + sides[j][1] && across[j][0] + across[j][1] <= sides[j][0] + sides[j][1])) {
            // each line centred in its own row of the room, as a letterer follows a bubble's middle
            // row by row (shifted only as far as it must be, a line hugged one side: lines in boxes
            // came to touch their border)
            const dx = across.map(([a, b], j) => Math.min(sides[j][1] - b, Math.max(a - sides[j][0], (sides[j][1] - sides[j][0]) / 2)));
            return { ...w, cy, ...(dx.some((d) => Math.abs(d) > 0.01) ? { dx: dx.map((d) => +d.toFixed(2)) } : {}) };
          }
        }
      }
      return null;
    };
    // the largest size that fits, by halving (a smaller size fits wherever a larger one does, but
    // for rare line-break accidents: then a size that would fit can be passed over)
    const largest = (hyphenate) => {
      let lo = minSize, hi = maxSize, found = null;
      while (lo <= hi) { const m = (lo + hi) >> 1; const w = linesAt(m, hyphenate); if (w) { found = { size: m, w }; lo = m + 1; } else hi = m - 1; }
      if (found) { let w = null; const s = finer(found.size, Math.min(opts.maxSize ?? 72, (bottom0 - top0) / lh), (t) => !!(w = linesAt(t, hyphenate))); if (s !== found.size) found = { size: s, w: linesAt(s, hyphenate) }; }
      return found;
    };
    const plain = largest(false), hy = largest(true);
    const pick = (f, hyphens) => f && { size: f.size, lines: f.w.lines, lineHeight: f.size * lh, hyphens, shaped: true, cy: f.w.cy, cx: shapeCx(shape, rect), ...(f.w.dx ? { dx: f.w.dx } : {}) };
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
  function outsideRoom(fit, rect, shape, measure, toOutline = false, ink = null) {
    const total = fit.lines.length * fit.lineHeight, top = (fit.cy ?? rect.y + rect.h / 2) - total / 2;
    const top0 = shape ? shapeTop(shape, rect) : rect.y, bottom0 = shape ? top0 + shape.half.length * shape.step : rect.y + rect.h;
    const sx = shape ? shapeCx(shape, rect) : rect.x + rect.w / 2, lx = fit.cx ?? rect.x + rect.w / 2; // the room's centre line, the lines'
    const more = toOutline ? shape?.edge || 0 : 0; // (the shape keeps a margin off the outline: up to the outline itself)
    // the room left and right of its centre line over rows y0..y1
    const sidesAt = (y0, y1) => {
      if (!shape) return [rect.w / 2, rect.w / 2];
      const L = shape.left || shape.half, R = shape.right || shape.half;
      let l = Infinity, r = Infinity;
      for (let k = Math.max(0, Math.floor((y0 - top0) / shape.step)); k <= Math.min(shape.half.length - 1, Math.floor((y1 - top0) / shape.step)); k++) {
        l = Math.min(l, shape.half[k] ? L[k] + more : 0); r = Math.min(r, shape.half[k] ? R[k] + more : 0);
      }
      return l === Infinity ? [0, 0] : [l, r];
    };
    // each line's letters: their ink as drawn (centred on the line's middle) when the caller can
    // measure it, else the line's width and the middle 0.8 of its size. (3.0: the middle 0.8 left out
    // descenders and accents, and box fits judged inside touched a bubble's bottom curve.)
    let all = 0, out = 0;
    fit.lines.forEach((line, k) => {
      const yc = top + (k + 0.5) * fit.lineHeight, m = ink ? ink(line) : null, x = lx + (fit.dx?.[k] || 0);
      const y0 = m ? yc - m.a : yc - 0.4 * fit.size, y1 = m ? yc + m.d : yc + 0.4 * fit.size;
      const x0 = m ? x - m.l : x - measure(line) / 2, x1 = m ? x + m.r : x + measure(line) / 2, a = (x1 - x0) * (y1 - y0);
      if (!(a > 0)) return;
      const iy0 = Math.max(y0, top0), iy1 = Math.min(y1, bottom0), [hl, hr] = iy1 > iy0 ? sidesAt(iy0, iy1) : [0, 0];
      const across = Math.max(0, Math.min(x1, sx + hr) - Math.max(x0, sx - hl));
      all += a; out += a - Math.max(0, iy1 - iy0) * across;
    });
    return all ? +(out / all).toFixed(3) : 0;
  }

  function drawLines(ctx, fit, rect, color, family, halo) {
    ctx.font = `bold ${fit.size}px ${family}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const total = fit.lines.length * fit.lineHeight;
    let y = (fit.cy ?? rect.y + rect.h / 2) - total / 2 + fit.lineHeight / 2; // (a shape's fit may sit off the box's centre: fitShape)
    const cx = fit.cx ?? rect.x + rect.w / 2; // (a shape's fit on the shape's centre line)
    fit.lines.forEach((line, k) => {
      const x = cx + (fit.dx?.[k] || 0); // (a line of a shape's fit may stand off its centre line: fitShape)
      if (halo) { ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, fit.size * 0.22); ctx.strokeStyle = color === "#fff" ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.92)"; ctx.strokeText(line, x, y); }
      ctx.fillStyle = color; ctx.fillText(line, x, y); y += fit.lineHeight;
    });
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
    // a line's ink as drawLines() sets it (centred, on its middle): how far it reaches each way
    const ink = (s) => {
      const a0 = ctx.textAlign, b0 = ctx.textBaseline; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const m = ctx.measureText(s); ctx.textAlign = a0; ctx.textBaseline = b0;
      return Number.isFinite(m.actualBoundingBoxAscent) ? { l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent } : null;
    };
    const inkOr = (s) => ink(s) || { l: measure(s) / 2, r: measure(s) / 2, a: 0.4 * parseFloat(ctx.font.match(/([\d.]+)px/)?.[1] || 0), d: 0.4 * parseFloat(ctx.font.match(/([\d.]+)px/)?.[1] || 0) };
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
        const f = fitText(text, t.rect, setFont, measure, { ...how, shape: inBubble ? t.shape : null, bound: inBubble ? t.bound : null, ink: inkOr });
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
        const size = Math.max(stepDown(1.2 * least), stepUp(0.7 * q.target)); // (never pulled under 0.7 of its size: a floor took it to 0.67)
        if (q.fit.size > size) Object.assign(q, fitBest(q.text, q.p, true, { ...q.how, maxSize: size, minSize: Math.min(q.how.minSize, size) }));
      }
    }
    let n = 0;
    plans.forEach(({ p, fit, at, inBubble }, i) => {
      setFont(fit.size);
      if (p !== opts.skip) { drawLines(ctx, fit, at.rect, p.color, family, p.halo); n++; }
      if (opts.sizes) opts.sizes[i] = fit.size; // the size each line was drawn at, for callers that need it
      if (opts.fits) opts.fits[i] = { size: fit.size, lines: fit.lines.length, outside: outsideRoom(fit, at.rect, inBubble ? at.bound || at.shape : null, measure, true, inkOr), fit: fit.shaped ? "shape" : fit.overflow ? "over" : fit.forced ? "forced" : fit.below ? "below" : "box", ...(at !== p ? { alt: true } : {}) };
    });
    return n;
  }

  root.GyText = { draw, fitText, wrapInfo, syllables, tokens, lettering, outsideRoom, DEFAULT_FONT };
})(typeof globalThis !== "undefined" ? globalThis : this);
