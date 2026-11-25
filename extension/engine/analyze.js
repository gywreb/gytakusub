// Page analysis: where the lettering is, which shapes are speech bubbles, how
// big the letters are. A learned text detector (engine/detect.js) finds the
// text lines; OpenCV geometry does the rest — lines are merged into
// paragraphs, the flat light (or dark) shape around a paragraph becomes a
// bubble when its shape and content say so, and anything else is loose text.
// Falls back to the heuristic analyser when no detector is available.
//
// Coordinates are pixels of the analysed image. The result keeps label maps
// for erase/layout; call `analysis.dispose()` when done with it.
import { detectTextSync } from "./detect.js";
import { analyzeHeuristic, mergeParagraphs } from "./analyze-heuristic.js";
import { ANALYZE } from "./tuning.js";
import { owner, owning } from "./owner.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const odd = (n) => (n % 2 ? n : n + 1);
const median = (a) => { if (!a.length) return 0; const t = Float64Array.from(a).sort(); return t[t.length >> 1]; };

/**
 * The height of the glyphs in a box (ink mask, box x, y, w, h): the median of the taller half of
 * its ink marks, so dashes, dots and accents (the shorter half) don't count, nor does one tall
 * stray mark (a bubble's outline caught at the box's edge); 0 when there is no ink.
 */
export function glyphHeights(cv, ink, x, y, w, h) {
  if (w < 2 || h < 2) return 0;
  const roi = ink.roi(new cv.Rect(x, y, w, h)), lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
  try {
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S), S = st.data32S;
    const hs = [];
    for (let i = 1; i < n; i++) if (S[i * 5 + 4] >= ANALYZE.minMarkPx) hs.push(S[i * 5 + 3]);
    hs.sort((a, b) => b - a);
    return hs.length ? median(hs.slice(0, Math.ceil(hs.length / 2))) : 0;
  } finally { roi.delete(); lab.delete(); st.delete(); ce.delete(); }
}

/**
 * The letter size of a row of lettering (ink mask, box x0, y0 to x1, y1). The dense band of rows
 * holding ≥30% of the peak row's ink is the letter bodies; accents, descenders and an opening ¿
 * hang outside it. The band is the x-height for lowercase lines and the full height for capitals;
 * 1.15× splits the difference (within ~15% either way).
 * Lettering whose ink sits in a few heavy rows (thick bars at the foot of hand-drawn capitals, an
 * "S" beside a dash) breaks that band into slivers: 4–7 px for letters 18 px tall, whose lettering
 * then counted as art, was not erased, and got a tiny translation (2.13.1). The glyphs themselves
 * say how tall they are, so when the band is under 40% of their height (slivers: 14–33% in those
 * lines), they set the size. A lowercase line's band (its x-height, ~70% of its tall letters) and
 * outlined capitals' (their horizontal strokes, ~45%) keep the band: the thresholds that tell
 * dialogue from sound effects were set on it.
 * Returns that size (`letter`) and the band's (`band`): whether a line is lettering at all (its
 * marks strokes, not blobs) is judged on the band as before, since a face's eyes are glyph-sized
 * by their own height too.
 */
/**
 * The height of a row of Hangul syllables (ink mask, the line's box, its letter by rowLetter). A
 * syllable is two or three jamo stacked in a square: its lower part, a final consonant or a vowel's
 * stem, is a few thin strokes, in some syllables only, and holds under 30% of the peak row's ink in
 * most lines. rowLetter's band stopped above it: on generated pages it measured 0.88 of the
 * syllables' height (median of 94 lines), and 0.67 or less on one line in seven, so Korean was
 * drawn small. The rows holding ≥10% of the peak span the whole syllable (0.95, none under 0.7).
 * Hangul has no x-height, so this is the size as it is, with no 1.15× for lowercase. Only
 * letter-sized marks count: a caption box's side runs down every row beside it and joined the rows
 * above and below (4 lines of 94 over 1.3× instead of 8). The layout uses it for lines Claude read
 * as Hangul.
 */
export function syllableHeight(cv, ink, x0, y0, x1, y1, letter) {
  const w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return letter;
  return owning((own) => {
    const roi = own(ink.roi(new cv.Rect(x0, y0, w, h))), lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S), S = st.data32S, L = lab.data32S;
    const mark = new Uint8Array(n);
    for (let i = 1; i < n; i++) mark[i] = S[i * 5 + 3] <= ANALYZE.syllableMarkH * letter && S[i * 5 + 2] <= ANALYZE.syllableMarkW * letter ? 1 : 0;
    const prof = new Int32Array(h); let peak = 0;
    for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) if (mark[L[y * w + x]]) c++; prof[y] = c; if (c > peak) peak = c; }
    if (!peak) return letter;
    let best = 0, run = 0; for (const v of prof) { run = v && v >= ANALYZE.syllablePeak * peak ? run + 1 : 0; if (run > best) best = run; }
    return Math.max(ANALYZE.minBandPx, best);
  });
}

export function rowLetter(cv, ink, x0, y0, x1, y1) {
  const I = ink.data, W = ink.cols;
  const prof = new Int32Array(y1 - y0); let peak = 0;
  for (let y = y0; y < y1; y++) { let n = 0; for (let x = x0; x < x1; x++) if (I[y * W + x]) n++; prof[y - y0] = n; if (n > peak) peak = n; }
  let best = 0, run = 0; for (const v of prof) { run = v >= ANALYZE.rowPeak * peak ? run + 1 : 0; if (run > best) best = run; }
  const band = Math.max(ANALYZE.minBandPx, best * ANALYZE.letterScale);
  const glyphs = glyphHeights(cv, ink, x0, y0, x1 - x0, y1 - y0);
  return { letter: glyphs && band < ANALYZE.glyphSwitch * ANALYZE.letterScale * glyphs ? ANALYZE.letterScale * glyphs : band, band };
}
/**
 * The letter size of a column of lettering (ink mask; the detector's box `ln`, the snapped box x0,
 * y0 to x1, y1): the glyphs' width, from the ink profile across the column. Not the band near the
 * peak as for rows of Latin: one stroke down the middle (a long vowel mark, a run of dots) dwarfs
 * the rest of the profile. The glyphs span the run of columns with any real share of ink, counting
 * only the marks wholly inside the detector's box, since hatching, tone or a neighbouring column's
 * strokes run across its edges and would widen the run.
 * A stack of short rows the detector took for one column ("O QUE / QUER / DIZER / COM / ISSO?" in
 * a narrow oval) measured a whole row's width, 62 px for letters 14 px tall: the translation was
 * aimed at that size, and the outline eaten by an eraser grown by it (2.14.1). A column's glyphs
 * make rows of ink about as tall as it is wide; when its rows are under 1/3.5 of its width, they
 * are rows of letters, and their height sets the size (× 1.15, as for rows). Not the glyphs' own
 * heights: a kanji is several marks, and coloured lettering only part of its ink, which measured
 * 4 px letters in 14 px columns. `band` keeps the width: whether this is lettering at all is
 * judged on it, as before.
 */
export function columnLetter(cv, ink, ln, x0, y0, x1, y1) {
  return owning((own) => {
    const W = ink.cols, H = ink.rows;
    const bx0 = clamp(ln.x, 0, W - 1), by0 = clamp(ln.y, 0, H - 1), bw = clamp(ln.x + ln.w, bx0 + 1, W) - bx0, bh = clamp(ln.y + ln.h, by0 + 1, H) - by0;
    const roi = own(ink.roi(new cv.Rect(bx0, by0, bw, bh))), lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
    const nc = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S), S = st.data32S, Lc = lab.data32S;
    const inner = new Uint8Array(nc);
    for (let i = 1; i < nc; i++) inner[i] = S[i * 5] > 0 && S[i * 5 + 1] > 0 && S[i * 5] + S[i * 5 + 2] < bw && S[i * 5 + 1] + S[i * 5 + 3] < bh ? 1 : 0;
    const prof = new Int32Array(bw); let peak = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (inner[Lc[y * bw + x]]) prof[x]++;
    for (const v of prof) if (v > peak) peak = v;
    roi.delete(); lab.delete(); st.delete(); ce.delete();
    let best = 0, run = 0; for (const v of prof) { run = peak && v >= ANALYZE.columnPeak * peak ? run + 1 : 0; if (run > best) best = run; }
    const band = Math.max(ANALYZE.minBandPx, best || x1 - x0);
    // the rows of ink down the box: a column's glyphs make rows about as tall as the column is wide
    // (one per glyph, or a few close ones); a stack of Latin rows makes rows far shorter than it is wide
    // Rows of letters only: at least half the column wide, and three marks or more across their
    // middle, as a row of letters has. The dots of a "…" down a column and the bars of a テ make
    // short rows too, and measured "あ…" at 5 px and "イテテ" at 6 (2.14.1).
    const I = ink.data, rows = [];
    const marksAcross = (y) => { let n = 0, on = false; for (let x = x0; x < x1; x++) { const v = !!I[y * W + x]; if (v && !on) n++; on = v; } return n; };
    let runH = 0, lo = Infinity, hi = -1;
    for (let y = y0; y <= y1; y++) {
      let a = -1, b = -1;
      if (y < y1) for (let x = x0; x < x1; x++) if (I[y * W + x]) { if (a < 0) a = x; b = x; }
      if (a >= 0) { runH++; lo = Math.min(lo, a); hi = Math.max(hi, b); continue; }
      if (runH >= ANALYZE.rowMinPx && hi - lo + 1 >= ANALYZE.rowWidth * band && marksAcross(y - 1 - (runH >> 1)) >= ANALYZE.rowMarks) rows.push(runH);
      runH = 0; lo = Infinity; hi = -1;
    }
    rows.sort((a, b) => a - b);
    const rowH = rows.length >= 2 ? rows[rows.length >> 1] : 0;
    return { letter: rowH && band > ANALYZE.columnRows * rowH ? ANALYZE.letterScale * rowH : band, band };
  });
}
const trace = (...a) => { if (globalThis.GYT_TRACE) globalThis.GYT_TRACE(...a); };
// The letter size of a group of paragraphs: that of most of its lettering, each
// paragraph weighing as many glyphs as it holds (up to 40) — a speck the detector
// returned beside the text, or a row of emphasis dots, is one glyph, not a vote.
const letterOf = (ps, key = "letter") => median(ps.flatMap((p) => Array(Math.max(1, Math.min(ANALYZE.weightMax, p.glyphCount | 0))).fill(p[key] ?? p.letter)));

/**
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {ImageData} img
 * @param {{detector?: object, lines?: import("./detect.js").Line[], instances?: import("./segment.js").Instance[]|null, bubbleClasses?: Set<number>}} [opts]
 *   lines: text lines from detect.js detectText (run by the caller, which can await it);
 *   detector: from detect.js loadDetector, used here only for the synchronous OpenCV
 *   backend when `lines` is not given; with neither, the heuristic analyser runs.
 *   instances: from segment.js — the bubbles as a learned segmentation model sees them;
 *   with them, bubbles are the model's masks and the light-region rules are not used.
 * @returns {import("./analyze-heuristic.js").Analysis}
 */
export function analyze(cv, img, opts = {}) {
  if (!opts.lines && !opts.detector) return analyzeHeuristic(cv, img);
  // (owner.js) the work's objects, freed when it is done; the analysis's (its masks and labels),
  // which its dispose() frees — or this, should the work fail
  const held = owner();
  try { return owning((own) => analyzeLines(cv, img, opts, own, held)); }
  catch (e) { held.free(); throw e; }
}

function analyzeLines(cv, img, opts, own, held) {
  const W = img.width, H = img.height;
  const lines = opts.lines || detectTextSync(cv, opts.detector, img, opts.maxSide ? { maxSide: opts.maxSide } : {});
  const src = own(cv.matFromImageData(img));
  const gray = own(new cv.Mat()); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const base = own(new cv.Mat()); cv.medianBlur(gray, base, odd(clamp(Math.round(W / ANALYZE.blurDiv), ANALYZE.blurMin, ANALYZE.blurMax)));
  const G = gray.data;

  // ---- per polarity: ink mask + light-region labels (the bubble surfaces) ----
  const pol = [false, true].map((dark) => {
    const ink = held(new cv.Mat());
    if (dark) cv.threshold(gray, ink, ANALYZE.inkLight, 255, cv.THRESH_BINARY); else cv.threshold(gray, ink, ANALYZE.inkDark, 255, cv.THRESH_BINARY_INV);
    const light = held(new cv.Mat()), lightRaw = own(new cv.Mat());
    if (dark) { cv.threshold(base, light, ANALYZE.darkSurfaceBlur, 255, cv.THRESH_BINARY_INV); cv.threshold(gray, lightRaw, ANALYZE.darkSurfaceRaw, 255, cv.THRESH_BINARY_INV); }
    else { cv.threshold(base, light, ANALYZE.lightSurfaceBlur, 255, cv.THRESH_BINARY); cv.threshold(gray, lightRaw, ANALYZE.lightSurfaceRaw, 255, cv.THRESH_BINARY); }
    cv.bitwise_and(light, lightRaw, light); lightRaw.delete();
    const labels = held(new cv.Mat()), stats = held(new cv.Mat()), cents = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(light, labels, stats, cents, 4, cv.CV_32S);
    cents.delete();
    return { dark, ink, light, labels, stats, n };
  });

  // ---- text lines → blocks (polarity by the lettering colour inside the box) ----
  // Ruby (furigana) — the small kana beside a column of Japanese that give its
  // reading — comes back from the detector as a column of its own, about half as
  // wide. It is not the lettering size: counted as a line it would set the size
  // estimate (and the typical column width below) to half the real one.
  const rubyLine = lines.map((r) => r.h >= ANALYZE.rubyTall * r.w && lines.some((b) => rubyBeside(r, b, b.w)));
  // The detector sometimes returns two tight lines as one box: split boxes much
  // taller (or, for columns, wider) than the page's typical line into equal lines.
  const typicalH = median(lines.filter((l) => !l.vertical).map((l) => l.h)), typicalW = median(lines.filter((l, i) => l.vertical && !rubyLine[i]).map((l) => l.w));
  const split = [];
  for (const [i, ln] of lines.entries()) {
    if (rubyLine[i]) { split.push(ln); continue; }
    // (two lines in one box still make a long box: a squarish one is a single big
    // mark — a sound effect, or a shape the detector read as a glyph)
    const t = ln.vertical ? typicalW : typicalH, size = ln.vertical ? ln.w : ln.h, along = ln.vertical ? ln.h : ln.w;
    const n = t && size > ANALYZE.splitTall * t && along >= ANALYZE.splitLong * size ? Math.max(1, Math.round(size / t)) : 1;
    if (n === 1) { split.push(ln); continue; }
    // (`pieces`: how many lines this box was cut into — a guess, which layout.js weighs)
    for (let i = 0; i < n; i++) split.push(ln.vertical ? { ...ln, x: Math.round(ln.x + (ln.w * i) / n), w: Math.round(ln.w / n), pieces: n } : { ...ln, y: Math.round(ln.y + (ln.h * i) / n), h: Math.round(ln.h / n), pieces: n });
  }
  // cores of all lines (inset 20%): snapping one line must not grow into a neighbour
  const cores = split.map((l) => ({ x: l.x + l.w * ANALYZE.coreInset, y: l.y + l.h * ANALYZE.coreInset, w: l.w * (1 - 2 * ANALYZE.coreInset), h: l.h * (1 - 2 * ANALYZE.coreInset) }));
  const blocks = [];
  for (const [li, ln] of split.entries()) {
    const others = cores.filter((_, i) => i !== li);
    const rowBlocked = (y, a, b) => others.some((c) => y >= c.y && y < c.y + c.h && a < c.x + c.w && b > c.x);
    const colBlocked = (x, a, b) => others.some((c) => x >= c.x && x < c.x + c.w && a < c.y + c.h && b > c.y);
    let x0 = clamp(ln.x, 0, W - 1), y0 = clamp(ln.y, 0, H - 1), x1 = clamp(ln.x + ln.w, x0 + 1, W), y1 = clamp(ln.y + ln.h, y0 + 1, H);
    let darkPx = 0, lightPx = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = G[y * W + x]; n++; if (v < ANALYZE.inkDark) darkPx++; else if (v > ANALYZE.inkLight) lightPx++; }
    if (!n || darkPx + lightPx < ANALYZE.contrastShare * n) continue; // no lettering contrast inside the box
    // light lettering on a dark ground when the box is mostly dark with light marks
    const dark = darkPx > ANALYZE.darkShare * n && lightPx > ANALYZE.lightMarks * n;
    const P = pol[dark ? 1 : 0], I = P.ink.data;
    // DBNet predicts the shrunk core of a line and the unclip under-grows small text:
    // snap the box to the ink around it (grow while the next row/column still has ink,
    // up to 60% of the box's thickness) so letter size and erase cover the real letters.
    // The shape under the box (its light region, if any): growth never leaves it, so a
    // line cannot creep along screentone dots or across the bubble outline.
    const Lb = P.labels.data32S;
    const rowInk = (y, a, b) => { for (let x = a; x < b; x++) if (I[y * W + x]) return true; return false; };
    const colInk = (x, a, b) => { for (let y = a; y < b; y++) if (I[y * W + x]) return true; return false; };
    const votes = new Map(); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = y * W + x; if (I[q]) continue; const v = Lb[q]; if (v) votes.set(v, (votes.get(v) || 0) + 1); }
    let owner = 0, on = 0; for (const [k, v] of votes) if (v > on) { owner = k; on = v; }
    // a row/column may extend the line when it holds ink that lies *between* pixels of
    // the shape (letters sit on the surface); the outline has surface on one side only
    const rowOk = (y, a, b) => {
      if (!owner) return rowInk(y, a, b);
      let first = -1, last = -1; for (let x = a; x < b; x++) if (Lb[y * W + x] === owner) { if (first < 0) first = x; last = x; }
      for (let x = first + 1; x < last; x++) if (I[y * W + x]) return true; return false;
    };
    const colOk = (x, a, b) => {
      if (!owner) return colInk(x, a, b);
      let first = -1, last = -1; for (let y = a; y < b; y++) if (Lb[y * W + x] === owner) { if (first < 0) first = y; last = y; }
      for (let y = first + 1; y < last; y++) if (I[y * W + x]) return true; return false;
    };
    const growY = Math.round(ANALYZE.growShare * (y1 - y0)), growX = Math.round(ANALYZE.growShare * (x1 - x0));
    // clip the box to its shape: columns/rows with no pixel of the owner region are
    // outline or tone beside the bubble that the detector's box swallowed
    if (owner) {
      const colHome = (x, a, b) => { for (let y = a; y < b; y++) if (Lb[y * W + x] === owner) return true; return false; };
      const rowHome = (y, a, b) => { for (let x = a; x < b; x++) if (Lb[y * W + x] === owner) return true; return false; };
      while (x1 - x0 > ANALYZE.minSnapPx && !colHome(x0, y0, y1)) x0++;
      while (x1 - x0 > ANALYZE.minSnapPx && !colHome(x1 - 1, y0, y1)) x1--;
      while (y1 - y0 > ANALYZE.minSnapPx && !rowHome(y0, x0, x1)) y0++;
      while (y1 - y0 > ANALYZE.minSnapPx && !rowHome(y1 - 1, x0, x1)) y1--;
    }
    // trim first: the unclip over-grows large text (empty rows/columns at the edges)
    { const h0 = y1 - y0, w0 = x1 - x0;
      while (y1 - y0 > h0 * ANALYZE.trimKeep && !rowInk(y0, x0, x1)) y0++;
      while (y1 - y0 > h0 * ANALYZE.trimKeep && !rowInk(y1 - 1, x0, x1)) y1--;
      while (x1 - x0 > w0 * ANALYZE.trimKeep && !colInk(x0, y0, y1)) x0++;
      while (x1 - x0 > w0 * ANALYZE.trimKeep && !colInk(x1 - 1, y0, y1)) x1--; }
    if (!ln.vertical) {
      let g = 0; while (g < growY && y0 > 0 && rowOk(y0 - 1, x0, x1) && !rowBlocked(y0 - 1, x0, x1)) { y0--; g++; }
      g = 0; while (g < growY && y1 < H && rowOk(y1, x0, x1) && !rowBlocked(y1, x0, x1)) { y1++; g++; }
      const tail = Math.round((owner ? ANALYZE.tailOwned : ANALYZE.tailFree) * (y1 - y0)); // trailing punctuation the detector leaves out
      g = 0; while (g < tail && x0 > 0 && colOk(x0 - 1, y0, y1) && !colBlocked(x0 - 1, y0, y1)) { x0--; g++; }
      g = 0; while (g < tail && x1 < W && colOk(x1, y0, y1) && !colBlocked(x1, y0, y1)) { x1++; g++; }
    } else {
      let g = 0; while (g < growX && x0 > 0 && colOk(x0 - 1, y0, y1) && !colBlocked(x0 - 1, y0, y1)) { x0--; g++; }
      g = 0; while (g < growX && x1 < W && colOk(x1, y0, y1) && !colBlocked(x1, y0, y1)) { x1++; g++; }
      const tail = Math.round((owner ? ANALYZE.tailOwned : ANALYZE.tailFree) * (x1 - x0));
      g = 0; while (g < tail && y0 > 0 && rowOk(y0 - 1, x0, x1) && !rowBlocked(y0 - 1, x0, x1)) { y0--; g++; }
      g = 0; while (g < tail && y1 < H && rowOk(y1, x0, x1) && !rowBlocked(y1, x0, x1)) { y1++; g++; }
    }
    let letter, band, syllable;
    if (!ln.vertical) {
      ({ letter, band } = rowLetter(cv, P.ink, x0, y0, x1, y1)); // (cap height from the ink profile, or the glyphs)
      syllable = syllableHeight(cv, P.ink, x0, y0, x1, y1, letter); // (the same row, if it is Hangul)
    } else {
      ({ letter, band } = columnLetter(cv, P.ink, ln, x0, y0, x1, y1)); // (the column's width, or the glyphs)
      syllable = letter;
    }
    if (x1 - x0 < ANALYZE.minSnappedPx || y1 - y0 < ANALYZE.minSnappedPx) continue; // snapped down to nothing: no lettering there
    // ink pixels in the box = the lettering; a glyph count estimate for tag sanity and scoring
    let inkArea = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (I[y * W + x]) inkArea++;
    // glyphs along the line: CJK fill a square, Latin letters are ~0.6 of their height
    // wide. A column of dots and marks ("……！！") measures a tiny letter from its dots;
    // its glyphs are still the page's column pitch apart (half a detector box is about
    // a glyph), not one per dot — or it would outvote the text in every size estimate.
    const letters = Math.max(1, Math.round(ln.vertical ? (y1 - y0) / Math.max(letter, ANALYZE.columnPitch * typicalW) : (x1 - x0) / (ANALYZE.glyphWidth * letter)));
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    // `line`: the detector's own box, which the snapping above may have cut to the letters' dark core
    blocks.push({ box, gbox: { ...box }, line: { x: ln.x, y: ln.y, w: ln.w, h: ln.h }, pieces: ln.pieces || 1, letter, lineLetters: [letter], syllable, lineSyllables: [syllable], band: band ?? letter, lineBands: [band ?? letter], glyphCount: letters, components: letters, glyphs: [], inkArea, dark, vertical: ln.vertical, score: ln.score, bubble: null, region: null, lines: 1, lineWidth: box.w });
  }
  // Lines in different bubbles are different speakers: with the segmentation model's
  // masks, a line joins a paragraph only within its own bubble (or outside all of them)
  // — never a line of dialogue with a sound effect drawn just past the outline.
  if (opts.instances) for (const b of blocks) b.group = instanceAt(opts.instances, opts.bubbleClasses, (b.gbox.x + b.gbox.w / 2) | 0, (b.gbox.y + b.gbox.h / 2) | 0);
  // Ruby joins the column it annotates: erased (and stamped) with it, but its
  // size takes no part in the column's letter.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const r = blocks[i];
    let base = null, best = Infinity;
    for (const b of blocks) {
      // ruby is half the size of its kanji, set in a column (or one or two kana) — a
      // line of small horizontal text beside big lettering is a line of its own
      if (b === r || b.dark !== r.dark || b.group !== r.group || r.band > ANALYZE.rubyBandMax * b.band || r.band < ANALYZE.rubyBandMin * b.band || r.gbox.h < ANALYZE.rubyTall * r.gbox.w || !rubyBeside(r.gbox, { ...b.gbox, vertical: b.vertical }, b.band, Infinity)) continue;
      const d = Math.abs(r.gbox.x + r.gbox.w / 2 - (b.gbox.x + b.gbox.w / 2));
      if (d < best) { best = d; base = b; }
    }
    if (!base) continue;
    const u = (A, B) => { const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y); return { x, y, w: Math.max(A.x + A.w, B.x + B.w) - x, h: Math.max(A.y + A.h, B.y + B.h) - y }; };
    base.box = u(base.box, r.box); base.gbox = u(base.gbox, r.gbox); base.inkArea += r.inkArea; base.ruby = (base.ruby || 0) + 1;
    blocks.splice(i, 1);
  }

  // ---- paragraphs ----
  const paragraphs = mergeParagraphs(blocks);
  for (const p of paragraphs) { if (p.lineLetters) p.letter = median(p.lineLetters); p.band = p.lineBands ? median(p.lineBands) : p.band ?? p.letter; p.syllable = p.lineSyllables ? median(p.lineSyllables) : p.syllable ?? p.letter; }
  const pageLetter = letterOf(paragraphs) || Math.max(ANALYZE.minPageLetter, W / ANALYZE.pageLetterDiv);
  // what is lettering, and which lines group, is decided on the lines' bands as before 2.13.1
  // (rowLetter); the sizes drawn and erased use the letters
  const pageBand = letterOf(paragraphs, "band") || pageLetter;

  const band = Math.max(1, Math.round(H / ANALYZE.readingBands));
  const order = (a, b) => (Math.floor(a.box.y / band) - Math.floor(b.box.y / band)) || (a.box.x - b.box.x);
  // Loose text must look like letters inside: no single ink component spanning the
  // line (a border, a speed line), and the components letter-sized rather than
  // specks (screentone dots the detector read as a dotted line).
  const looksLettered = (p) => {
    const P = pol[p.dark ? 1 : 0], { x, y, w, h } = p.gbox;
    const roi = own(P.ink.roi(new cv.Rect(x, y, w, h))), lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S; let longest = 0, ink = 0, letterInk = 0; const sizes = [];
    for (let i = 1; i < n; i++) {
      const size = Math.max(S[i * 5 + 2], S[i * 5 + 3]), a = S[i * 5 + 4];
      longest = Math.max(longest, w >= h ? S[i * 5 + 2] / w : S[i * 5 + 3] / h); sizes.push(size);
      ink += a; if (size >= ANALYZE.letterMark * (p.band ?? p.letter)) letterInk += a;
    }
    roi.delete(); lab.delete(); st.delete(); ce.delete();
    // letter-sized marks: most components are, or (text over hatching or tone, whose
    // specks outnumber the glyphs) most of the ink is in them
    const ok = n > 1 && longest <= ANALYZE.longestMax && (median(sizes) >= ANALYZE.letterMark * (p.band ?? p.letter) || letterInk >= ANALYZE.letterInk * ink) && !solidMarks(p);
    if (!ok) trace("block", p.gbox, "not lettered", { components: n - 1, longest, medianSize: median(sizes), letterInk: letterInk / Math.max(1, ink), letter: p.letter });
    return ok;
  };
  // Lettering is drawn in strokes, thin for the letter's size. A "line" whose
  // glyph-sized marks are mostly solid to their middle — two eyes in a round face
  // (which a detector reads as "ö"), a shadow — is not lettering.
  const marksOf = (p) => {
    if (p.marks) return p.marks;
    // marks wholly inside the box (a margin around it shows which run on past it:
    // an outline, a stroke of art — not glyphs of this line)
    const P = pol[p.dark ? 1 : 0], m = ANALYZE.marginPx;
    const x = Math.max(0, p.gbox.x - m), y = Math.max(0, p.gbox.y - m), w = Math.min(W, p.gbox.x + p.gbox.w + m) - x, h = Math.min(H, p.gbox.y + p.gbox.h + m) - y;
    const roi = own(P.ink.roi(new cv.Rect(x, y, w, h))), lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat()), dist = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
    cv.distanceTransform(roi, dist, cv.DIST_L2, 3); // half the stroke width at each ink pixel
    const S = st.data32S, Lb = lab.data32S, D = dist.data32F, core = new Float32Array(n);
    for (let i = 0; i < w * h; i++) { const l = Lb[i]; if (l && D[i] > core[l]) core[l] = D[i]; }
    let glyphs = 0, glyphInk = 0, solidInk = 0;
    for (let i = 1; i < n; i++) {
      const cx = S[i * 5], cy = S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3], size = Math.max(cw, ch), a = S[i * 5 + 4];
      if ((cx <= 0 && x > 0) || (cy <= 0 && y > 0) || (cx + cw >= w && x + w < W) || (cy + ch >= h && y + h < H)) continue;
      const L = p.band ?? p.letter; // (the band, as before 2.13.1: see rowLetter)
      if (size < ANALYZE.letterMark * L || size > ANALYZE.markMax * L) continue; // specks; outlines and art
      glyphs++; glyphInk += a;
      // solid to its middle, and fat: a blob over half a letter across (the page's
      // letter, too — a line of dots measures its own "letter" from the dots), not a
      // bar (the stem of a bold "!", a long vowel mark)
      const lo = Math.min(cw, ch);
      if (2 * core[i] >= ANALYZE.solidCore * lo && lo >= ANALYZE.solidSize * Math.max(L, pageBand) && size <= ANALYZE.solidBar * lo) solidInk += a;
    }
    roi.delete(); lab.delete(); st.delete(); ce.delete(); dist.delete();
    return (p.marks = { glyphs, solid: glyphInk > 0 && solidInk >= ANALYZE.solidShare * glyphInk });
  };
  // Lettering is drawn in strokes, thin for the letter's size: a "line" whose
  // glyph-sized marks are mostly solid blobs (eyes, a shadow) is not lettering.
  const solidMarks = (p) => {
    const solid = marksOf(p).solid;
    if (solid && !p.solidTraced) { p.solidTraced = true; trace("block", p.gbox, "solid marks, not strokes", { letter: p.letter }); }
    return solid;
  };
  // A "line" filling a closed shape edge to edge (see the bubble tests) with no more
  // than two marks inside is that shape read as a glyph — a round face with two eyes
  // reads as "ö" — not lettering. A caption or a sign filled by its text has many marks.
  const shapeAsGlyph = (p) => { if (marksOf(p).glyphs <= 2) p.shape = true; return p.shape; };
  // loose text is dialogue-sized (narration is never a third of the dialogue size: that is tone or detail)
  const isFree = (p) => !p.bubble && !p.shape && p.score >= ANALYZE.freeScore && p.band >= ANALYZE.freeMin * pageBand && p.band <= ANALYZE.freeMax * pageBand && looksLettered(p);
  const finish = (kept) => {
    kept.sort(order);
    const free = paragraphs.filter(isFree).sort(order);
    const regions = []; let id = 1;
    for (const b of kept) { b.id = id; regions.push({ id: id++, kind: "bubble", ref: b, box: b.box, letter: b.letter, dark: b.dark }); }
    for (const p of free) { p.region = id; regions.push({ id: id++, kind: "block", ref: p, box: p.gbox, letter: p.letter, dark: p.dark }); }
    for (const p of paragraphs) if (p.bubble) p.region = p.bubble.id;
    src.delete(); gray.delete(); base.delete();
    return {
      W, H, letter: pageLetter, regions, bubbles: kept, blocks: paragraphs, lines, learned: true, segmented: !!opts.instances,
      insideOf(regionId) {
        const r = regions.find((q) => q.id === regionId);
        if (!r || r.kind !== "bubble") return null;
        const { fill, box, labels, labelId } = r.ref;
        if (fill) return (px, py) => { const lx = (px | 0) - box.x, ly = (py | 0) - box.y; return lx >= 0 && ly >= 0 && lx < box.w && ly < box.h && fill[ly * box.w + lx] !== 0; };
        const data = labels.data32S;
        return (px, py) => px >= 0 && py >= 0 && px < W && py < H && data[(py | 0) * W + (px | 0)] === labelId;
      },
      // erase.js needs the ink masks and the light-region labels per polarity
      polarities: pol.map((P) => ({ dark: P.dark, inkMask: P.ink, regionLabels: P.labels, dispose() { for (const m of [P.ink, P.light, P.labels, P.stats]) if (!m.isDeleted()) m.delete(); } })),
      dispose: held.free,
    };
  };

  // Bubbles the segmentation model found come first and claim their lettering.
  // Lettering it left outside any mask still goes through the light-region
  // rules below (the model misses some shapes — heavily toned bubbles, say).
  const segBubbles = opts.instances ? bubblesFromInstances(opts.instances, opts.bubbleClasses, paragraphs, pageLetter, G, W, H, solidMarks, shapeAsGlyph) : [];

  // ---- which light region holds each paragraph (majority of its non-ink pixels) ----
  const ownerOf = (p) => {
    const P = pol[p.dark ? 1 : 0], L = P.labels.data32S, I = P.ink.data, { x, y, w, h } = p.gbox;
    const votes = new Map(); let samples = 0;
    const step = Math.max(1, Math.round(Math.min(w, h) / ANALYZE.voteSteps));
    for (let yy = y; yy < y + h; yy += step) for (let xx = x; xx < x + w; xx += step) { const q = yy * W + xx; if (I[q]) continue; samples++; const v = L[q]; if (v) votes.set(v, (votes.get(v) || 0) + 1); }
    let best = 0, n = 0; for (const [k, v] of votes) if (v > n) { best = k; n = v; }
    return n >= ANALYZE.voteShare * samples ? best : 0;
  };
  const byLight = new Map(); // `${polarity}:${label}` → paragraphs
  for (const p of paragraphs) { if (p.bubble || p.shape || solidMarks(p)) continue; const o = ownerOf(p); if (o) { const k = `${p.dark ? 1 : 0}:${o}`; (byLight.get(k) || byLight.set(k, []).get(k)).push(p); } }

  // ---- bubble candidates: shape and content tests on the light region ----
  const bubbles = [];
  const srcData = src.data;
  for (const [key, inBlocks] of byLight) {
    const [pi, li] = key.split(":").map(Number);
    const P = pol[pi], S = P.stats.data32S, L = P.labels.data32S;
    const x = S[li * 5], y = S[li * 5 + 1], w = S[li * 5 + 2], h = S[li * 5 + 3], a = S[li * 5 + 4];
    const frac = a / (W * H), rbox = { x, y, w, h };
    const reject = (why, extra) => trace("region", rbox, why, { frac, blocks: inBlocks.length, ...extra });
    // With the segmentation model running, these rules only catch the bubbles it misses
    // (toned ones): none of those in the owner's exports covered more than 8% of the
    // page, while every light region larger than that was a panel's background with
    // loose lettering on it — which reads better as loose text than as a "bubble"
    // the size of the panel. Without the model, the rules are the only bubble finder.
    const maxFrac = opts.instances ? ANALYZE.maxFracSegmented : ANALYZE.maxFracRules;
    if (frac < ANALYZE.minFrac || frac > maxFrac) { reject("area out of range", { maxFrac }); continue; }
    if (w > ANALYZE.maxWidth * W || h > ANALYZE.maxHeight * H || w * h > ANALYZE.maxArea * W * H) { reject("too large for a bubble"); continue; }
    // lettering has room around it inside a bubble (see bubblesFromInstances)
    // (a "line" filling the shape edge to edge with a mark or two in it: a face read as "ö")
    if (inBlocks.every((b) => b.gbox.w >= ANALYZE.shapeFill * w && b.gbox.h >= ANALYZE.shapeFill * h && shapeAsGlyph(b))) { reject("the shape itself read as text"); continue; }
    if (a / (w * h) < ANALYZE.minFill) { reject("too ragged", { fill: a / (w * h) }); continue; }
    // the bubble's full footprint (lettering holes filled); its holes must be the lettering
    const m = own(new cv.Mat(h, w, cv.CV_8UC1)), md = m.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) md[yy * w + xx] = L[(y + yy) * W + x + xx] === li ? 255 : 0;
    const contours = own(new cv.MatVector()), hier = own(new cv.Mat());
    cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let filled = 0, hullArea = 0, bestK = -1;
    for (let k = 0; k < contours.size(); k++) {
      const ct = own(contours.get(k)), ar = cv.contourArea(ct);
      if (ar > filled) { filled = ar; bestK = k; const hull = own(new cv.Mat()); cv.convexHull(ct, hull); hullArea = cv.contourArea(hull); hull.delete(); }
      ct.delete();
    }
    let fill = null;
    if (bestK >= 0) { m.setTo(new cv.Scalar(0)); cv.drawContours(m, contours, bestK, new cv.Scalar(255), -1); fill = new Uint8Array(m.data); }
    contours.delete(); hier.delete(); m.delete();
    const holes = Math.max(0, filled - a);
    if (holes / Math.max(1, filled) > ANALYZE.maxHoles) { reject("too much drawn inside", { holeFrac: holes / filled }); continue; }
    if (hullArea && a / hullArea < ANALYZE.minSolidity) { reject("not convex enough", { solidity: a / hullArea }); continue; }
    // what is inside must be the lettering: hole pixels within the text boxes (grown a little)
    let holesInText = 0;
    if (holes > 0 && fill) {
      const ld = P.light.data;
      for (const b of inBlocks) {
        const pad = Math.max(ANALYZE.holePadMinPx, Math.round(b.letter * ANALYZE.holePad));
        const bx0 = Math.max(x, b.gbox.x - pad), by0 = Math.max(y, b.gbox.y - pad), bx1 = Math.min(x + w, b.gbox.x + b.gbox.w + pad), by1 = Math.min(y + h, b.gbox.y + b.gbox.h + pad);
        for (let yy = by0; yy < by1; yy++) for (let xx = bx0; xx < bx1; xx++) if (fill[(yy - y) * w + (xx - x)] && !ld[yy * W + xx]) holesInText++;
      }
      if (holesInText / holes < ANALYZE.holesInText) { reject("content inside is not lettering", { inText: holesInText / holes }); continue; }
    }
    // the lettering is small relative to the shape that holds it
    const letter = letterOf(inBlocks, "band");
    if (letter > ANALYZE.markToShape * Math.min(w, h)) { reject("marks too large for the shape", { letter }); continue; }
    // dialogue is not drawn at several times the page's dialogue size: that is a sound
    // effect over the panel's background (the bound loose text has, below)
    if (letter > ANALYZE.bubbleMaxBand * pageBand) { reject("lettering too large for dialogue", { letter, pageBand }); continue; }
    let r = 0, g = 0, bb = 0, n = 0;
    for (let yy = y; yy < y + h; yy += 3) for (let xx = x; xx < x + w; xx += 3) { const p = yy * W + xx; if (L[p] !== li) continue; r += srcData[p * 4]; g += srcData[p * 4 + 1]; bb += srcData[p * 4 + 2]; n++; }
    const color = n ? [Math.round(r / n), Math.round(g / n), Math.round(bb / n)] : (pi ? [0, 0, 0] : [255, 255, 255]);
    const bubble = { id: 0, box: rbox, area: a, color, dark: !!pi, letter: bubbleLetter(inBlocks, pageLetter, rbox), blocks: inBlocks, labelId: li, labels: P.labels, fill };
    trace("bubble", rbox, "accepted", { frac, blocks: inBlocks.length, fill: a / (w * h), holeFrac: holes / Math.max(1, filled), solidity: hullArea ? a / hullArea : 1, inText: holes > 0 ? holesInText / holes : 1, letter });
    bubbles.push(bubble);
  }
  // bubbles do not nest: a shape that holds another bubble is a background
  const encloses = (A, B) => {
    if (!A.fill || B.area >= ANALYZE.nestShare * A.area) return false;
    const on = (px, py) => { const lx = px - A.box.x, ly = py - A.box.y; return lx >= 0 && ly >= 0 && lx < A.box.w && ly < A.box.h && A.fill[ly * A.box.w + lx] !== 0; };
    const { x, y, w, h } = B.box;
    return on(x, y) && on(x + w - 1, y) && on(x, y + h - 1) && on(x + w - 1, y + h - 1);
  };
  // a rule-based shape that holds a segmented bubble is a background around it, not another bubble
  const ruleKept = bubbles.filter((A) => { const nests = bubbles.concat(segBubbles).some((B) => B !== A && encloses(A, B)); if (nests) trace("region", A.box, "encloses another bubble: a background"); return !nests; });
  for (const b of ruleKept) { for (const p of b.blocks) p.bubble = b; if (!b.dark) widenInterior(cv, pol[0], b, W, H); }

  for (const b of ruleKept) if (b.widened) trace("bubble", b.box, "interior widened", { from: b.lightBox, area: b.area, interior: b.interiorArea });
  return finish(segBubbles.concat(ruleKept));
}

/**
 * A bubble's letter size: its lettering's. A bubble holding only marks — "……",
 * "!?" — measures its "letter" from the dots, a fraction of any letter; its
 * translation ("...") is set at the page's size instead, but no larger than a
 * quarter of the bubble across: on a page whose lettering is mostly huge sound
 * effects the page's size is theirs (125 px), and a 109 px bubble's line was set
 * at it, broken letter by letter (2.13.1).
 */
export function bubbleLetter(blocks, pageLetter, box) {
  const fits = Math.max(ANALYZE.fitMinPx, ANALYZE.fitShare * Math.min(box.w, box.h));
  const letter = blocks.length ? letterOf(blocks) : Math.min(pageLetter, fits);
  return letter < ANALYZE.marksOnly * pageLetter ? Math.max(letter, Math.min(pageLetter, fits)) : letter;
}

/** Index of the smallest bubble instance whose mask holds the point, -1 for none. */
function instanceAt(instances, bubbleClasses, px, py) {
  let best = -1, area = Infinity;
  instances.forEach((inst, i) => {
    if ((bubbleClasses && !bubbleClasses.has(inst.cls)) || !inst.mask) return;
    const { x, y, w, h } = inst.box, lx = px - x, ly = py - y;
    if (lx < 0 || ly < 0 || lx >= w || ly >= h || !inst.mask[ly * w + lx] || w * h >= area) return;
    best = i; area = w * h;
  });
  return best;
}

/**
 * Whether box `r` sits beside column `b` the way ruby does: much thinner than
 * the column's letters, against one of its sides (not over its middle) and
 * within its length. Only columns: horizontal lines are left alone (a small
 * line above a large one in a Latin-script bubble is a line of its own).
 * @param {{x:number,y:number,w:number,h:number}} r
 * @param {{x:number,y:number,w:number,h:number,vertical:boolean}} b
 * @param {number} size the column's letter size (a detector box's width)
 * @param {number} [thin] how much thinner than `size` ruby's box is at most (for
 *   detector boxes; a snapped box may have grown across the gap it sits in, so for
 *   those the caller compares letter sizes instead and passes Infinity)
 */
function rubyBeside(r, b, size, thin = ANALYZE.rubyThin) {
  if (!b.vertical || r === b || !(size > 0) || r.w > thin * size) return false;
  if (Math.max(r.x, b.x) - Math.min(r.x + r.w, b.x + b.w) > ANALYZE.rubyGap * size) return false;
  const cx = r.x + r.w / 2;
  if (cx > b.x + ANALYZE.rubyCentreLo * b.w && cx < b.x + ANALYZE.rubyCentreHi * b.w) return false;
  return r.y >= b.y - ANALYZE.rubyReach * size && r.y + r.h <= b.y + b.h + ANALYZE.rubyReach * size;
}

/**
 * Bubbles as a segmentation model returned them: each instance's mask is the
 * interior, the lettering inside is whatever detected paragraphs have their
 * centre in the mask, and the bubble is dark when its surface is. Instances
 * are filtered for the bubble classes, a plausible size, a mask that is
 * mostly solid (a few stray pixels are not a bubble) and lettering inside.
 */
function bubblesFromInstances(instances, bubbleClasses, paragraphs, pageLetter, G, W, H, solidMarks, shapeAsGlyph) {
  const bubbles = [];
  for (const inst of instances) {
    if (bubbleClasses && !bubbleClasses.has(inst.cls)) continue;
    if (!inst.mask) continue;
    const { x, y, w, h } = inst.box;
    let area = 0, lum = 0; const m = inst.mask;
    for (let i = 0; i < m.length; i++) if (m[i]) { area++; lum += G[(y + ((i / w) | 0)) * W + x + (i % w)]; }
    const frac = area / (W * H);
    if (frac < ANALYZE.segMinFrac || frac > ANALYZE.segMaxFrac || area < ANALYZE.segMinFill * w * h) { trace("region", inst.box, "segment rejected", { frac, fill: area / (w * h) }); continue; }
    const inside = (px, py) => { const lx = px - x, ly = py - y; return lx >= 0 && ly >= 0 && lx < w && ly < h && m[ly * w + lx] !== 0; };
    // A "text box" spanning the shape edge to edge with a mark or two inside is the
    // shape itself read as a glyph (a round face with two eyes reads as "ö"), not
    // lettering in it. (A caption filled by its text has many marks.)
    const blocks = paragraphs.filter((p) => {
      if (p.bubble || !inside((p.gbox.x + p.gbox.w / 2) | 0, (p.gbox.y + p.gbox.h / 2) | 0)) return false;
      if (p.gbox.w >= ANALYZE.shapeFill * w && p.gbox.h >= ANALYZE.shapeFill * h && shapeAsGlyph(p)) return false;
      return !solidMarks(p);
    });
    // No lettering inside: a round face, a cloud, an empty balloon. Not a region —
    // a stamp there would invite the model to invent text, and the eraser must
    // never touch a shape that holds no letters.
    if (!blocks.length) { trace("region", inst.box, "segment without lettering", { score: inst.score }); continue; }
    // surface luminance without the lettering: dark bubble when the mask is mostly dark
    let inkArea = 0; for (const p of blocks) inkArea += p.inkArea || 0;
    const dark = lum / Math.max(1, area) < ANALYZE.darkSurface;
    const letter = bubbleLetter(blocks, pageLetter, { w, h });
    const bubble = { id: 0, box: { x, y, w, h }, area, color: dark ? [0, 0, 0] : [255, 255, 255], dark, letter, blocks, labelId: 0, labels: null, fill: m, score: inst.score, segmented: true, cell: inst.cell };
    for (const p of blocks) p.bubble = bubble;
    bubbles.push(bubble);
    trace("bubble", bubble.box, "segment accepted", { score: inst.score, blocks: blocks.length, dark, letter, inkArea });
  }
  return bubbles;
}

/**
 * A bubble's usable interior is what its outline encloses, not only its flat
 * light pixels. A bubble shaded with screentone or a gradient has a light
 * region that is a fragment of the real shape (the light threshold stops at the
 * tone), and text laid out in that fragment comes out tiny. So, for light
 * bubbles, the interior is grown from the light region over everything that is
 * not *structural* ink — ink components longer than a few letters: the outline,
 * the tail, drawn art — within a window around the shape. Tone dots, mid-greys
 * and the lettering itself are all passable; whatever those passable pixels
 * enclose is filled in.
 *
 * Openings in the outline are handled in two ways. Structural ink is thickened
 * by a pixel or two, so an outline drawn thinner than the downscale's
 * anti-aliasing does not let the flood slip through a hairline gap. Then the
 * flooded mask is opened (eroded, then dilated) by about a sixty-fifth of the
 * page width, which cuts the channels a real opening makes — a tail whose
 * tip is not closed, a gap where art crosses the outline — and keeps only what
 * the light region still touches; the body of a bubble is never that thin. If
 * what remains still reaches the window's edge (where that is not the page
 * edge), balloons past three times the light area or loses convexity, the
 * leak was wide and the light region stays as it was. Replaces `box` and
 * `fill` on success; `labelId` (the flat surface, used by the eraser) is
 * untouched.
 */
function widenInterior(cv, P, b, W, H) {
  const { x, y, w, h } = b.box;
  const mx = Math.round(w * ANALYZE.widenWindow) + ANALYZE.widenWindowPx, my = Math.round(h * ANALYZE.widenWindow) + ANALYZE.widenWindowPx;
  const wx0 = Math.max(0, x - mx), wy0 = Math.max(0, y - my), wx1 = Math.min(W, x + w + mx), wy1 = Math.min(H, y + h + my);
  const ww = wx1 - wx0, wh = wy1 - wy0;
  if (ww < ANALYZE.minWindowPx || wh < ANALYZE.minWindowPx) return;
  owning((own) => {
    // structural ink: components longer than 2.5 letters in the window, thickened
    const roi = own(P.ink.roi(new cv.Rect(wx0, wy0, ww, wh))), lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S, Lk = lab.data32S, limit = ANALYZE.structuralLetters * Math.max(ANALYZE.minLetterPx, b.letter);
    const big = new Uint8Array(n);
    for (let i = 1; i < n; i++) if (Math.max(S[i * 5 + 2], S[i * 5 + 3]) > limit) big[i] = 1;
    const structural = own(new cv.Mat(wh, ww, cv.CV_8UC1)), sd = structural.data;
    for (let i = 0; i < ww * wh; i++) sd[i] = big[Lk[i]] ? 255 : 0;
    const seal = own(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(W > ANALYZE.sealWidePage ? ANALYZE.sealWide : ANALYZE.sealNarrow, W > ANALYZE.sealWidePage ? ANALYZE.sealWide : ANALYZE.sealNarrow)));
    cv.dilate(structural, structural, seal);
    const pass = own(new cv.Mat()); cv.bitwise_not(structural, pass);
    // passable components seeded by the light region
    const lab2 = own(new cv.Mat()), st2 = own(new cv.Mat()), ce2 = own(new cv.Mat());
    const n2 = cv.connectedComponentsWithStats(pass, lab2, st2, ce2, 4, cv.CV_32S);
    const L = P.labels.data32S, L2 = lab2.data32S;
    const seeded = new Uint8Array(n2);
    const isSeed = (xx, yy) => xx >= x && yy >= y && xx < x + w && yy < y + h && L[yy * W + xx] === b.labelId;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (L[yy * W + xx] === b.labelId) seeded[L2[(yy - wy0) * ww + (xx - wx0)]] = 1;
    seeded[0] = 0;
    const flood = own(new cv.Mat(wh, ww, cv.CV_8UC1)), fd = flood.data;
    for (let i = 0; i < ww * wh; i++) fd[i] = seeded[L2[i]] ? 255 : 0;
    // cut thin channels: open, keep what the light region touches, grow back within the flood
    const cut = Math.max(ANALYZE.tailCutMin, Math.min(ANALYZE.tailCutMax, Math.round(W / ANALYZE.tailCutDiv))) | 1; // an open tail tip is ~10 px at 850 px; a bubble body is never that thin
    const k = own(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(cut, cut)));
    const opened = own(new cv.Mat()); cv.morphologyEx(flood, opened, cv.MORPH_OPEN, k);
    const lab3 = own(new cv.Mat()), st3 = own(new cv.Mat()), ce3 = own(new cv.Mat());
    const n3 = cv.connectedComponentsWithStats(opened, lab3, st3, ce3, 4, cv.CV_32S);
    const L3 = lab3.data32S, keep = new Uint8Array(n3);
    for (let yy = 0; yy < wh; yy++) for (let xx = 0; xx < ww; xx++) { const l = L3[yy * ww + xx]; if (l && !keep[l] && isSeed(wx0 + xx, wy0 + yy)) keep[l] = 1; }
    const body = own(new cv.Mat(wh, ww, cv.CV_8UC1)), bd = body.data;
    for (let i = 0; i < ww * wh; i++) bd[i] = keep[L3[i]] ? 255 : 0;
    cv.dilate(body, body, k); cv.bitwise_and(body, flood, body);
    // leak guard on what remains
    let area = 0, bx0 = ww, by0 = wh, bx1 = 0, by1 = 0;
    for (let yy = 0; yy < wh; yy++) for (let xx = 0; xx < ww; xx++) if (bd[yy * ww + xx]) { area++; if (xx < bx0) bx0 = xx; if (xx + 1 > bx1) bx1 = xx + 1; if (yy < by0) by0 = yy; if (yy + 1 > by1) by1 = yy + 1; }
    const edge = (bx0 <= 0 && wx0 > 0) || (by0 <= 0 && wy0 > 0) || (bx1 >= ww && wx1 < W) || (by1 >= wh && wy1 < H);
    if (edge || area > ANALYZE.widenMax * b.area) { trace("bubble", b.box, "interior not widened", { edge, area, light: b.area, ratio: area / b.area }); return; }
    if (area <= ANALYZE.widenMin * b.area) return;
    const contours = own(new cv.MatVector()), hier = own(new cv.Mat());
    try {
      cv.findContours(body, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best = -1, bestA = 0, hullA = 0;
      for (let i = 0; i < contours.size(); i++) {
        const ct = own(contours.get(i)), ar = cv.contourArea(ct);
        if (ar > bestA) { bestA = ar; best = i; const hull = own(new cv.Mat()); cv.convexHull(ct, hull); hullA = cv.contourArea(hull); hull.delete(); }
        ct.delete();
      }
      if (best < 0 || !hullA) return;
      if (bestA / hullA < ANALYZE.widenSolidity) { trace("bubble", b.box, "interior not widened", { solidity: bestA / hullA }); return; }
      body.setTo(new cv.Scalar(0)); cv.drawContours(body, contours, best, new cv.Scalar(255), -1);
      const ct = own(contours.get(best)), r = cv.boundingRect(ct); ct.delete();
      const fill = new Uint8Array(r.width * r.height);
      for (let yy = 0; yy < r.height; yy++) for (let xx = 0; xx < r.width; xx++) fill[yy * r.width + xx] = bd[(r.y + yy) * ww + r.x + xx];
      b.lightBox = b.box; b.interiorArea = bestA; b.widened = true;
      b.box = { x: wx0 + r.x, y: wy0 + r.y, w: r.width, h: r.height };
      b.fill = fill;
    } finally { contours.delete(); }
  });
}
