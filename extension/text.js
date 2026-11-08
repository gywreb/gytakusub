// Page-side text fitting and drawing (classic script: content scripts cannot be
// modules). Exposes globalThis.GyText. Hyphenation comes from vendor/hyphen-en.js
// (globalThis.GyHyphen) when it is loaded; otherwise words are never split
// unless nothing else fits.
((root) => {
  "use strict";
  const SHY = "­";
  const WORD_RE = /[A-Za-zÀ-ɏ]/;
  const DEFAULT_FONT = '"Gytakusub Comic", "Comic Neue", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  const SIZE_MUL = { small: 0.8, normal: 1, large: 1.3 };
  const hyphenator = () => (root.GyHyphen && root.GyHyphen.hyphenateEn) || null;

  /** Split `word` at its hyphenation points: ["im","pos","si","ble"]; [word] if none. */
  function syllables(word) {
    const h = hyphenator();
    if (!h || word.length < 6 || !WORD_RE.test(word)) return [word];
    const parts = h(word).split(SHY).filter(Boolean);
    return parts.length > 1 ? parts : [word];
  }

  /**
   * Greedy line breaking with hyphenation. `broken` is set when a word had to be
   * split without a hyphenation point (or overflows the width).
   */
  function wrapInfo(measure, text, maxW, opts = {}) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "", broken = false, hyphens = 0;
    const push = () => { if (cur) lines.push(cur); cur = ""; };
    let i = 0;
    while (i < words.length) {
      let w = words[i];
      const t = cur ? cur + " " + w : w;
      if (measure(t) <= maxW) { cur = t; i++; continue; }
      // try to hyphenate the word across the line boundary
      const parts = opts.hyphenate === false ? [w] : syllables(w);
      if (parts.length > 1) {
        let best = 0;
        for (let k = 1; k < parts.length; k++) {
          const cand = (cur ? cur + " " : "") + parts.slice(0, k).join("") + "-";
          if (measure(cand) <= maxW) best = k; else break;
        }
        if (best > 0) {
          lines.push((cur ? cur + " " : "") + parts.slice(0, best).join("") + "-");
          cur = ""; hyphens++;
          words[i] = parts.slice(best).join(""); // the remainder is wrapped like a word
          continue;
        }
      }
      if (cur) { push(); continue; } // start a fresh line with this word
      // a lone word wider than the line
      if (measure(w) <= maxW) { cur = w; i++; continue; }
      broken = true;
      if (!opts.force) { lines.push(w); i++; continue; } // report; fitText will try a smaller size
      let piece = "";
      for (const ch of [...w]) {
        if (measure(piece + ch + "-") > maxW && piece) { lines.push(piece + (WORD_RE.test(piece.at(-1)) && WORD_RE.test(ch) ? "-" : "")); piece = ch; }
        else piece += ch;
      }
      cur = piece; i++;
    }
    push();
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
    let clean = null, hyph = null, size;
    for (size = maxSize; size >= minSize; size--) {
      setFont(size);
      const plain = wrapInfo(measure, text, rect.w, { hyphenate: false });
      if (fits(plain)) { clean = { size, lines: plain.lines, lineHeight: size * lh, hyphens: 0 }; break; }
      if (!hyph) {
        const h = wrapInfo(measure, text, rect.w);
        if (h.hyphens && fits(h)) hyph = { size, lines: h.lines, lineHeight: size * lh, hyphens: h.hyphens };
      }
    }
    if (clean && (!hyph || clean.size >= hyph.size * (opts.hyphenRatio ?? 0.75))) return clean;
    if (hyph) return hyph;
    setFont(minSize);
    const { lines } = wrapInfo(measure, text, rect.w, { force: true });
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

  /**
   * Draw every placement onto ctx (which already shows the cleaned page).
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array} placements from engine/layout.js, in ctx pixel units
   * @param {{fontFamily?:string, uppercase?:boolean}} opts
   * @returns {number} count drawn
   */
  function draw(ctx, placements, opts = {}) {
    const family = opts.fontFamily || DEFAULT_FONT;
    const setFont = (size) => { ctx.font = `bold ${size}px ${family}`; };
    const measure = (s) => ctx.measureText(s).width;
    let n = 0;
    for (const p of placements) {
      const text = opts.uppercase ? p.text.toUpperCase() : p.text;
      // `letter` is the original cap height; Comic Neue's cap height is ~0.72 em.
      const target = p.letter * 1.45 * (SIZE_MUL[p.size] || 1);
      const fit = fitText(text, p.rect, setFont, measure, { maxSize: target, minSize: Math.max(7, target * 0.45) });
      drawLines(ctx, fit, p.rect, p.color, family, p.halo);
      n++;
    }
    return n;
  }

  root.GyText = { draw, fitText, wrapInfo, syllables, DEFAULT_FONT };
})(typeof globalThis !== "undefined" ? globalThis : this);
