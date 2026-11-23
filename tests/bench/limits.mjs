// What holds a line's text small: the same line fitted again in a room a quarter wider, and a
// quarter taller (text.js, the same font for the page). Width: only the wider room lets it grow
// (a long word across a narrow bubble); height: only the taller; both: either; neither: the room
// is not what holds it (the fitter's own limits).
import { createCanvas } from "canvas";

/**
 * @param {object} GyText the lettering module (text.js)
 * @param {Array} placements as drawn, with `sizes` the size each was drawn at
 * @param {number[]} which indexes of the placements to look at (the small ones)
 * @returns {Map<number, "width"|"height"|"both"|"neither">}
 */
export function sizeLimits(GyText, placements, sizes, which, W, H) {
  const out = new Map();
  if (!which.length) return out;
  const ctx = createCanvas(W, H).getContext("2d"), pageTexts = placements.map((p) => p.text);
  const fit = (ps) => { const s = []; GyText.draw(ctx, ps, { sizes: s, pageTexts }); return s; };
  const pick = which.map((k) => placements[k]);
  const wider = fit(pick.map((p) => ({ ...p, rect: { ...p.rect, x: p.rect.x - p.rect.w / 8, w: p.rect.w * 1.25 }, shape: p.shape && { ...p.shape, half: p.shape.half.map((h) => h * 1.25) } })));
  const taller = fit(pick.map((p) => ({ ...p, rect: { ...p.rect, y: p.rect.y - p.rect.h / 8, h: p.rect.h * 1.25 }, shape: p.shape && { ...p.shape, dy: p.shape.dy * 1.25, step: p.shape.step * 1.25, top: p.rect.y - p.rect.h / 8 + p.shape.dy * 1.25 } })));
  which.forEach((k, j) => {
    const gw = wider[j] / sizes[k], gh = taller[j] / sizes[k];
    out.set(k, gw >= 1.05 && gh >= 1.05 ? "both" : gw >= 1.05 ? "width" : gh >= 1.05 ? "height" : "neither");
  });
  return out;
}

/** The counts for a row: smallWidth, smallHeight, smallBoth, smallNeither. */
export const limitCounts = (limits) => Object.fromEntries(["width", "height", "both", "neither"].map((c) => [`small${c[0].toUpperCase()}${c.slice(1)}`, [...limits.values()].filter((v) => v === c).length]));

/**
 * Whether `text` could be set at `size` inside a bubble at all: wrapped (hyphenated as text.js
 * does) into rows of the bubble's true interior, the block centred on it, each line as wide as the
 * interior's whole run at its height, no margin from the outline. A bound: what no layout and no
 * fitter can beat. False means the translation is too long for this bubble at that size.
 * @param {(x:number, y:number) => boolean} inside the true interior
 */
export function fitsInside(GyText, ctx, family, text, inside, bbox, size) {
  const lh = 1.15, measure = (t) => ctx.measureText(t).width;
  ctx.font = `bold ${size}px ${family}`;
  const run = (y0, y1) => {
    // the narrowest of the interior's widest runs over the line's height
    let w = Infinity;
    for (let y = Math.ceil(y0); y < y1; y += Math.max(1, Math.floor(size / 6))) {
      let best = 0, cur = 0;
      for (let x = bbox.x; x < bbox.x + bbox.w; x++) { if (inside(x, y)) { cur++; if (cur > best) best = cur; } else cur = 0; }
      w = Math.min(w, best);
    }
    return w === Infinity ? 0 : w;
  };
  const cy = bbox.y + bbox.h / 2;
  for (let n = 1; n * size * lh <= bbox.h; n++) {
    const top = cy - (n * size * lh) / 2, ws = Array.from({ length: n }, (_, k) => run(top + k * size * lh, top + (k + 1) * size * lh));
    if (ws.some((w) => w <= 0)) break;
    const w = GyText.wrapInfo(measure, text, (k) => ws[Math.min(k, n - 1)], {});
    if (!w.broken && w.lines.length <= n && w.lines.every((l, j) => measure(l) <= ws[j])) return true;
  }
  return false;
}
