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
/**
 * Share of glyphs that line up with another glyph (same row or same column within
 * a third of a letter). Lettering is aligned; fragments of art are scattered.
 */
function alignment(gs, letter) {
  if (gs.length < 2) return 1;
  const tol = Math.max(2, letter * 0.35); let n = 0;
  for (let i = 0; i < gs.length; i++) {
    const cx = gs[i].x + gs[i].w / 2, cy = gs[i].y + gs[i].h / 2; let ok = false;
    for (let j = 0; j < gs.length && !ok; j++) { if (i === j) continue; const dx = Math.abs(gs[j].x + gs[j].w / 2 - cx), dy = Math.abs(gs[j].y + gs[j].h / 2 - cy); ok = dy < tol || dx < tol; }
    if (ok) n++;
  }
  return n / gs.length;
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
  // Bubbles do not nest: a light shape that holds another bubble is a background.
  // B is inside A when all four corners of B's box fall on A's filled shape (a
  // small bubble overlapping a big one has corners outside it).
  const encloses = (A, B) => {
    if (!A.fill || B.area >= 0.5 * A.area) return false;
    const on = (x, y) => { const lx = x - A.box.x, ly = y - A.box.y; return lx >= 0 && ly >= 0 && lx < A.box.w && ly < A.box.h && A.fill[ly * A.box.w + lx] !== 0; };
    const { x, y, w, h } = B.box;
    return on(x, y) && on(x + w - 1, y) && on(x, y + h - 1) && on(x + w - 1, y + h - 1);
  };
  bubbles = bubbles.filter((A) => { const nests = bubbles.some((B) => B !== A && encloses(A, B)); if (nests) { trace("region", A.box, "encloses another bubble: a background"); for (const bl of A.blocks) bl.bubble = null; } return !nests; });

  // Dialogue size: letter-weighted median over all text blocks (real text carries
  // far more letters than fragments on art; bubbles alone can be the wrong ones
  // on a page whose real bubbles have no outline).
  const weighted = (bs) => { const v = []; for (const b of bs) for (let i = 0; i < Math.min(b.glyphCount, 40); i++) v.push(b.letter); return median(v); };
  const pageLetter = weighted(blocks) || Math.max(8, W / 60);
  // Dialogue on one page spans about half to twice the typical size (whispers,
  // shouts); what is further out is sound effects or art.
  // Bubbles are kept whatever their lettering size: the page estimate is only as
  // good as the page's bubbles (one shout bubble on a sparse page skews it), and
  // a bubble has already shown it holds lettering. Loose text has no such
  // evidence and is held to the dialogue size band.
  blocks = blocks.filter((b) => b.bubble || (b.letter >= 0.6 * pageLetter && b.letter <= 2.2 * pageLetter));
  const band = Math.max(1, Math.round(H / 24));
  const order = (a, b) => (Math.floor(a.box.y / band) - Math.floor(b.box.y / band)) || (a.box.x - b.box.x);
  bubbles.sort(order);
  // Free text (no bubble around it) needs stronger evidence than lettering in a
  // bubble: a dense line of several letters. Fragments of art along a speed line
  // group into "lines" too, but sparsely.
  // Free text (no bubble around it) needs stronger evidence than lettering in a
  // bubble. Each candidate line must look like one row of letters; the lines are
  // then merged into paragraphs (stacked with small gaps, or side by side for
  // columns), and the paragraph as a whole must be a dense run of several
  // separate letters — a short line like "ya es" counts through its paragraph.
  const lineLike = blocks.filter((b) => {
    if (b.bubble !== null) return false;
    if (b.letter < 0.8 * pageLetter || b.letter > 2.2 * pageLetter) return false; // narration is dialogue-sized
    // one row high — or a short stack of rows the closing already joined (several
    // letters); a cloud of fragments is neither
    if (b.gbox.h > 1.8 * b.letter && !(b.glyphCount >= 6 && b.gbox.h <= 4 * b.letter)) return false;
    const gs = b.glyphs.map((gi) => polarities[b.dark ? 1 : 0].glyphs[gi]);
    let inkTall = 0, inkTot = 0; for (const g of gs) { inkTot += g.a; if (g.w <= 1.4 * g.h) inkTall += g.a; } // letters are not wider than tall (W and M aside)
    return inkTall / inkTot >= 0.6;
  });
  const freeBlocks = mergeParagraphs(lineLike).filter((b) => {
    if (b.glyphCount < (b.dark ? 5 : 4) || b.components < 3) return false; // several separate marks, not one long fragment
    const gs = b.glyphs.map((gi) => polarities[b.dark ? 1 : 0].glyphs[gi]);
    const density = gs.reduce((s, g) => s + g.w, 0) / Math.max(1, b.lineWidth || b.gbox.w);
    const lines = b.lines || 1;
    return density >= 0.45 && (lines >= 3 || b.gbox.w >= 1.2 * b.gbox.h);
  }).sort(order);
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

/** Agglomerative merge of text lines into paragraphs (same polarity, similar size, small gap, overlapping extent). */
function mergeParagraphs(lines) {
  const out = lines.map((b) => ({ ...b, gbox: { ...b.gbox }, box: { ...b.box }, glyphs: [...b.glyphs] }));
  const gap = (a0, a1, b0, b1) => Math.max(a0, b0) - Math.min(a1, b1); // negative when overlapping
  const overlapFrac = (a0, a1, b0, b1) => -gap(a0, a1, b0, b1) / Math.max(1, Math.min(a1 - a0, b1 - b0));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.dark !== b.dark) continue;
      const L = Math.max(a.letter, b.letter);
      if (Math.min(a.letter, b.letter) < 0.5 * L) continue;
      const A = a.gbox, B = b.gbox;
      const stacked = overlapFrac(A.x, A.x + A.w, B.x, B.x + B.w) >= 0.4 && gap(A.y, A.y + A.h, B.y, B.y + B.h) <= 1.3 * L;
      const beside = overlapFrac(A.y, A.y + A.h, B.y, B.y + B.h) >= 0.4 && gap(A.x, A.x + A.w, B.x, B.x + B.w) <= 0.8 * L;
      if (!stacked && !beside) continue;
      const ux0 = Math.min(A.x, B.x), uy0 = Math.min(A.y, B.y), ux1 = Math.max(A.x + A.w, B.x + B.w), uy1 = Math.max(A.y + A.h, B.y + B.h);
      const bx0 = Math.min(a.box.x, b.box.x), by0 = Math.min(a.box.y, b.box.y), bx1 = Math.max(a.box.x + a.box.w, b.box.x + b.box.w), by1 = Math.max(a.box.y + a.box.h, b.box.y + b.box.h);
      out[i] = { ...a, gbox: { x: ux0, y: uy0, w: ux1 - ux0, h: uy1 - uy0 }, box: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, glyphs: a.glyphs.concat(b.glyphs), glyphCount: a.glyphCount + b.glyphCount, components: a.components + b.components, inkArea: a.inkArea + b.inkArea, letter: Math.max(a.letter, b.letter), lines: (a.lines || 1) + (b.lines || 1), lineWidth: (a.lineWidth || a.gbox.w) + (b.lineWidth || b.gbox.w) };
      out.splice(j, 1); merged = true; break outer;
    }
  }
  return out;
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
    // Letters touch at small sizes (one component per word on an 850 px page), so
    // a component counts as about w / (0.75 h) letters — Latin letters are ~0.6 of
    // their height wide, CJK characters ~1.0.
    const letters = ok ? Math.max(1, Math.round(w / (0.75 * h))) : 0;
    glyphs[i] = { x, y, w, h, a, ok, letters };
  }

  // --- text blocks: glyphs joined along lines/columns ---
  // Close only the glyph-sized components: on a scan, letters sit a pixel or two
  // from the bubble outline, and closing the raw ink would weld the line to the
  // outline and the art behind it (one giant component, silently dropped).
  const glyphMask = new cv.Mat.zeros(H, W, cv.CV_8UC1);
  { const L = gl.data32S, M = glyphMask.data; for (let p = 0; p < W * H; p++) { const g = glyphs[L[p]]; if (g && g.ok) M[p] = 255; } }
  const kern = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.max(3, Math.round(W / 90)), Math.max(3, Math.round(W / 200))));
  const closed = new cv.Mat(); cv.morphologyEx(glyphMask, closed, cv.MORPH_CLOSE, kern); glyphMask.delete();
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
    const letterCount = good.reduce((n, g) => n + glyphs[g].letters, 0);
    blocks.push({ box: { x, y, w, h }, gbox: { x: gx0, y: gy0, w: gx1 - gx0, h: gy1 - gy0 }, letter, glyphCount: letterCount, components: good.length, glyphs: good, inkArea, label: i, dark, bubble: null, region: null });
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
    if (frac < 0.0006 || frac > 0.2) { reject("area out of range"); continue; }
    if (w > 0.8 * W || h > 0.6 * H || w * h > 0.3 * W * H) { reject("too large for a bubble"); continue; } // a bubble is never most of the page
    const touches = x <= 1 || y <= 1 || x + w >= W - 1 || y + h >= H - 1;
    // Bubbles often bleed off the page or panel edge; a background touching the
    // edge is large (and the content tests below catch what art it holds).
    if (touches && frac > 0.2) { reject("touches the page edge"); continue; }
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
    const regionGlyphs = inBlocks.flatMap((b) => b.glyphs.map((gi) => glyphs[gi]));
    const textInk = inBlocks.reduce((s, b) => s + b.inkArea, 0);
    const aligned = alignment(regionGlyphs, capHeight(inBlocks.map((b) => b.letter)));
    if (regionGlyphs.length >= 4 && aligned < (dark ? 0.8 : 0.6)) { reject("lettering not aligned in rows or columns", { aligned, glyphCount }); continue; }
    if (dark && glyphCount < 4) { reject("too little light lettering for a dark bubble", { glyphCount }); continue; } // real dark bubbles are rare; white specks on black art are not
    // Text lines hold several letters each (vertical text: blocks stacked in a
    // column). Many "lines" of one or two marks are scattered detail.
    if (inBlocks.length >= 3) {
      const letterHere = capHeight(inBlocks.map((b) => b.letter)), tol = Math.max(2, letterHere * 0.3);
      // rows: blocks sharing a baseline (a line of small text often splits into several blocks)
      const rows = []; for (const b of [...inBlocks].sort((p, q) => p.gbox.y - q.gbox.y)) { const cy = b.gbox.y + b.gbox.h / 2; const r = rows.find((row) => Math.abs(row.cy - cy) < Math.max(tol, letterHere * 0.5)); if (r) { r.n += b.glyphCount; r.cy = (r.cy + cy) / 2; } else rows.push({ cy, n: b.glyphCount }); }
      const perRow = glyphCount / rows.length;
      let column = 0;
      for (const a of inBlocks) { let n = 0; const ax = a.gbox.x + a.gbox.w / 2; for (const b of inBlocks) if (Math.abs(b.gbox.x + b.gbox.w / 2 - ax) < tol) n++; column = Math.max(column, n); }
      if (rows.length >= 3 && perRow < 2.5 && column < 3) { reject("lines too sparse to be lettering", { perRow, rows: rows.length, column }); continue; }
    }
    // A few marks that are large relative to the shape (a face's features, a
    // fold) are not lettering, which is small relative to the bubble holding it;
    // and letters are dense within their own footprint.
    const letterHere = capHeight(inBlocks.map((b) => b.letter));
    if ((glyphCount <= 3 && letterHere > 0.25 * Math.min(w, h)) || letterHere > 0.55 * Math.min(w, h)) { reject("marks too large for the shape", { letter: letterHere, letters: glyphCount }); continue; } // sound effects enclose light gaps between their own strokes
    if (glyphCount < 8 && textInk / Math.max(1, textArea) < 0.06) { reject("marks too sparse in their footprint", { inkInFoot: textInk / Math.max(1, textArea), glyphCount }); continue; }
    // Glyph heights cluster across the whole region in real lettering (one or two
    // sizes); mechanical detail and foliage spread out.
    if (regionGlyphs.length >= 4) {
      const mid = inkMedianHeight(regionGlyphs); let near = 0, tot = 0;
      for (const g of regionGlyphs) { tot += g.a; if (g.h >= 0.45 * mid && g.h <= 1.8 * mid) near += g.a; }
      if (near / tot < 0.5) { reject("glyph heights too varied for lettering", { nearFrac: near / tot }); continue; }
    }
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
    if (holes / Math.max(1, filled) > 0.3) { reject("too much drawn inside", { holeFrac: holes / filled }); continue; } // a background, not a bubble
    // What is inside must be the lettering: count hole pixels that fall within the
    // text blocks' footprints (a little grown, for anti-aliased fringes on scans).
    let holesInText = 0;
    if (holes > 0 && fill) {
      const pad = Math.max(2, Math.round(capHeight(inBlocks.map((b) => b.letter)) * 0.35));
      const ld = light.data;
      for (const b of inBlocks) {
        const bx0 = Math.max(x, b.gbox.x - pad), by0 = Math.max(y, b.gbox.y - pad), bx1 = Math.min(x + w, b.gbox.x + b.gbox.w + pad), by1 = Math.min(y + h, b.gbox.y + b.gbox.h + pad);
        for (let yy = by0; yy < by1; yy++) for (let xx = bx0; xx < bx1; xx++) { if (fill[(yy - y) * w + (xx - x)] && !ld[yy * W + xx]) holesInText++; }
      }
    }
    if (holes > 0 && holesInText / holes < 0.45) { reject("content inside is not lettering", { inText: holesInText / holes }); continue; }
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
