// Screentone fill: continues a periodic surface (halftone dots, regular hatching) under removed
// lettering by copying it from one lattice period away, the way the tone was laid down.
//
// Screentone is a lattice by construction: the same cell repeated along two vectors. Where the
// surface around the lettering is one, the right fill is that cell, in phase, which a learned
// inpainter at this scale does not reproduce (it leaves a mottled smudge). The lattice is
// measured, not assumed: from the autocorrelation of the surrounding texture, refined to a
// fraction of a pixel. And the fill is used only when the lattice explains the surround: a band of
// known pixels next to the hole is predicted from farther ones the same way, and the prediction
// must beat "the local average" by a clear margin (VALIDATE). Anything else (art, irregular
// texture, smooth shading) returns null and goes to the learned inpainter.

import { TONE } from "./tuning.js";

/** Prediction error allowed, as a share of the error of predicting the local average. */
export const VALIDATE = TONE.validate;

const MIN_PEAK = TONE.minPeak; // autocorrelation below this is no lattice (noise, art)

/**
 * @param {any} cv OpenCV
 * @param {any} rgb cv.Mat CV_8UC3, the area with some page around it
 * @param {any} hole cv.Mat CV_8UC1, 255 where to fill
 * @param {any} [source] cv.Mat CV_8UC1, 255 on the surface the fill may copy from (a bubble's
 *   interior); none: every pixel outside the hole
 * @param {{margin?: number, maxPeriod?: number, info?: object}} [opts] margin: pixels to keep away from
 *   the source's edge (bits of a bubble's outline sit there); maxPeriod: longest lattice vector looked
 *   for; info: receives the lattice and the validation score
 * @returns {any|null} cv.Mat CV_8UC3 (only hole pixels changed; caller deletes), or null when the
 *   surround is not a lattice
 */
export function latticeFill(cv, rgb, hole, source = null, opts = {}) {
  const w = rgb.cols, h = rgb.rows, n = w * h;
  const P = Math.min(opts.maxPeriod || TONE.maxPeriod, Math.floor(Math.min(w, h) / TONE.periodsInArea));
  if (P < TONE.minPeriod) return null;
  const img = rgb.isContinuous() ? rgb : rgb.clone(), hm = hole.isContinuous() ? hole : hole.clone();
  const px = img.data, hd = hm.data;
  let sd = null;
  if (source) {
    const e = Math.max(0, Math.round(opts.margin ?? 2)), s = new cv.Mat();
    if (e) { const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * e + 1, 2 * e + 1)); cv.erode(source, s, k); k.delete(); } else source.copyTo(s);
    sd = new Uint8Array(s.data); s.delete();
  }
  const known = new Uint8Array(n);
  let nKnown = 0, nHole = 0;
  for (let i = 0; i < n; i++) { if (hd[i]) nHole++; else if (!sd || sd[i]) { known[i] = 1; nKnown++; } }
  const done = () => { if (img !== rgb) img.delete(); if (hm !== hole) hm.delete(); };
  if (!nHole || nKnown < TONE.minKnown) { done(); return null; }

  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * px[i * 3] + 0.587 * px[i * 3 + 1] + 0.114 * px[i * 3 + 2];
  // the texture: brightness minus its local average over known pixels (a gradient tone's slope is not texture)
  const t = highPass(cv, L, known, w, h, Math.max(TONE.highPassMin, P / TONE.highPassDiv));

  // how far a hole pixel is from the surface: copies must reach that far
  const dist = new cv.Mat(); cv.distanceTransform(hm, dist, cv.DIST_L2, 3);
  let inradius = 0; for (const v of dist.data32F) if (v > inradius) inradius = v;
  dist.delete();
  // and how far each pixel outside it is from the hole (one distance transform, instead of
  // dilating by a wide disc for every band below)
  const inv = new cv.Mat(), away = new cv.Mat();
  cv.bitwise_not(hm, inv); cv.distanceTransform(inv, away, cv.DIST_L2, 3); inv.delete();
  const fromHole = new Float32Array(away.data32F); away.delete();
  const nearHole = (d) => { const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = known[i] && fromHole[i] <= d ? 1 : 0; return out; };
  // the lattice is measured on the surface right around the hole (twice as far as the hole is deep,
  // 12 px at least): what lies under the lettering is most like that, while farther off the crop
  // can hold a panel's border, the gutter or a bubble
  const candidates = findLattices(t, nearHole(Math.max(TONE.nearHoleMinPx, Math.round(TONE.nearHoleDepths * inradius))), w, h, P);
  if (!candidates.length) { done(); return null; }

  // validate each candidate: predict a band of known pixels as deep as the hole from the rest, as
  // the fill would, and keep the lattice that predicts it best
  const reach = (r, lat) => r + TONE.reachPeriods * Math.max(len(lat[0]), len(lat[1]));
  let lattice = null, score = Infinity;
  for (const cand of candidates) {
    const step = Math.max(len(cand[0]), len(cand[1]));
    const band = Math.max(2, Math.min(Math.round(inradius), Math.round(2 * step)));
    const ring = nearHole(band), all = [], rest = new Uint8Array(known);
    for (let i = 0; i < n; i++) if (ring[i]) { all.push(i); rest[i] = 0; }
    if (all.length < TONE.minBand) continue;
    // the score is an average: a scattered few thousand of the band's pixels estimate it closely
    const held = sample(all, TONE.bandSample);
    const guess = predict(px, rest, w, h, held, cand, reach(band, cand), depthTo(cv, rest, w, h));
    let err = 0, base = 0, seen = 0;
    for (let j = 0; j < held.length; j++) {
      if (Number.isNaN(guess[j * 3])) continue;
      const i = held[j], g = 0.299 * guess[j * 3] + 0.587 * guess[j * 3 + 1] + 0.114 * guess[j * 3 + 2];
      err += Math.abs(g - L[i]); base += Math.abs(t[i]); seen++;
    }
    // too few predicted, or no texture to speak of (a smooth surface: not this fill's business)
    if (seen < TONE.seenShare * held.length || base / Math.max(1, seen) < TONE.minTexture) continue;
    if (err / base < score) { score = err / base; lattice = cand; }
  }
  if (!lattice || score > VALIDATE) { done(); return null; }

  // fill
  const holes = []; for (let i = 0; i < n; i++) if (hd[i]) holes.push(i);
  const fill = predict(px, known, w, h, holes, lattice, reach(inradius, lattice), depthTo(cv, known, w, h));
  const out = img.clone(), od = out.data;
  const left = new cv.Mat(h, w, cv.CV_8UC1, new cv.Scalar(0)), ld = left.data;
  let missing = 0;
  for (let j = 0; j < holes.length; j++) {
    const i = holes[j];
    if (Number.isNaN(fill[j * 3])) { ld[i] = 255; missing++; continue; }
    od[i * 3] = fill[j * 3]; od[i * 3 + 1] = fill[j * 3 + 1]; od[i * 3 + 2] = fill[j * 3 + 2];
  }
  // a few pixels with no lattice copy in reach (pinned between hole and edge): smooth fill
  if (missing) { const t2 = new cv.Mat(); cv.inpaint(out, left, t2, TONE.leftRadius, cv.INPAINT_TELEA); t2.copyTo(out); t2.delete(); }
  left.delete(); done();
  if (opts.info) Object.assign(opts.info, { lattice, score });
  return out;
}

const len = (v) => Math.hypot(v[0], v[1]);

/** At most `k` of `list`, scattered evenly (deterministic). */
function sample(list, k) {
  if (list.length <= k) return list;
  const out = [], step = list.length / k;
  for (let j = 0; j < k; j++) out.push(list[Math.floor(j * step + step / 2)]);
  return out;
}


/** Brightness minus its Gaussian-weighted average over known pixels; 0 off the known pixels. */
function highPass(cv, L, known, w, h, sigma) {
  const n = w * h, a = new cv.Mat(h, w, cv.CV_32F), b = new cv.Mat(h, w, cv.CV_32F);
  const ad = a.data32F, bd = b.data32F;
  for (let i = 0; i < n; i++) { ad[i] = known[i] ? L[i] : 0; bd[i] = known[i]; }
  const ks = new cv.Size(0, 0);
  cv.GaussianBlur(a, a, ks, sigma, sigma, cv.BORDER_REFLECT_101); cv.GaussianBlur(b, b, ks, sigma, sigma, cv.BORDER_REFLECT_101);
  const t = new Float32Array(n), ad2 = a.data32F, bd2 = b.data32F;
  for (let i = 0; i < n; i++) t[i] = known[i] ? L[i] - ad2[i] / Math.max(bd2[i], 1e-3) : 0;
  a.delete(); b.delete();
  return t;
}

/**
 * Candidate lattices of the texture, each two vectors [v1, v2] (pixels, sub-pixel); none when
 * there is no clear period. From the normalised autocorrelation over shifts up to P: v1 the
 * shortest strong peak, v2 one of the three shortest peaks not along it (a line through the area,
 * a panel's border say, can make one direction look far stronger than the other, so v2 is not
 * required to be as strong: the validation chooses), each pair refined by least squares over the
 * peaks at their sums.
 */
function findLattices(t, known, w, h, P) {
  const S = 2 * P + 1, R = new Float32Array(S * S);
  // sample positions: every known pixel, or on large areas a scattered subset of them (a regular
  // grid would alias with the very period being measured)
  const keep = Math.min(1, TONE.autocorrSample / (w * h));
  const xs = [], ys = [];
  let seed = 12345;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!known[y * w + x]) continue;
    if (keep < 1) { seed = (seed * 1103515245 + 12345) >>> 0; if (seed / 4294967296 >= keep) continue; }
    xs.push(x); ys.push(y);
  }
  for (let dy = 0; dy <= P; dy++) for (let dx = -P; dx <= P; dx++) {
    if (dy === 0 && dx <= 0) continue;
    let num = 0, e1 = 0, e2 = 0, pairs = 0;
    for (let j = 0; j < xs.length; j++) {
      const x2 = xs[j] + dx, y2 = ys[j] + dy;
      if (x2 < 0 || x2 >= w || y2 >= h) continue;
      const q = y2 * w + x2;
      if (!known[q]) continue;
      const a = t[ys[j] * w + xs[j]], b = t[q];
      num += a * b; e1 += a * a; e2 += b * b; pairs++;
    }
    const r = pairs >= TONE.minPairs && e1 > 0 && e2 > 0 ? num / Math.sqrt(e1 * e2) : 0;
    R[(dy + P) * S + dx + P] = r; R[(P - dy) * S + P - dx] = r;
  }
  R[P * S + P] = 1;
  const at = (dx, dy) => (Math.abs(dx) <= P && Math.abs(dy) <= P ? R[(dy + P) * S + dx + P] : -1);
  const peaks = [];
  for (let dy = -P + 1; dy < P; dy++) for (let dx = -P + 1; dx < P; dx++) {
    if (dx * dx + dy * dy < TONE.minShift2) continue;
    const r = at(dx, dy);
    if (r < MIN_PEAK) continue;
    let top = true;
    for (let ey = -1; ey <= 1 && top; ey++) for (let ex = -1; ex <= 1; ex++) if ((ex || ey) && at(dx + ex, dy + ey) > r) { top = false; break; }
    if (top) peaks.push({ v: refine(at, dx, dy), r });
  }
  if (!peaks.length) return [];
  const rmax = Math.max(...peaks.map((p) => p.r));
  const byLength = peaks.slice().sort((a, b) => len(a.v) - len(b.v));
  const first = byLength.find((p) => p.r >= TONE.firstPeak * rmax);
  const across = (p) => Math.abs(p.v[0] * first.v[1] - p.v[1] * first.v[0]) >= TONE.acrossSin * len(p.v) * len(first.v);
  const seconds = [];
  for (const p of byLength) if (across(p) && !seconds.some((q) => Math.hypot(q.v[0] + p.v[0], q.v[1] + p.v[1]) < TONE.samePeakPx) && seconds.length < TONE.maxSeconds) seconds.push(p);
  return seconds.map((second) => refineLattice(at, first, second, P));
}

/** v1, v2 refined by least squares over the peaks at a·v1 + b·v2 (longer sums pin the period to a fraction of a pixel). */
function refineLattice(at, first, second, P) {
  const floor = TONE.peakFloor * Math.min(first.r, second.r);
  let L1 = first.v, L2 = second.v;
  for (let it = 0; it < 2; it++) {
    let aa = 0, ab = 0, bb = 0, ax = 0, bx = 0, ay = 0, by = 0, used = 0;
    for (let a = -TONE.refineRange; a <= TONE.refineRange; a++) for (let b = -TONE.refineRange; b <= TONE.refineRange; b++) {
      if (!a && !b) continue;
      const ex = a * L1[0] + b * L2[0], ey = a * L1[1] + b * L2[1];
      if (Math.abs(ex) > P - TONE.refineEdge || Math.abs(ey) > P - TONE.refineEdge) continue;
      let bx0 = Math.round(ex), by0 = Math.round(ey), br = at(bx0, by0);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const r = at(Math.round(ex) + ox, Math.round(ey) + oy); if (r > br) { br = r; bx0 = Math.round(ex) + ox; by0 = Math.round(ey) + oy; } }
      if (br < floor || Math.abs(bx0) >= P || Math.abs(by0) >= P) continue;
      const [dx, dy] = refine(at, bx0, by0);
      aa += a * a; ab += a * b; bb += b * b; ax += a * dx; bx += b * dx; ay += a * dy; by += b * dy; used++;
    }
    const det = aa * bb - ab * ab;
    if (used < TONE.minPeaksUsed || Math.abs(det) < 1e-6) break;
    L1 = [(bb * ax - ab * bx) / det, (bb * ay - ab * by) / det];
    L2 = [(aa * bx - ab * ax) / det, (aa * by - ab * ay) / det];
  }
  return [L1, L2];
}

/** A peak's position to a fraction of a pixel (a parabola through it and its neighbours, per axis). */
function refine(at, dx, dy) {
  const c = at(dx, dy);
  const off = (m, p) => { const d = m - 2 * c + p; return d < 0 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * d))) : 0; };
  return [dx + off(at(dx - 1, dy), at(dx + 1, dy)), dy + off(at(dx, dy - 1), at(dx, dy + 1))];
}

/** Each pixel's distance to the nearest known pixel (exact; 0 on known pixels). */
function depthTo(cv, known, w, h) {
  const m = new cv.Mat(h, w, cv.CV_8UC1), md = m.data;
  for (let i = 0; i < md.length; i++) md[i] = known[i] ? 0 : 255;
  const d = new cv.Mat();
  cv.distanceTransform(m, d, cv.DIST_L2, cv.DIST_MASK_PRECISE);
  const out = new Float32Array(d.data32F);
  m.delete(); d.delete();
  return out;
}

/**
 * For each target pixel, the average of its nearest lattice copies (up to 4, within `reach`
 * pixels) that land on known pixels, sampled between pixels. NaN where none is in reach.
 * `depth` (depthTo) only saves time: a copy nearer than a pixel's distance to the known pixels,
 * less the 1.42 px its four samples reach, can't land on them, so the search starts past those
 * (on a big area at a page's own size, most of the copies tried; 2.12.0 tried them all).
 * @returns {Float32Array} 3 values per target
 */
function predict(px, known, w, h, targets, [v1, v2], reach, depth = null) {
  const S = Math.min(TONE.maxCopiesOut, Math.ceil(reach / Math.min(len(v1), len(v2))) + 1);
  const offs = [];
  for (let a = -S; a <= S; a++) for (let b = -S; b <= S; b++) {
    if (!a && !b) continue;
    const ox = a * v1[0] + b * v2[0], oy = a * v1[1] + b * v2[1], d = Math.hypot(ox, oy);
    if (d <= reach) offs.push([ox, oy, d]);
  }
  offs.sort((p, q) => p[2] - q[2]);
  const OX = Float64Array.from(offs, (o) => o[0]), OY = Float64Array.from(offs, (o) => o[1]), OD = Float64Array.from(offs, (o) => o[2]);
  // the four samples of a copy at once: all known
  const quad = new Uint8Array(w * h);
  for (let y = 0; y + 1 < h; y++) for (let x = 0, p = y * w; x + 1 < w; x++, p++) quad[p] = known[p] & known[p + 1] & known[p + w] & known[p + w + 1];
  const firstPast = (dmin) => { let lo = 0, hi = OD.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (OD[mid] < dmin) lo = mid + 1; else hi = mid; } return lo; };
  const out = new Float32Array(targets.length * 3).fill(NaN);
  for (let j = 0; j < targets.length; j++) {
    const i = targets[j], x = i % w, y = (i - x) / w;
    let r = 0, g = 0, b = 0, c = 0;
    for (let k = depth && depth[i] > 3 ? firstPast(depth[i] - 2) : 0; k < OD.length; k++) {
      const qx = x + OX[k], qy = y + OY[k], x0 = Math.floor(qx), y0 = Math.floor(qy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      const p00 = y0 * w + x0, p10 = p00 + 1, p01 = p00 + w, p11 = p01 + 1;
      if (!quad[p00]) continue;
      const fx = qx - x0, fy = qy - y0, w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      r += px[p00 * 3] * w00 + px[p10 * 3] * w10 + px[p01 * 3] * w01 + px[p11 * 3] * w11;
      g += px[p00 * 3 + 1] * w00 + px[p10 * 3 + 1] * w10 + px[p01 * 3 + 1] * w01 + px[p11 * 3 + 1] * w11;
      b += px[p00 * 3 + 2] * w00 + px[p10 * 3 + 2] * w10 + px[p01 * 3 + 2] * w01 + px[p11 * 3 + 2] * w11;
      if (++c === TONE.copies) break;
    }
    if (c) { out[j * 3] = r / c; out[j * 3 + 1] = g / c; out[j * 3 + 2] = b / c; }
  }
  return out;
}
