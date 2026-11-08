// Where each translation goes. Pure geometry on the analysis — no drawing, no
// fonts — so the page side (which has the fonts) only has to fit text into
// rectangles. All coordinates are working-resolution pixels.
//
// A tagged item goes into its stamped region, full stop: the stamps are our
// own numbering drawn on the image, so a matching tag is evidence the model
// read the picture; its pixel box is not. Boxes only order speakers inside a
// joined bubble, or place items that carry no tag.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {import("./analyze.js").Analysis} an
 * @param {Array<{tag:(number|null), box:(number[]|null), text:string, size:string, kind:string}>} items normalized items (box as fractions of the page)
 * @returns {{placements: Placement[], regionIds: Set<number>}}
 */
export function layout(an, items) {
  const { W, H } = an;
  const byId = new Map(an.regions.map((r) => [r.id, r]));
  const groups = new Map(); // region id → items
  const loose = [];
  for (const it of items) {
    if (!it.text) continue;
    const px = it.box ? { x: it.box[0] * W, y: it.box[1] * H, w: it.box[2] * W, h: it.box[3] * H } : null;
    let region = it.tag != null ? byId.get(it.tag) : null;
    if (!region && px) region = nearestRegion(an.regions, px);
    if (region) (groups.get(region.id) || groups.set(region.id, []).get(region.id)).push({ it, px });
    else if (px) loose.push({ it, px });
  }

  const placements = [];
  for (const [id, members] of groups) {
    const r = byId.get(id);
    const letter = r.letter;
    const color = r.dark ? "#fff" : "#000";
    if (r.kind === "bubble") {
      const inside = an.insideOf(id), bbox = r.box;
      if (members.length === 1) {
        const rect = inscribedRect(inside, bbox) || inset(bbox, 0.78);
        placements.push({ text: members[0].it.text, size: members[0].it.size, rect, letter, color, halo: false, tag: id });
      } else {
        // Joined bubble: order speakers top-to-bottom (by their boxes, else
        // evenly), cut at the waists between them, inscribe each lobe.
        const n = members.length;
        const centres = members.map((m, i) => m.px ? m.px.y + m.px.h / 2 : bbox.y + bbox.h * (i + 0.5) / n);
        const order = centres.map((c, i) => [c, i]).sort((a, b) => a[0] - b[0]);
        const edges = [bbox.y];
        for (let k = 0; k < n - 1; k++) edges.push(waistRow(inside, bbox, order[k][0], order[k + 1][0]));
        edges.push(bbox.y + bbox.h);
        order.forEach(([, i], k) => {
          const ya = edges[k], yb = edges[k + 1];
          const rect = inscribedRect(inside, bbox, ya, yb) || { x: bbox.x + bbox.w * 0.15, y: ya + (yb - ya) * 0.1, w: bbox.w * 0.7, h: (yb - ya) * 0.8 };
          placements.push({ text: members[i].it.text, size: members[i].it.size, rect, letter, color, halo: false, tag: id });
        });
      }
    } else {
      // Free text block: the translation takes the block's own footprint, with
      // a little room, and is drawn with a halo since it sits on artwork.
      const b = r.box, pad = letter * 0.5;
      const rect = clampRect({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, W, H);
      const text = members.map((m) => m.it.text).join(" ");
      placements.push({ text, size: members[0].it.size, rect, letter, color: r.dark ? "#fff" : "#000", halo: true, tag: id });
    }
  }
  for (const { it, px } of loose) {
    placements.push({ text: it.text, size: it.size, rect: clampRect(px, W, H), letter: an.letter, color: "#000", halo: true, tag: null });
  }

  separate(placements);
  return { placements, regionIds: new Set(groups.keys()) };
}

function nearestRegion(regions, px) {
  const cx = px.x + px.w / 2, cy = px.y + px.h / 2;
  let best = null, bestScore = 0;
  for (const r of regions) {
    const b = r.box;
    const ix = Math.max(0, Math.min(px.x + px.w, b.x + b.w) - Math.max(px.x, b.x));
    const iy = Math.max(0, Math.min(px.y + px.h, b.y + b.h) - Math.max(px.y, b.y));
    const overlap = (ix * iy) / Math.max(1, px.w * px.h);
    const centreIn = cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
    const score = overlap + (centreIn ? 0.5 : 0);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 0.5 ? best : null;
}

function inset(b, k) { return { x: b.x + b.w * (1 - k) / 2, y: b.y + b.h * (1 - k) / 2, w: b.w * k, h: b.h * k }; }
function clampRect(r, W, H) {
  const x = clamp(r.x, 0, W - 1), y = clamp(r.y, 0, H - 1);
  return { x, y, w: clamp(r.w, 4, W - x), h: clamp(r.h, 4, H - y) };
}

/** Largest axis-aligned rectangle inside a pixel mask (rows sampled at `step`). */
export function inscribedRect(inside, bbox, y0 = bbox.y, y1 = bbox.y + bbox.h) {
  if (!inside) return null;
  const step = Math.max(1, Math.round(Math.min(bbox.w, bbox.h) / 60));
  const rows = [];
  for (let y = Math.ceil(y0); y < y1; y += step) {
    let best = null, runStart = null;
    for (let x = bbox.x; x <= bbox.x + bbox.w; x += step) {
      const inn = x < bbox.x + bbox.w && inside(x, y);
      if (inn && runStart === null) runStart = x;
      if (!inn && runStart !== null) { if (!best || x - runStart > best.w) best = { x: runStart, w: x - runStart }; runStart = null; }
    }
    if (runStart !== null) { const end = bbox.x + bbox.w; if (!best || end - runStart > best.w) best = { x: runStart, w: end - runStart }; }
    rows.push(best ? { y, x0: best.x, x1: best.x + best.w } : null);
  }
  let bestArea = 0, bestRect = null;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]) continue;
    let x0 = rows[i].x0, x1 = rows[i].x1;
    for (let j = i; j < rows.length; j++) {
      if (!rows[j]) break;
      x0 = Math.max(x0, rows[j].x0); x1 = Math.min(x1, rows[j].x1);
      if (x1 <= x0) break;
      const h = rows[j].y - rows[i].y + step, area = (x1 - x0) * h;
      if (area > bestArea) { bestArea = area; bestRect = { x: x0, y: rows[i].y, w: x1 - x0, h }; }
    }
  }
  if (!bestRect) return null;
  return inset(bestRect, 0.92); // letters should not kiss the outline
}

/** Row between ya and yb where the shape is narrowest (the waist of a joined bubble). */
export function waistRow(inside, bbox, ya, yb) {
  const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
  if (hi - lo < 6) return (lo + hi) / 2;
  const step = Math.max(1, Math.round((hi - lo) / 40));
  let best = (lo + hi) / 2, bestW = Infinity;
  for (let y = lo; y <= hi; y += step) {
    let w = 0;
    for (let x = bbox.x; x < bbox.x + bbox.w; x += step) if (inside(x, y)) w++;
    if (w < bestW) { bestW = w; best = y; }
  }
  return best;
}

/** Trim overlapping rectangles on the facing sides so no two texts share pixels. */
function separate(placements) {
  for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
    const a = placements[i].rect, b = placements[j].rect;
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix <= 0 || iy <= 0) continue;
    if (ix < iy) {
      if (a.x + a.w / 2 < b.x + b.w / 2) { a.w -= ix / 2; b.x += ix / 2; b.w -= ix / 2; } else { b.w -= ix / 2; a.x += ix / 2; a.w -= ix / 2; }
    } else {
      if (a.y + a.h / 2 < b.y + b.h / 2) { a.h -= iy / 2; b.y += iy / 2; b.h -= iy / 2; } else { b.h -= iy / 2; a.y += iy / 2; a.h -= iy / 2; }
    }
    a.w = Math.max(8, a.w); a.h = Math.max(8, a.h); b.w = Math.max(8, b.w); b.h = Math.max(8, b.h);
  }
}

/**
 * @typedef {object} Placement
 * @property {string} text
 * @property {string} size "small" | "normal" | "large" (the model's cue, relative to `letter`)
 * @property {{x:number,y:number,w:number,h:number}} rect area the text must fit in
 * @property {number} letter original glyph height here, the target font size
 * @property {string} color text colour
 * @property {boolean} halo draw with an outline (text sits on artwork)
 * @property {number|null} tag region id, if placed by region
 */
