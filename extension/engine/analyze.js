// Page analysis on OpenCV: where the lettering is (glyphs → text blocks), which
// light/dark regions are speech bubbles, and how big the original letters are.
// Pure image analysis — no model output involved. Deterministic for an image.
//
// Coordinates are pixels of the analysed image (the "working" resolution the
// caller chose). The result keeps OpenCV label maps for erase/layout; call
// `analysis.dispose()` when done with it.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const odd = (n) => (n % 2 ? n : n + 1);
const median = (a) => { if (!a.length) return 0; const t = Float64Array.from(a).sort(); return t[t.length >> 1]; };
// Cap height of the lettering: the 80th percentile of glyph heights (caps and
// ascenders) — the median would track x-height in mixed-case text.
const capHeight = (a) => { if (!a.length) return 0; const t = Float64Array.from(a).sort(); return t[Math.min(t.length - 1, Math.floor(t.length * 0.8))]; };

/**
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {ImageData} img
 * @returns {Analysis}
 */
export function analyze(cv, img) {
  const W = img.width, H = img.height;
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  // Median blur turns screentone (dots on white) into flat grey, so only truly
  // flat light areas — bubbles, captions, plain backgrounds — stay "light".
  const base = new cv.Mat(); cv.medianBlur(gray, base, odd(clamp(Math.round(W / 320), 3, 7)));

  const polarities = [
    analyzePolarity(cv, src, gray, base, W, H, false), // dark lettering on light bubbles
    analyzePolarity(cv, src, gray, base, W, H, true),  // light lettering on dark bubbles
  ];

  // Merge, number regions in reading order (top-to-bottom, left-to-right in bands).
  let blocks = [], bubbles = [];
  for (const p of polarities) { blocks.push(...p.blocks); bubbles.push(...p.bubbles); }

  // Dialogue size: glyph-weighted median over bubble text (else all text).
  // Regions whose lettering is far from it are sound effects or art, not dialogue.
  const weighted = (bs) => { const v = []; for (const b of bs) for (let i = 0; i < Math.min(b.glyphCount, 40); i++) v.push(b.letter); return median(v); };
  const pageLetter = weighted(blocks.filter((b) => b.bubble)) || weighted(blocks) || Math.max(8, W / 60);
  bubbles = bubbles.filter((b) => { const ok = b.letter >= 0.45 * pageLetter && b.letter <= 3 * pageLetter; if (!ok) for (const bl of b.blocks) bl.bubble = null; return ok; });
  blocks = blocks.filter((b) => b.bubble || (b.letter >= 0.5 * pageLetter && b.letter <= 2.5 * pageLetter));
  const band = Math.max(1, Math.round(H / 24));
  const order = (a, b) => (Math.floor(a.box.y / band) - Math.floor(b.box.y / band)) || (a.box.x - b.box.x);
  bubbles.sort(order);
  const freeBlocks = blocks.filter((b) => b.bubble === null && b.glyphCount >= (b.dark ? 4 : 3)).sort(order);
  const regions = [];
  let id = 1;
  for (const b of bubbles) { b.id = id; regions.push({ id: id++, kind: "bubble", ref: b, box: b.box, letter: b.letter, dark: b.dark }); }
  for (const b of freeBlocks) { b.region = id; regions.push({ id: id++, kind: "block", ref: b, box: b.box, letter: b.letter, dark: b.dark }); }
  for (const b of blocks) if (b.bubble !== null) b.region = b.bubble.id;

  const letter = pageLetter;

  src.delete(); gray.delete(); base.delete();
  return {
    W, H, letter, regions, bubbles, blocks,
    /** @param {number} regionId @returns {(x:number,y:number)=>boolean} pixel membership of a bubble */
    insideOf(regionId) {
      const r = regions.find((q) => q.id === regionId);
      if (!r || r.kind !== "bubble") return null;
      const { fill, box, labels, labelId } = r.ref;
      if (fill) return (x, y) => { const lx = (x | 0) - box.x, ly = (y | 0) - box.y; return lx >= 0 && ly >= 0 && lx < box.w && ly < box.h && fill[ly * box.w + lx] !== 0; };
      const data = labels.data32S;
      return (x, y) => x >= 0 && y >= 0 && x < W && y < H && data[(y | 0) * W + (x | 0)] === labelId;
    },
    polarities,
    dispose() { for (const p of polarities) p.dispose(); },
  };
}

function analyzePolarity(cv, src, gray, base, W, H, dark) {
  // --- ink (the lettering colour) and glyph components ---
  const ink = new cv.Mat();
  if (dark) cv.threshold(gray, ink, 165, 255, cv.THRESH_BINARY); else cv.threshold(gray, ink, 105, 255, cv.THRESH_BINARY_INV);
  const gl = new cv.Mat(), gs = new cv.Mat(), gc = new cv.Mat();
  const gn = cv.connectedComponentsWithStats(ink, gl, gs, gc, 8, cv.CV_32S);
  const minH = Math.max(3, W / 400), maxH = W / 8;
  const glyphs = []; // index = label
  const S = gs.data32S;
  for (let i = 1; i < gn; i++) {
    const x = S[i * 5], y = S[i * 5 + 1], w = S[i * 5 + 2], h = S[i * 5 + 3], a = S[i * 5 + 4];
    const thin = (w > 6 * h && h <= 3) || (h > 6 * w && w <= 3);
    const ok = h >= minH && h <= maxH && w <= W / 5 && !thin && a / (w * h) >= 0.08;
    glyphs[i] = { x, y, w, h, a, ok };
  }

  // --- text blocks: glyphs joined along lines/columns ---
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(3, Math.round(W / 90)), Math.max(3, Math.round(W / 200))));
  const closed = new cv.Mat(); cv.morphologyEx(ink, closed, cv.MORPH_CLOSE, kern);
  const bl = new cv.Mat(), bs = new cv.Mat(), bc = new cv.Mat();
  const bn = cv.connectedComponentsWithStats(closed, bl, bs, bc, 8, cv.CV_32S);
  const B = bs.data32S;
  // glyph label → block label: the block under the glyph's centre, provided the
  // component fits inside that block (a frame or line art whose centre happens
  // to fall on the text must not count as the block's ink)
  const glyphOwner = new Int32Array(gn);
  const blData = bl.data32S;
  for (let i = 1; i < gn; i++) {
    const g = glyphs[i];
    const o = blData[(g.y + (g.h >> 1)) * W + g.x + (g.w >> 1)];
    if (!o) continue;
    const bx = B[o * 5], by = B[o * 5 + 1], bw = B[o * 5 + 2], bh = B[o * 5 + 3];
    if (g.x >= bx - 2 && g.y >= by - 2 && g.x + g.w <= bx + bw + 2 && g.y + g.h <= by + bh + 2) glyphOwner[i] = o;
  }
  const perBlock = new Map();
  for (let i = 1; i < gn; i++) { const b = glyphOwner[i]; if (!b) continue; (perBlock.get(b) || perBlock.set(b, []).get(b)).push(i); }
  const blocks = [];
  for (let i = 1; i < bn; i++) {
    const x = B[i * 5], y = B[i * 5 + 1], w = B[i * 5 + 2], h = B[i * 5 + 3];
    if (w > W * 0.6 || h > H * 0.5 || h < minH) continue;
    const members = perBlock.get(i) || [];
    const good = members.filter((g) => glyphs[g].ok);
    if (good.length < 1) continue;
    // most of the ink in a text block belongs to glyph-sized components (art fails this)
    let inkAll = 0, inkGood = 0;
    for (const g of members) { inkAll += glyphs[g].a; if (glyphs[g].ok) inkGood += glyphs[g].a; }
    if (inkGood / inkAll < 0.6) continue;
    if (good.length === 1 && glyphs[good[0]].h < minH * 2) continue; // a lone speck
    const heights = good.map((g) => glyphs[g].h);
    const letter = capHeight(heights), mid = median(heights);
    // letters of one font share a height; a cloud of art fragments does not
    if (good.length >= 3 && median(heights.map((v) => Math.abs(v - mid))) / mid > 0.45) continue;
    if (letter < W / 200) continue; // smaller than any readable lettering at this resolution
    // Stroke width: letters of one font share it (relative to their height);
    // hair, shading and mechanical detail do not. Max distance-transform value
    // inside a glyph ≈ half its stroke width.
    if (good.length >= 3) {
      const roi = ink.roi(new cv.Rect(x, y, w, h)), dt = new cv.Mat();
      cv.distanceTransform(roi, dt, cv.DIST_L2, 3);
      const D = dt.data32F, ratios = [];
      for (const gi of good) {
        const g = glyphs[gi]; let mx = 0;
        for (let yy = g.y - y; yy < g.y - y + g.h; yy++) for (let xx = g.x - x; xx < g.x - x + g.w; xx++) { const v = D[yy * w + xx]; if (v > mx) mx = v; }
        ratios.push((2 * mx) / g.h);
      }
      roi.delete(); dt.delete();
      const mr = median(ratios);
      if (mr < 0.06 || mr > 0.7) continue; // hairline scratches or solid blobs
      if (median(ratios.map((v) => Math.abs(v - mr))) / mr > 0.6) continue; // inconsistent strokes: not one font
    }
    const inkArea = good.reduce((s, g) => s + glyphs[g].a, 0);
    blocks.push({ box: { x, y, w, h }, letter, glyphCount: good.length, glyphs: good, inkArea, label: i, dark, bubble: null, region: null });
  }

  // --- light regions → bubbles (must contain text, text must matter in them) ---
  // Light in the blurred image (so screentone is not light) AND in the raw
  // image (so thin outlines, which the blur erases, still bound the region).
  const light = new cv.Mat(), lightRaw = new cv.Mat();
  if (dark) { cv.threshold(base, light, 60, 255, cv.THRESH_BINARY_INV); cv.threshold(gray, lightRaw, 90, 255, cv.THRESH_BINARY_INV); }
  else { cv.threshold(base, light, 190, 255, cv.THRESH_BINARY); cv.threshold(gray, lightRaw, 150, 255, cv.THRESH_BINARY); }
  cv.bitwise_and(light, lightRaw, light); lightRaw.delete();
  const ll = new cv.Mat(), ls = new cv.Mat(), lc = new cv.Mat();
  const ln = cv.connectedComponentsWithStats(light, ll, ls, lc, 4, cv.CV_32S);
  const L = ls.data32S, labels = ll.data32S;
  const sample = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : labels[y * W + x];
  const owner = (b) => { // which light region holds this block: majority of samples just outside its box
    const { x, y, w, h } = b.box, d = 3, votes = new Map();
    for (const [sx, sy] of [[x - d, y + h / 2], [x + w + d, y + h / 2], [x + w / 2, y - d], [x + w / 2, y + h + d], [x - d, y - d], [x + w + d, y - d], [x - d, y + h + d], [x + w + d, y + h + d]]) {
      const v = sample(Math.round(sx), Math.round(sy)); if (v) votes.set(v, (votes.get(v) || 0) + 1);
    }
    let best = 0, n = 0; for (const [k, v] of votes) if (v > n) { best = k; n = v; }
    return n >= 3 ? best : 0;
  };
  const byLight = new Map();
  for (const b of blocks) { const o = owner(b); if (o) (byLight.get(o) || byLight.set(o, []).get(o)).push(b); }
  const bubbles = [];
  const srcData = src.data;
  for (const [i, inBlocks] of byLight) {
    const x = L[i * 5], y = L[i * 5 + 1], w = L[i * 5 + 2], h = L[i * 5 + 3], a = L[i * 5 + 4];
    const frac = a / (W * H);
    if (frac < 0.0006 || frac > 0.12) continue;
    if (w > 0.6 * W || h > 0.45 * H || w * h > 0.15 * W * H) continue; // a bubble is never most of the page
    const touches = x <= 1 || y <= 1 || x + w >= W - 1 || y + h >= H - 1;
    if (touches && frac > 0.02) continue; // page/panel background, not a bubble
    if (a / (w * h) < 0.3) continue; // too ragged (gutters, sky between art)
    const textArea = inBlocks.reduce((s, b) => s + b.box.w * b.box.h, 0);
    const glyphCount = inBlocks.reduce((s, b) => s + b.glyphCount, 0);
    if (glyphCount < 2) continue;
    if (glyphCount < 4 && textArea / a < 0.1) continue; // two specks in a big light shape: eyes in a face, not a bubble
    if (textArea / a < 0.04) continue; // text is incidental: a background with a small label on it
    // A bubble is a flat light shape whose only content is lettering. Its holes
    // (filled outline minus light pixels) must be small and mostly glyphs; a
    // panel background with a character drawn on it fails both.
    const roi = light.roi(new cv.Rect(x, y, w, h));
    const m = new cv.Mat(h, w, cv.CV_8UC1);
    const md = m.data, rd = roi.data, step = roi.step ? roi.step[0] : W;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) md[yy * w + xx] = labels[(y + yy) * W + x + xx] === i ? 255 : 0;
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let filled = 0, hullArea = 0, bestK = -1;
    for (let k = 0; k < contours.size(); k++) {
      const ct = contours.get(k), ar = cv.contourArea(ct);
      if (ar > filled) { filled = ar; bestK = k; const hull = new cv.Mat(); cv.convexHull(ct, hull); hullArea = cv.contourArea(hull); hull.delete(); }
      ct.delete();
    }
    // the bubble's full footprint (lettering holes filled) — layout needs the shape, not the surface
    let fill = null;
    if (bestK >= 0) { m.setTo(new cv.Scalar(0)); cv.drawContours(m, contours, bestK, new cv.Scalar(255), -1); fill = new Uint8Array(m.data); }
    contours.delete(); hier.delete(); m.delete(); roi.delete();
    const holes = Math.max(0, filled - a);
    const textInk = inBlocks.reduce((s, b) => s + b.inkArea, 0);
    if (holes / Math.max(1, filled) > 0.3) continue; // too much drawn inside: a background, not a bubble
    if (holes > 0 && textInk / holes < 0.45) continue; // what is inside is mostly not lettering
    if (hullArea && a / hullArea < 0.45) continue; // ragged shape (sky between branches, gutters)
    // bubble colour: mean of the region's own pixels
    let r = 0, g = 0, bb = 0, n = 0;
    for (let yy = y; yy < y + h; yy += 3) for (let xx = x; xx < x + w; xx += 3) {
      const p = yy * W + xx; if (labels[p] !== i) continue;
      r += srcData[p * 4]; g += srcData[p * 4 + 1]; bb += srcData[p * 4 + 2]; n++;
    }
    const color = n ? [Math.round(r / n), Math.round(g / n), Math.round(bb / n)] : (dark ? [0, 0, 0] : [255, 255, 255]);
    const letter = capHeight(inBlocks.flatMap((b) => b.glyphs.map((gi) => glyphs[gi].h)));
    if (letter < W / 180) continue; // "text" too small to be lettering (eye highlights, dots)
    const bubble = { id: 0, box: { x, y, w, h }, area: a, color, dark, letter, blocks: inBlocks, labelId: i, labels: ll, fill };
    for (const b of inBlocks) b.bubble = bubble;
    bubbles.push(bubble);
  }

  ink.delete(); gs.delete(); gc.delete(); kern.delete(); closed.delete(); bl.delete(); bs.delete(); bc.delete(); light.delete(); ls.delete(); lc.delete();
  return {
    dark, glyphs, glyphLabels: gl, regionLabels: ll, blocks, bubbles,
    dispose() { gl.delete(); ll.delete(); },
  };
}

/**
 * @typedef {object} Analysis
 * @property {number} W
 * @property {number} H
 * @property {number} letter page-wide typical glyph height (px)
 * @property {Array<{id:number, kind:"bubble"|"block", box:{x:number,y:number,w:number,h:number}, letter:number, dark:boolean, ref:object}>} regions stampable text regions in reading order
 * @property {(regionId:number)=>((x:number,y:number)=>boolean)|null} insideOf
 * @property {()=>void} dispose
 */
