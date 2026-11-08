// Page analysis: where the lettering is, which shapes are speech bubbles, how
// big the letters are. A learned text detector (engine/detect.js) finds the
// text lines; OpenCV geometry does the rest — lines are merged into
// paragraphs, the flat light (or dark) shape around a paragraph becomes a
// bubble when its shape and content say so, and anything else is loose text.
// Falls back to the heuristic analyser when no detector is available.
//
// Coordinates are pixels of the analysed image. The result keeps label maps
// for erase/layout; call `analysis.dispose()` when done with it.
import { detectText } from "./detect.js";
import { analyzeHeuristic, mergeParagraphs } from "./analyze-heuristic.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const odd = (n) => (n % 2 ? n : n + 1);
const median = (a) => { if (!a.length) return 0; const t = Float64Array.from(a).sort(); return t[t.length >> 1]; };
const trace = (...a) => { if (globalThis.GYT_TRACE) globalThis.GYT_TRACE(...a); };

/**
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {ImageData} img
 * @param {{detector?: object}} [opts] detector from detect.js loadDetector; without it the heuristic analyser runs
 * @returns {import("./analyze-heuristic.js").Analysis}
 */
export function analyze(cv, img, opts = {}) {
  if (!opts.detector) return analyzeHeuristic(cv, img);
  const W = img.width, H = img.height;
  const lines = detectText(cv, opts.detector, img, { maxSide: opts.maxSide ?? 960 });
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const base = new cv.Mat(); cv.medianBlur(gray, base, odd(clamp(Math.round(W / 320), 3, 7)));
  const G = gray.data;

  // ---- per polarity: ink mask + light-region labels (the bubble surfaces) ----
  const pol = [false, true].map((dark) => {
    const ink = new cv.Mat();
    if (dark) cv.threshold(gray, ink, 165, 255, cv.THRESH_BINARY); else cv.threshold(gray, ink, 105, 255, cv.THRESH_BINARY_INV);
    const light = new cv.Mat(), lightRaw = new cv.Mat();
    if (dark) { cv.threshold(base, light, 60, 255, cv.THRESH_BINARY_INV); cv.threshold(gray, lightRaw, 90, 255, cv.THRESH_BINARY_INV); }
    else { cv.threshold(base, light, 190, 255, cv.THRESH_BINARY); cv.threshold(gray, lightRaw, 150, 255, cv.THRESH_BINARY); }
    cv.bitwise_and(light, lightRaw, light); lightRaw.delete();
    const labels = new cv.Mat(), stats = new cv.Mat(), cents = new cv.Mat();
    const n = cv.connectedComponentsWithStats(light, labels, stats, cents, 4, cv.CV_32S);
    cents.delete();
    return { dark, ink, light, labels, stats, n };
  });

  // ---- text lines → blocks (polarity by the lettering colour inside the box) ----
  // The detector sometimes returns two tight lines as one box: split boxes much
  // taller (or, for columns, wider) than the page's typical line into equal lines.
  const typicalH = median(lines.filter((l) => !l.vertical).map((l) => l.h)), typicalW = median(lines.filter((l) => l.vertical).map((l) => l.w));
  const split = [];
  for (const ln of lines) {
    const t = ln.vertical ? typicalW : typicalH, size = ln.vertical ? ln.w : ln.h;
    const n = t && size > 1.7 * t ? Math.max(1, Math.round(size / t)) : 1;
    if (n === 1) { split.push(ln); continue; }
    for (let i = 0; i < n; i++) split.push(ln.vertical ? { ...ln, x: Math.round(ln.x + (ln.w * i) / n), w: Math.round(ln.w / n) } : { ...ln, y: Math.round(ln.y + (ln.h * i) / n), h: Math.round(ln.h / n) });
  }
  // cores of all lines (inset 20%): snapping one line must not grow into a neighbour
  const cores = split.map((l) => ({ x: l.x + l.w * 0.2, y: l.y + l.h * 0.2, w: l.w * 0.6, h: l.h * 0.6 }));
  const blocks = [];
  for (const [li, ln] of split.entries()) {
    const others = cores.filter((_, i) => i !== li);
    const rowBlocked = (y, a, b) => others.some((c) => y >= c.y && y < c.y + c.h && a < c.x + c.w && b > c.x);
    const colBlocked = (x, a, b) => others.some((c) => x >= c.x && x < c.x + c.w && a < c.y + c.h && b > c.y);
    let x0 = clamp(ln.x, 0, W - 1), y0 = clamp(ln.y, 0, H - 1), x1 = clamp(ln.x + ln.w, x0 + 1, W), y1 = clamp(ln.y + ln.h, y0 + 1, H);
    let darkPx = 0, lightPx = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const v = G[y * W + x]; n++; if (v < 105) darkPx++; else if (v > 165) lightPx++; }
    if (!n || darkPx + lightPx < 0.1 * n) continue; // no lettering contrast inside the box
    // light lettering on a dark ground when the box is mostly dark with light marks
    const dark = darkPx > 0.55 * n && lightPx > 0.05 * n;
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
    const growY = Math.round(0.35 * (y1 - y0)), growX = Math.round(0.35 * (x1 - x0));
    // clip the box to its shape: columns/rows with no pixel of the owner region are
    // outline or tone beside the bubble that the detector's box swallowed
    if (owner) {
      const colHome = (x, a, b) => { for (let y = a; y < b; y++) if (Lb[y * W + x] === owner) return true; return false; };
      const rowHome = (y, a, b) => { for (let x = a; x < b; x++) if (Lb[y * W + x] === owner) return true; return false; };
      while (x1 - x0 > 4 && !colHome(x0, y0, y1)) x0++;
      while (x1 - x0 > 4 && !colHome(x1 - 1, y0, y1)) x1--;
      while (y1 - y0 > 4 && !rowHome(y0, x0, x1)) y0++;
      while (y1 - y0 > 4 && !rowHome(y1 - 1, x0, x1)) y1--;
    }
    // trim first: the unclip over-grows large text (empty rows/columns at the edges)
    { const h0 = y1 - y0, w0 = x1 - x0;
      while (y1 - y0 > h0 * 0.4 && !rowInk(y0, x0, x1)) y0++;
      while (y1 - y0 > h0 * 0.4 && !rowInk(y1 - 1, x0, x1)) y1--;
      while (x1 - x0 > w0 * 0.4 && !colInk(x0, y0, y1)) x0++;
      while (x1 - x0 > w0 * 0.4 && !colInk(x1 - 1, y0, y1)) x1--; }
    if (!ln.vertical) {
      let g = 0; while (g < growY && y0 > 0 && rowOk(y0 - 1, x0, x1) && !rowBlocked(y0 - 1, x0, x1)) { y0--; g++; }
      g = 0; while (g < growY && y1 < H && rowOk(y1, x0, x1) && !rowBlocked(y1, x0, x1)) { y1++; g++; }
      const tail = Math.round((owner ? 1.5 : 0.6) * (y1 - y0)); // trailing punctuation the detector leaves out
      g = 0; while (g < tail && x0 > 0 && colOk(x0 - 1, y0, y1) && !colBlocked(x0 - 1, y0, y1)) { x0--; g++; }
      g = 0; while (g < tail && x1 < W && colOk(x1, y0, y1) && !colBlocked(x1, y0, y1)) { x1++; g++; }
    } else {
      let g = 0; while (g < growX && x0 > 0 && colOk(x0 - 1, y0, y1) && !colBlocked(x0 - 1, y0, y1)) { x0--; g++; }
      g = 0; while (g < growX && x1 < W && colOk(x1, y0, y1) && !colBlocked(x1, y0, y1)) { x1++; g++; }
      const tail = Math.round((owner ? 1.5 : 0.6) * (x1 - x0));
      g = 0; while (g < tail && y0 > 0 && rowOk(y0 - 1, x0, x1) && !rowBlocked(y0 - 1, x0, x1)) { y0--; g++; }
      g = 0; while (g < tail && y1 < H && rowOk(y1, x0, x1) && !rowBlocked(y1, x0, x1)) { y1++; g++; }
    }
    // Cap height from the ink profile: the dense band of rows (columns, for vertical
    // text) holding ≥30% of the peak row's ink is the letter bodies; accents,
    // descenders and an opening ¿ hang outside it. The band is the x-height for
    // lowercase lines and the full height for capitals or CJK; 1.15× splits the
    // difference (within ~15% either way).
    let letter;
    if (!ln.vertical) {
      const prof = new Int32Array(y1 - y0); let peak = 0;
      for (let y = y0; y < y1; y++) { let n = 0; for (let x = x0; x < x1; x++) if (I[y * W + x]) n++; prof[y - y0] = n; if (n > peak) peak = n; }
      let best = 0, run = 0; for (const v of prof) { run = v >= 0.3 * peak ? run + 1 : 0; if (run > best) best = run; }
      letter = Math.max(4, best * 1.15);
    } else {
      const prof = new Int32Array(x1 - x0); let peak = 0;
      for (let x = x0; x < x1; x++) { let n = 0; for (let y = y0; y < y1; y++) if (I[y * W + x]) n++; prof[x - x0] = n; if (n > peak) peak = n; }
      let best = 0, run = 0; for (const v of prof) { run = v >= 0.3 * peak ? run + 1 : 0; if (run > best) best = run; }
      letter = Math.max(4, best * 1.1);
    }
    // ink pixels in the box = the lettering; a glyph count estimate for tag sanity and scoring
    let inkArea = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (I[y * W + x]) inkArea++;
    const letters = Math.max(1, Math.round((ln.vertical ? (y1 - y0) : (x1 - x0)) / (0.6 * letter)));
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    blocks.push({ box, gbox: { ...box }, letter, lineLetters: [letter], glyphCount: letters, components: letters, glyphs: [], inkArea, dark, vertical: ln.vertical, score: ln.score, bubble: null, region: null, lines: 1, lineWidth: box.w });
  }

  // ---- paragraphs ----
  const paragraphs = mergeParagraphs(blocks);
  for (const p of paragraphs) if (p.lineLetters) p.letter = median(p.lineLetters);
  const pageLetter = median(paragraphs.flatMap((p) => Array(Math.min(40, p.glyphCount)).fill(p.letter))) || Math.max(8, W / 60);

  // ---- which light region holds each paragraph (majority of its non-ink pixels) ----
  const ownerOf = (p) => {
    const P = pol[p.dark ? 1 : 0], L = P.labels.data32S, I = P.ink.data, { x, y, w, h } = p.gbox;
    const votes = new Map(); let samples = 0;
    const step = Math.max(1, Math.round(Math.min(w, h) / 16));
    for (let yy = y; yy < y + h; yy += step) for (let xx = x; xx < x + w; xx += step) { const q = yy * W + xx; if (I[q]) continue; samples++; const v = L[q]; if (v) votes.set(v, (votes.get(v) || 0) + 1); }
    let best = 0, n = 0; for (const [k, v] of votes) if (v > n) { best = k; n = v; }
    return n >= 0.3 * samples ? best : 0;
  };
  const byLight = new Map(); // `${polarity}:${label}` → paragraphs
  for (const p of paragraphs) { const o = ownerOf(p); if (o) { const k = `${p.dark ? 1 : 0}:${o}`; (byLight.get(k) || byLight.set(k, []).get(k)).push(p); } }

  // ---- bubble candidates: shape and content tests on the light region ----
  const bubbles = [];
  const srcData = src.data;
  for (const [key, inBlocks] of byLight) {
    const [pi, li] = key.split(":").map(Number);
    const P = pol[pi], S = P.stats.data32S, L = P.labels.data32S;
    const x = S[li * 5], y = S[li * 5 + 1], w = S[li * 5 + 2], h = S[li * 5 + 3], a = S[li * 5 + 4];
    const frac = a / (W * H), rbox = { x, y, w, h };
    const reject = (why, extra) => trace("region", rbox, why, { frac, blocks: inBlocks.length, ...extra });
    if (frac < 0.0006 || frac > 0.2) { reject("area out of range"); continue; }
    if (w > 0.8 * W || h > 0.6 * H || w * h > 0.3 * W * H) { reject("too large for a bubble"); continue; }
    if (a / (w * h) < 0.3) { reject("too ragged", { fill: a / (w * h) }); continue; }
    // the bubble's full footprint (lettering holes filled); its holes must be the lettering
    const m = new cv.Mat(h, w, cv.CV_8UC1), md = m.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) md[yy * w + xx] = L[(y + yy) * W + x + xx] === li ? 255 : 0;
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let filled = 0, hullArea = 0, bestK = -1;
    for (let k = 0; k < contours.size(); k++) {
      const ct = contours.get(k), ar = cv.contourArea(ct);
      if (ar > filled) { filled = ar; bestK = k; const hull = new cv.Mat(); cv.convexHull(ct, hull); hullArea = cv.contourArea(hull); hull.delete(); }
      ct.delete();
    }
    let fill = null;
    if (bestK >= 0) { m.setTo(new cv.Scalar(0)); cv.drawContours(m, contours, bestK, new cv.Scalar(255), -1); fill = new Uint8Array(m.data); }
    contours.delete(); hier.delete(); m.delete();
    const holes = Math.max(0, filled - a);
    if (holes / Math.max(1, filled) > 0.35) { reject("too much drawn inside", { holeFrac: holes / filled }); continue; }
    if (hullArea && a / hullArea < 0.45) { reject("not convex enough", { solidity: a / hullArea }); continue; }
    // what is inside must be the lettering: hole pixels within the text boxes (grown a little)
    let holesInText = 0;
    if (holes > 0 && fill) {
      const ld = P.light.data;
      for (const b of inBlocks) {
        const pad = Math.max(2, Math.round(b.letter * 0.4));
        const bx0 = Math.max(x, b.gbox.x - pad), by0 = Math.max(y, b.gbox.y - pad), bx1 = Math.min(x + w, b.gbox.x + b.gbox.w + pad), by1 = Math.min(y + h, b.gbox.y + b.gbox.h + pad);
        for (let yy = by0; yy < by1; yy++) for (let xx = bx0; xx < bx1; xx++) if (fill[(yy - y) * w + (xx - x)] && !ld[yy * W + xx]) holesInText++;
      }
      if (holesInText / holes < 0.45) { reject("content inside is not lettering", { inText: holesInText / holes }); continue; }
    }
    // the lettering is small relative to the shape that holds it
    const letter = median(inBlocks.map((b) => b.letter));
    if (letter > 0.55 * Math.min(w, h)) { reject("marks too large for the shape", { letter }); continue; }
    let r = 0, g = 0, bb = 0, n = 0;
    for (let yy = y; yy < y + h; yy += 3) for (let xx = x; xx < x + w; xx += 3) { const p = yy * W + xx; if (L[p] !== li) continue; r += srcData[p * 4]; g += srcData[p * 4 + 1]; bb += srcData[p * 4 + 2]; n++; }
    const color = n ? [Math.round(r / n), Math.round(g / n), Math.round(bb / n)] : (pi ? [0, 0, 0] : [255, 255, 255]);
    const bubble = { id: 0, box: rbox, area: a, color, dark: !!pi, letter, blocks: inBlocks, labelId: li, labels: P.labels, fill };
    trace("bubble", rbox, "accepted", { frac, blocks: inBlocks.length, fill: a / (w * h), holeFrac: holes / Math.max(1, filled), solidity: hullArea ? a / hullArea : 1, inText: holes > 0 ? holesInText / holes : 1, letter });
    bubbles.push(bubble);
  }
  // bubbles do not nest: a shape that holds another bubble is a background
  const encloses = (A, B) => {
    if (!A.fill || B.area >= 0.5 * A.area) return false;
    const on = (px, py) => { const lx = px - A.box.x, ly = py - A.box.y; return lx >= 0 && ly >= 0 && lx < A.box.w && ly < A.box.h && A.fill[ly * A.box.w + lx] !== 0; };
    const { x, y, w, h } = B.box;
    return on(x, y) && on(x + w - 1, y) && on(x, y + h - 1) && on(x + w - 1, y + h - 1);
  };
  const kept = bubbles.filter((A) => { const nests = bubbles.some((B) => B !== A && encloses(A, B)); if (nests) trace("region", A.box, "encloses another bubble: a background"); return !nests; });
  for (const b of kept) { for (const p of b.blocks) p.bubble = b; if (!b.dark) widenInterior(cv, pol[0], b, W, H); }

  // ---- regions in reading order: bubbles, then loose paragraphs ----
  const band = Math.max(1, Math.round(H / 24));
  const order = (a, b) => (Math.floor(a.box.y / band) - Math.floor(b.box.y / band)) || (a.box.x - b.box.x);
  kept.sort(order);
  // Loose text must look like letters inside: no single ink component spanning the
  // line (a border, a speed line), and the components letter-sized rather than
  // specks (screentone dots the detector read as a dotted line).
  const looksLettered = (p) => {
    const P = pol[p.dark ? 1 : 0], { x, y, w, h } = p.gbox;
    const roi = P.ink.roi(new cv.Rect(x, y, w, h)), lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S; let longest = 0; const sizes = [];
    for (let i = 1; i < n; i++) { longest = Math.max(longest, w >= h ? S[i * 5 + 2] / w : S[i * 5 + 3] / h); sizes.push(Math.max(S[i * 5 + 2], S[i * 5 + 3])); }
    roi.delete(); lab.delete(); st.delete(); ce.delete();
    return n > 1 && longest <= 0.8 && median(sizes) >= 0.35 * p.letter;
  };
  // loose text is dialogue-sized (narration is never a third of the dialogue size: that is tone or detail)
  const free = paragraphs.filter((p) => !p.bubble && p.score >= 0.6 && p.letter >= 0.6 * pageLetter && p.letter <= 2.5 * pageLetter && looksLettered(p)).sort(order);
  const regions = []; let id = 1;
  for (const b of kept) { b.id = id; regions.push({ id: id++, kind: "bubble", ref: b, box: b.box, letter: b.letter, dark: b.dark }); }
  for (const p of free) { p.region = id; regions.push({ id: id++, kind: "block", ref: p, box: p.gbox, letter: p.letter, dark: p.dark }); }
  for (const p of paragraphs) if (p.bubble) p.region = p.bubble.id;

  src.delete(); gray.delete(); base.delete();
  for (const b of kept) if (b.widened) trace("bubble", b.box, "interior widened", { from: b.lightBox, area: b.area, interior: b.interiorArea });
  return {
    W, H, letter: pageLetter, regions, bubbles: kept, blocks: paragraphs, lines, learned: true,
    insideOf(regionId) {
      const r = regions.find((q) => q.id === regionId);
      if (!r || r.kind !== "bubble") return null;
      const { fill, box, labels, labelId } = r.ref;
      if (fill) return (px, py) => { const lx = (px | 0) - box.x, ly = (py | 0) - box.y; return lx >= 0 && ly >= 0 && lx < box.w && ly < box.h && fill[ly * box.w + lx] !== 0; };
      const data = labels.data32S;
      return (px, py) => px >= 0 && py >= 0 && px < W && py < H && data[(py | 0) * W + (px | 0)] === labelId;
    },
    // erase.js needs the ink masks and the light-region labels per polarity
    polarities: pol.map((P) => ({ dark: P.dark, inkMask: P.ink, regionLabels: P.labels, dispose() { P.ink.delete(); P.light.delete(); P.labels.delete(); P.stats.delete(); } })),
    dispose() { for (const P of pol) { P.ink.delete(); P.light.delete(); P.labels.delete(); P.stats.delete(); } },
  };
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
 * enclose is filled in. A result that reaches the window's edge (where that is
 * not the page edge), balloons past the light region or loses the shape's
 * convexity leaked through a gap in the outline and is discarded: the light
 * region stays as it was. Replaces `box` and `fill` on success; `labelId` (the
 * flat surface, used by the eraser) is untouched.
 */
function widenInterior(cv, P, b, W, H) {
  const { x, y, w, h } = b.box;
  const mx = Math.round(w * 0.3) + 4, my = Math.round(h * 0.3) + 4;
  const wx0 = Math.max(0, x - mx), wy0 = Math.max(0, y - my), wx1 = Math.min(W, x + w + mx), wy1 = Math.min(H, y + h + my);
  const ww = wx1 - wx0, wh = wy1 - wy0;
  if (ww < 8 || wh < 8) return;
  // structural ink: components longer than 2.5 letters in the window
  const roi = P.ink.roi(new cv.Rect(wx0, wy0, ww, wh)), lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
  const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
  const S = st.data32S, Lk = lab.data32S, limit = 2.5 * Math.max(4, b.letter);
  const big = new Uint8Array(n);
  for (let i = 1; i < n; i++) if (Math.max(S[i * 5 + 2], S[i * 5 + 3]) > limit) big[i] = 1;
  const pass = new cv.Mat(wh, ww, cv.CV_8UC1), pd = pass.data;
  for (let i = 0; i < ww * wh; i++) pd[i] = big[Lk[i]] ? 0 : 255;
  roi.delete(); lab.delete(); st.delete(); ce.delete();
  // passable components seeded by the light region
  const lab2 = new cv.Mat(), st2 = new cv.Mat(), ce2 = new cv.Mat();
  const n2 = cv.connectedComponentsWithStats(pass, lab2, st2, ce2, 4, cv.CV_32S);
  const L = P.labels.data32S, L2 = lab2.data32S, S2 = st2.data32S;
  const seeded = new Uint8Array(n2);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (L[yy * W + xx] === b.labelId) seeded[L2[(yy - wy0) * ww + (xx - wx0)]] = 1;
  seeded[0] = 0;
  let area = 0, bx0 = ww, by0 = wh, bx1 = 0, by1 = 0;
  for (let i = 1; i < n2; i++) if (seeded[i]) { area += S2[i * 5 + 4]; bx0 = Math.min(bx0, S2[i * 5]); by0 = Math.min(by0, S2[i * 5 + 1]); bx1 = Math.max(bx1, S2[i * 5] + S2[i * 5 + 2]); by1 = Math.max(by1, S2[i * 5 + 1] + S2[i * 5 + 3]); }
  const leaked = (bx0 <= 0 && wx0 > 0) || (by0 <= 0 && wy0 > 0) || (bx1 >= ww && wx1 < W) || (by1 >= wh && wy1 < H) || area > 3 * b.area;
  if (!leaked && area > 1.05 * b.area) {
    const m = new cv.Mat(wh, ww, cv.CV_8UC1), md = m.data;
    for (let i = 0; i < ww * wh; i++) md[i] = seeded[L2[i]] ? 255 : 0;
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let best = -1, bestA = 0, hullA = 0;
    for (let k = 0; k < contours.size(); k++) {
      const ct = contours.get(k), ar = cv.contourArea(ct);
      if (ar > bestA) { bestA = ar; best = k; const hull = new cv.Mat(); cv.convexHull(ct, hull); hullA = cv.contourArea(hull); hull.delete(); }
      ct.delete();
    }
    if (best >= 0 && hullA && bestA / hullA >= 0.5) {
      m.setTo(new cv.Scalar(0)); cv.drawContours(m, contours, best, new cv.Scalar(255), -1);
      const ct = contours.get(best), r = cv.boundingRect(ct); ct.delete();
      const fill = new Uint8Array(r.width * r.height);
      for (let yy = 0; yy < r.height; yy++) for (let xx = 0; xx < r.width; xx++) fill[yy * r.width + xx] = md[(r.y + yy) * ww + r.x + xx];
      b.lightBox = b.box; b.interiorArea = bestA; b.widened = true;
      b.box = { x: wx0 + r.x, y: wy0 + r.y, w: r.width, h: r.height };
      b.fill = fill;
    }
    contours.delete(); hier.delete(); m.delete();
  }
  pass.delete(); lab2.delete(); st2.delete(); ce2.delete();
}
