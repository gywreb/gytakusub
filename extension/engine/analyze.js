// Page analysis on OpenCV: where the lettering is (glyphs → text blocks), which
// light/dark regions are speech bubbles, and how big the original letters are.
// Pure image analysis — no model output involved. Deterministic for an image.
//
// Coordinates are pixels of the analysed image (the "working" resolution the
// caller chose). The result keeps OpenCV label maps for erase/layout; call
// `analysis.dispose()` when done with it.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Diagnostics: set globalThis.GYT_TRACE = (kind, box, reason, extra) => … to hear
// why a text block or light region was rejected (tests/engine-viz.mjs --trace).
const trace = (...a) => { if (globalThis.GYT_TRACE) globalThis.GYT_TRACE(...a); };
const odd = (n) => (n % 2 ? n : n + 1);
const median = (a) => { if (!a.length) return 0; const t = Float64Array.from(a).sort(); return t[t.length >> 1]; };
// Cap height of the lettering: the 80th percentile of glyph heights (caps and
// ascenders) — the median would track x-height in mixed-case text.
/** Height at which half of the ink lies: letters dominate, fragments and dots do not. */
function inkMedianHeight(gs) {
  const t = [...gs].sort((a, b) => a.h - b.h); let tot = 0; for (const g of t) tot += g.a;
  let acc = 0; for (const g of t) { acc += g.a; if (acc >= tot / 2) return g.h; } return t.length ? t[t.length - 1].h : 0;
}
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
    const box = { x, y, w, h };
    if (good.length < 1) { if (members.length) trace("block", box, "no glyph-sized components", { members: members.length }); continue; }
    // most of the ink in a text block belongs to glyph-sized components (art fails this)
    let inkAll = 0, inkGood = 0;
    for (const g of members) { inkAll += glyphs[g].a; if (glyphs[g].ok) inkGood += glyphs[g].a; }
    if (inkGood / inkAll < 0.6) { trace("block", box, "ink mostly in non-glyph components", { ratio: inkGood / inkAll }); continue; }
    if (good.length === 1 && glyphs[good[0]].h < minH * 2) continue; // a lone speck
    // Letters of one font share a height; a cloud of art fragments does not.
    // Weighted by ink, so dashes, dots and punctuation (little ink, odd heights)
    // do not disqualify a real line of text.
    const heights = good.map((g) => glyphs[g].h);
    const mid = inkMedianHeight(good.map((gi) => glyphs[gi])); // the height where half the ink lies (not skewed by stroke fragments)
    if (good.length >= 3) {
      let inkNear = 0, inkTot = 0;
      for (const gi of good) { const g = glyphs[gi]; inkTot += g.a; if (g.h >= 0.55 * mid && g.h <= 1.6 * mid) inkNear += g.a; }
      if (inkNear / inkTot < 0.6) { trace("block", box, "inconsistent glyph heights", { heights, inkNear: inkNear / inkTot }); continue; }
    }
    const letter = capHeight(heights.filter((h) => h >= 0.55 * mid)); // cap height of the letters proper, not of a stray dash
    if (letter < W / 200) { trace("block", box, "lettering too small", { letter }); continue; }
    // Stroke width: letters of one font share it (relative to their height);
    // hair, shading and mechanical detail do not. Max distance-transform value
    // inside a glyph ≈ half its stroke width.
    const core = good.filter((gi) => glyphs[gi].h >= 0.55 * mid); // the letters proper (see above)
    {
      const roi = ink.roi(new cv.Rect(x, y, w, h)), dt = new cv.Mat();
      cv.distanceTransform(roi, dt, cv.DIST_L2, 3);
      const D = dt.data32F, ratios = [];
      let blobs = 0;
      for (const gi of core) {
        const g = glyphs[gi]; let mx = 0;
        for (let yy = g.y - y; yy < g.y - y + g.h; yy++) for (let xx = g.x - x; xx < g.x - x + g.w; xx++) { const v = D[yy * w + xx]; if (v > mx) mx = v; }
        ratios.push((2 * mx) / g.h);
        // a solid blob (eye, dot, filled shape): thick all the way through and well filled
        if ((2 * mx) / Math.min(g.w, g.h) >= 0.85 && g.a / (g.w * g.h) >= 0.6 && g.h >= minH * 2) blobs++;
      }
      roi.delete(); dt.delete();
      if (core.length && blobs === core.length) { trace("block", box, "solid blobs, not lettering", { blobs }); continue; } // eyes, buttons, dots
      if (core.length >= 3) {
      const mr = median(ratios);
      if (mr < 0.06 || mr > 0.7) { trace("block", box, "stroke width out of range", { mr }); continue; } // hairline scratches or solid blobs
      if (median(ratios.map((v) => Math.abs(v - mr))) / mr > 0.6) { trace("block", box, "inconsistent stroke widths", { ratios }); continue; } // not one font
      }
    }
    const inkArea = good.reduce((s, g) => s + glyphs[g].a, 0);
    // footprint of the lettering itself (the closed component can be inflated by art it touched)
    const gx0 = Math.min(...good.map((g) => glyphs[g].x)), gy0 = Math.min(...good.map((g) => glyphs[g].y));
    const gx1 = Math.max(...good.map((g) => glyphs[g].x + glyphs[g].w)), gy1 = Math.max(...good.map((g) => glyphs[g].y + glyphs[g].h));
    blocks.push({ box: { x, y, w, h }, gbox: { x: gx0, y: gy0, w: gx1 - gx0, h: gy1 - gy0 }, letter, glyphCount: good.length, glyphs: good, inkArea, label: i, dark, bubble: null, region: null });
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
  // Which light region holds a text block: the majority light label among the
  // block's own non-ink pixels (the bubble surface between the letters), with a
  // thin ring outside the box as a tie-breaker. Sampling only outside the box
  // let wide lettering vote for the panel behind its bubble.
  const inkData = ink.data;
  const owner = (b) => {
    const { x, y, w, h } = b.box, votes = new Map(), step = Math.max(1, Math.round(Math.min(w, h) / 12));
    let samples = 0;
    const vote = (sx, sy, wgt) => { const v = sample(sx, sy); samples += wgt; if (v) votes.set(v, (votes.get(v) || 0) + wgt); };
    for (let yy = y; yy < y + h; yy += step) for (let xx = x; xx < x + w; xx += step) { if (inkData[yy * W + xx]) continue; vote(xx, yy, 1); }
    const d = 3;
    for (let t = 0; t <= 1; t += 0.125) { vote(Math.round(x + w * t), y - d, 0.5); vote(Math.round(x + w * t), y + h + d, 0.5); vote(x - d, Math.round(y + h * t), 0.5); vote(x + w + d, Math.round(y + h * t), 0.5); }
    let best = 0, n = 0; for (const [k, v] of votes) if (v > n) { best = k; n = v; }
    return n >= 0.3 * samples ? best : 0;
  };
  const byLight = new Map();
  for (const b of blocks) { const o = owner(b); if (o) (byLight.get(o) || byLight.set(o, []).get(o)).push(b); }
  const bubbles = [];
  const srcData = src.data;
  for (const [i, inBlocks] of byLight) {
    const x = L[i * 5], y = L[i * 5 + 1], w = L[i * 5 + 2], h = L[i * 5 + 3], a = L[i * 5 + 4];
    const frac = a / (W * H), rbox = { x, y, w, h };
    const reject = (why, extra) => trace("region", rbox, why, { frac, blocks: inBlocks.length, ...extra });
    if (frac < 0.0006 || frac > 0.12) { reject("area out of range"); continue; }
    if (w > 0.6 * W || h > 0.45 * H || w * h > 0.15 * W * H) { reject("too large for a bubble"); continue; } // a bubble is never most of the page
    const touches = x <= 1 || y <= 1 || x + w >= W - 1 || y + h >= H - 1;
    if (touches && frac > 0.02) { reject("touches the page edge"); continue; } // page/panel background, not a bubble
    if (a / (w * h) < 0.3) { reject("too ragged", { fill: a / (w * h) }); continue; } // gutters, sky between art
    // Text footprint: the blocks' union box (a vertical column of characters is
    // many small blocks) — but no larger than 3× their summed area, so two
    // distant specks cannot claim a big region.
    const sumArea = inBlocks.reduce((s, b) => s + b.gbox.w * b.gbox.h, 0);
    const ux0 = Math.min(...inBlocks.map((b) => b.gbox.x)), uy0 = Math.min(...inBlocks.map((b) => b.gbox.y));
    const ux1 = Math.max(...inBlocks.map((b) => b.gbox.x + b.gbox.w)), uy1 = Math.max(...inBlocks.map((b) => b.gbox.y + b.gbox.h));
    const textArea = Math.min((ux1 - ux0) * (uy1 - uy0), 3 * sumArea);
    const glyphCount = inBlocks.reduce((s, b) => s + b.glyphCount, 0);
    if (glyphCount < 2) { reject("fewer than two glyphs", { glyphCount }); continue; }
    if (glyphCount < 4 && textArea / a < 0.1) { reject("a few specks in a big shape", { glyphCount, textFrac: textArea / a }); continue; } // eyes in a face, not a bubble
    // Little text in a big shape is a label on a background — unless the text sits
    // in the middle of the shape, which is how lettering sits in a bubble.
    const centred = Math.abs((ux0 + ux1) / 2 - (x + w / 2)) < 0.25 * w && Math.abs((uy0 + uy1) / 2 - (y + h / 2)) < 0.25 * h;
    if (textArea / a < 0.04 && !(centred && glyphCount >= 3 && textArea / a >= 0.008)) { reject("text is incidental", { textFrac: textArea / a, centred }); continue; }
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
    if (holes / Math.max(1, filled) > 0.3) { reject("too much drawn inside", { holeFrac: holes / filled }); continue; } // a background, not a bubble
    if (holes > 0 && textInk / holes < 0.45) { reject("content inside is not lettering", { inkFrac: textInk / holes }); continue; }
    if (hullArea && a / hullArea < 0.45) { reject("not convex enough", { solidity: a / hullArea }); continue; } // sky between branches, gutters
    // bubble colour: mean of the region's own pixels
    let r = 0, g = 0, bb = 0, n = 0;
    for (let yy = y; yy < y + h; yy += 3) for (let xx = x; xx < x + w; xx += 3) {
      const p = yy * W + xx; if (labels[p] !== i) continue;
      r += srcData[p * 4]; g += srcData[p * 4 + 1]; bb += srcData[p * 4 + 2]; n++;
    }
    const color = n ? [Math.round(r / n), Math.round(g / n), Math.round(bb / n)] : (dark ? [0, 0, 0] : [255, 255, 255]);
    const letter = capHeight(inBlocks.flatMap((b) => b.glyphs.map((gi) => glyphs[gi].h)));
    if (letter < W / 180) { reject("lettering too small", { letter }); continue; } // eye highlights, dots
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
