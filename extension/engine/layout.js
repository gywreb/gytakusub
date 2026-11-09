// Where each translation goes. Pure geometry on the analysis — no drawing, no
// fonts — so the page side (which has the fonts) only has to fit text into
// rectangles. All coordinates are working-resolution pixels.
//
// A tagged item goes into its stamped region: the stamps are our own numbering
// drawn on the image, so a matching tag is evidence the model read the
// picture. The model's pixel box is the second witness: when it puts the text
// squarely inside a *different* region, the number was misread (a stamp sits
// at a corner and can land next to a neighbour's text) and the box decides.
// Inside a region, each translation is anchored to the lettering it replaces:
// it takes the largest rectangle of the shape around that lettering, never
// another speaker's line.

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
    const stamped = it.tag != null ? byId.get(it.tag) : null;
    let region = stamped;
    if (region && px) {
      const cx = px.x + px.w / 2, cy = px.y + px.h / 2;
      if (!inBox(region.box, cx, cy)) {
        // The box's centre lies outside the stamped region. Inside another
        // region's shape it names that one; otherwise the box merely drifted,
        // unless it is nowhere near and the text length does not fit either.
        const alt = holder(an, px, region);
        if (alt) region = alt;
        else {
          const off = boxOffset(region.box, px);
          const letters = region.kind === "bubble" ? region.ref.blocks.reduce((n, b) => n + b.glyphCount, 0) : region.ref.glyphCount;
          const ratio = it.text.length / Math.max(1, letters); // translation length vs lettering found (≈1 for a right match)
          if (off > 1 || (off > 0.5 && (ratio < 0.4 || ratio > 4))) region = null;
        }
      }
    }
    // A shape too narrow for the line (one letter per row) is not where it goes.
    if (region && region.kind === "bubble" && px && region.box.w < 3 * region.letter && it.text.length > 4) region = null;
    if (!region && px) region = nearestRegion(an, px);
    // A distrusted tag is overruled only by a box that points at some other region;
    // a box pointing nowhere (drifted off the shape, clipped at the page edge) is
    // weaker evidence than the stamp, so the stamp stands.
    if (!region && stamped && !(stamped.kind === "bubble" && stamped.box.w < 3 * stamped.letter && it.text.length > 4)) region = stamped;
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
      // Each speaker's translation is anchored to the lettering it replaces (the
      // detector's text block nearest its box; members without a box take the
      // remaining blocks in reading order) and keeps off the other speakers' lines.
      // The lettering to anchor to: the bubble's text blocks, minus specks (a row
      // of tone dots the detector read as a 4 px line next to the real text).
      const blocks = r.ref.blocks, biggest = Math.max(...blocks.map((b) => area(b.gbox)));
      const lettering = blocks.filter((b) => b.letter >= 0.5 * letter && area(b.gbox) >= 0.1 * biggest);
      const anchors = assignAnchors(lettering.length ? lettering : blocks, members, bbox, letter);
      const anchoredToLettering = anchors.map((a) => a.fromLettering === true);
      // Smaller regions lying within this shape are never written over: the
      // bubbles inside a light background that passed as a bubble, say.
      const foreign = an.regions.filter((q) => q.id !== id && area(q.box) < area(bbox) && overlap(q.box, bbox) >= 0.5 * area(q.box)).map((q) => grow(q.box, letter * 0.3));
      members.forEach((m, i) => {
        const a = anchors[i];
        // off limits: the other speakers' lettering, and everything past the cut
        // between the two (the waist of a joined bubble, else midway between them)
        const others = [...foreign];
        anchors.forEach((o, j) => { if (j !== i) others.push(grow(o, letter * 0.5), beyondCut(inside, bbox, a, o)); });
        const slack = Math.max(1.5 * letter, 0.15 * Math.min(bbox.w, bbox.h));
        let rect = inscribedRect(inside, bbox, { anchor: a, exclude: others, slack })
          || inscribedRect(inside, bbox, { exclude: others })
          || inscribedRect(inside, bbox)
          || inset(bbox, 0.78);
        // Invariant: the translation never gets less room than the lettering it
        // replaces — that area is erased and is, by definition, inside the bubble.
        // Whatever the shape analysis got wrong, the text cannot come out smaller
        // than the original for lack of space.
        if (anchoredToLettering[i]) rect = union([rect, clip(a, bbox)]);
        placements.push({ text: m.it.text, size: m.it.size, rect, letter, color, halo: false, tag: id, item: m.it.index ?? null });
      });
    } else {
      // Free text block: the translation takes the block's own footprint, with
      // a little room, and is drawn with a halo since it sits on artwork.
      const b = r.box, pad = letter * 0.5;
      let rect = clampRect({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, W, H);
      // Lettering set in a column or two: the translation runs in rows and needs
      // a width the column does not have. Widen it about its centre (to 0.6 of its
      // height) as far as the other regions and the page allow.
      if (r.ref.vertical && rect.h > 1.7 * rect.w) {
        const others = an.regions.filter((q) => q.id !== id).map((q) => q.box);
        for (const f of [1, 0.75, 0.5, 0.25]) {
          const w = rect.w + (0.6 * rect.h - rect.w) * f, cand = clampRect({ x: rect.x + rect.w / 2 - w / 2, y: rect.y, w, h: rect.h }, W, H);
          if (!others.some((o) => overlap(o, cand) > 0.05 * Math.min(area(o), area(cand)))) { rect = cand; break; }
        }
      }
      const text = members.map((m) => m.it.text).join(" ");
      placements.push({ text, size: members[0].it.size, rect, letter, color: r.dark ? "#fff" : "#000", halo: true, tag: id, item: members.length === 1 ? members[0].it.index ?? null : null });
    }
  }
  for (const { it, px } of loose) {
    placements.push({ text: it.text, size: it.size, rect: clampRect(px, W, H), letter: an.letter, color: "#000", halo: true, tag: null, item: it.index ?? null });
  }

  separate(placements);
  return { placements, regionIds: new Set(groups.keys()) };
}

const union = (bs) => { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)); return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 }; };
const clip = (b, to) => { const x0 = Math.max(b.x, to.x), y0 = Math.max(b.y, to.y), x1 = Math.min(b.x + b.w, to.x + to.w), y1 = Math.min(b.y + b.h, to.y + to.h); return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : b; };
const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const grow = (b, k) => ({ x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k });
const area = (b) => b.w * b.h;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Whether the region's shape (its interior for a bubble, its box otherwise) holds the point. */
function shapeHolds(an, r, x, y) {
  if (!inBox(r.box, x, y)) return false;
  const inside = r.kind === "bubble" ? an.insideOf(r.id) : null;
  return inside ? inside(x, y) : true;
}

/** Whether a region is big enough to hold the text the model boxed (a speck of a region never is). */
const canHold = (r, px) => area(r.box) >= 0.25 * area(px);

/** The smallest region other than `not` whose shape holds the box's centre, if any. */
function holder(an, px, not) {
  const cx = px.x + px.w / 2, cy = px.y + px.h / 2;
  let best = null;
  for (const r of an.regions) if (r !== not && canHold(r, px) && shapeHolds(an, r, cx, cy) && (!best || area(r.box) < area(best.box))) best = r;
  return best;
}

/** How far the box's centre lies outside the region's box, in units of the region's size (0 = inside). */
function boxOffset(rb, px) {
  const cx = px.x + px.w / 2, cy = px.y + px.h / 2;
  return Math.max(Math.max(rb.x - cx, cx - (rb.x + rb.w), 0) / Math.max(1, rb.w), Math.max(rb.y - cy, cy - (rb.y + rb.h), 0) / Math.max(1, rb.h));
}

/** The region an untagged box belongs to: most overlap, holding the centre; the smaller region on a tie (a bubble inside a background's box). */
function nearestRegion(an, px) {
  const cx = px.x + px.w / 2, cy = px.y + px.h / 2;
  let best = null, bestScore = 0;
  for (const r of an.regions) {
    if (!canHold(r, px)) continue;
    const score = overlap(px, r.box) / Math.max(1, area(px)) + (shapeHolds(an, r, cx, cy) ? 0.5 : 0);
    if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && best && area(r.box) < area(best.box))) { bestScore = score; best = r; }
  }
  return bestScore >= 0.5 ? best : null;
}

/**
 * One anchor rectangle per member: the lettering it replaces. A lone member
 * takes all of the bubble's lettering. Otherwise members with a box take the
 * block their box overlaps most (any overlap); the rest take the unclaimed
 * blocks in reading order; beyond that, the member's own box inside the
 * bubble, else a point at the bubble's centre.
 */
function assignAnchors(blocks, members, bbox, letter) {
  if (members.length === 1 && blocks.length) return [{ ...union(blocks.map((b) => b.gbox)), fromLettering: true }];
  const free = blocks.map((b) => ({ ...b.gbox, fromLettering: true })).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const anchors = new Array(members.length).fill(null);
  // boxes first, best overlap first, so two members never claim one block
  const claims = [];
  members.forEach((m, i) => { if (m.px) for (const g of free) { const o = overlap(m.px, g); if (o > 0) claims.push({ i, g, o: o / Math.min(area(m.px), area(g)) }); } });
  claims.sort((a, b) => b.o - a.o);
  for (const c of claims) if (!anchors[c.i] && free.includes(c.g)) { anchors[c.i] = c.g; free.splice(free.indexOf(c.g), 1); }
  members.forEach((m, i) => { if (!anchors[i] && free.length) anchors[i] = free.shift(); });
  members.forEach((m, i) => {
    if (anchors[i]) return;
    const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
    anchors[i] = m.px && inBox(bbox, m.px.x + m.px.w / 2, m.px.y + m.px.h / 2) ? m.px : { x: cx - letter, y: cy - letter, w: 2 * letter, h: 2 * letter };
  });
  return anchors;
}

/**
 * The part of the bubble that belongs to the speaker at `other` rather than at
 * `mine`: everything past the cut between the two anchors. Stacked anchors are
 * cut by a row, side-by-side ones by a column. The cut runs through the shape's
 * waist between the two when there is one (a joined bubble: the shape is
 * clearly narrower there than beside either anchor), otherwise midway between
 * the anchors' facing edges.
 */
export function beyondCut(inside, bbox, mine, other) {
  const mc = { x: mine.x + mine.w / 2, y: mine.y + mine.h / 2 }, oc = { x: other.x + other.w / 2, y: other.y + other.h / 2 };
  const vertical = Math.abs(oc.y - mc.y) >= Math.abs(oc.x - mc.x);
  const big = { x: bbox.x - 1, y: bbox.y - 1, w: bbox.w + 2, h: bbox.h + 2 };
  if (vertical) {
    const below = oc.y > mc.y;
    const lo = below ? mine.y + mine.h : other.y + other.h, hi = below ? other.y : mine.y;
    const pos = waist(inside, bbox, lo, hi, true) ?? (mc.y + oc.y) / 2;
    return below ? { ...big, y: pos, h: big.y + big.h - pos } : { ...big, h: pos - big.y };
  }
  const right = oc.x > mc.x;
  const lo = right ? mine.x + mine.w : other.x + other.w, hi = right ? other.x : mine.x;
  const pos = waist(inside, bbox, lo, hi, false) ?? (mc.x + oc.x) / 2;
  return right ? { ...big, x: pos, w: big.x + big.w - pos } : { ...big, w: pos - big.x };
}

/** Row (or column) between lo and hi where the shape is clearly narrowest — a joined bubble's waist — or null when there is none. */
export function waist(inside, bbox, lo, hi, rows) {
  if (hi - lo < 6) return null;
  const step = Math.max(1, Math.round((hi - lo) / 40)), cross = Math.max(1, Math.round((rows ? bbox.w : bbox.h) / 80));
  const width = (p) => { let n = 0; if (rows) { for (let x = bbox.x; x < bbox.x + bbox.w; x += cross) if (inside(x, p)) n++; } else { for (let y = bbox.y; y < bbox.y + bbox.h; y += cross) if (inside(p, y)) n++; } return n; };
  let best = null, bestW = Infinity;
  for (let p = lo; p <= hi; p += step) { const w = width(p); if (w < bestW) { bestW = w; best = p; } }
  const ends = Math.min(width(lo), width(hi));
  return ends > 0 && bestW < 0.8 * ends ? best : null;
}

function inset(b, k) { return { x: b.x + b.w * (1 - k) / 2, y: b.y + b.h * (1 - k) / 2, w: b.w * k, h: b.h * k }; }
function clampRect(r, W, H) {
  const x = clamp(r.x, 0, W - 1), y = clamp(r.y, 0, H - 1);
  return { x, y, w: clamp(r.w, 4, W - x), h: clamp(r.h, 4, H - y) };
}

/**
 * Largest axis-aligned rectangle inside a pixel mask (rows sampled at `step`).
 * With `anchor`, the rectangle must contain the anchor's centre (each row's run
 * is the one through that x; the rows must span its y) and be centred within
 * the anchor's own extent — or `slack` pixels of its centre, if that is more —
 * so the text drawn in it stays where the lettering it replaces was, instead
 * of drifting to wherever the shape has the most room. `exclude` rectangles
 * count as outside the mask.
 * @param {(x:number,y:number)=>boolean} inside
 * @param {{x:number,y:number,w:number,h:number}} bbox
 * @param {{anchor?:object, exclude?:object[], slack?:number}} [opts]
 */
export function inscribedRect(inside, bbox, opts = {}) {
  if (!inside) return null;
  const { anchor = null, exclude = [], slack = 0 } = opts;
  const ax = anchor ? anchor.x + anchor.w / 2 : null, ay = anchor ? anchor.y + anchor.h / 2 : null;
  if (anchor && !inBox(bbox, ax, ay)) return null;
  const tx = anchor ? Math.max(anchor.w / 2, slack) : 0, ty = anchor ? Math.max(anchor.h / 2, slack) : 0;
  // the largest sub-rectangle of [x0,x1]×[y0,y1] whose centre lies within the tolerance of the anchor
  const centred = (x0, x1, y0, y1) => {
    if (!anchor) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const cx = clamp((x0 + x1) / 2, ax - tx, ax + tx), cy = clamp((y0 + y1) / 2, ay - ty, ay + ty);
    const hw = Math.min(cx - x0, x1 - cx), hh = Math.min(cy - y0, y1 - cy);
    return { x: cx - hw, y: cy - hh, w: 2 * hw, h: 2 * hh };
  };
  const step = Math.max(1, Math.round(Math.min(bbox.w, bbox.h) / 60));
  const ok = (x, y) => inside(x, y) && !exclude.some((e) => inBox(e, x, y));
  const rows = [];
  for (let y = Math.ceil(bbox.y); y < bbox.y + bbox.h; y += step) {
    let best = null;
    if (anchor) {
      // the run through the anchor's column
      if (ok(ax, y)) {
        let x0 = ax, x1 = ax;
        while (x0 - step >= bbox.x && ok(x0 - step, y)) x0 -= step;
        while (x1 + step <= bbox.x + bbox.w && ok(x1 + step, y)) x1 += step;
        best = { x0, x1: x1 + step };
      }
    } else {
      let runStart = null;
      for (let x = bbox.x; x <= bbox.x + bbox.w; x += step) {
        const inn = x < bbox.x + bbox.w && ok(x, y);
        if (inn && runStart === null) runStart = x;
        if (!inn && runStart !== null) { if (!best || x - runStart > best.x1 - best.x0) best = { x0: runStart, x1: x }; runStart = null; }
      }
      if (runStart !== null) { const end = bbox.x + bbox.w; if (!best || end - runStart > best.x1 - best.x0) best = { x0: runStart, x1: end }; }
    }
    rows.push(best ? { y, ...best } : null);
  }
  let bestArea = 0, bestRect = null;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]) continue;
    if (anchor && rows[i].y > ay) break;
    let x0 = rows[i].x0, x1 = rows[i].x1;
    for (let j = i; j < rows.length; j++) {
      if (!rows[j]) break;
      x0 = Math.max(x0, rows[j].x0); x1 = Math.min(x1, rows[j].x1);
      if (x1 <= x0) break;
      if (anchor && rows[j].y + step <= ay) continue; // does not reach the anchor's row yet
      const cand = centred(x0, x1, rows[i].y, rows[j].y + step), a = cand.w * cand.h;
      if (a > bestArea) { bestArea = a; bestRect = cand; }
    }
  }
  if (!bestRect) return null;
  return inset(bestRect, 0.92); // letters should not kiss the outline
}

/** Trim overlapping rectangles on the facing sides so no two texts share pixels. */
function separate(placements) {
  for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
    const a = placements[i].rect, b = placements[j].rect;
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix <= 0 || iy <= 0) continue;
    const dx = ix / 2 + 0.5, dy = iy / 2 + 0.5; // half each, plus a pixel of air
    if (ix < iy) {
      if (a.x + a.w / 2 < b.x + b.w / 2) { a.w -= dx; b.x += dx; b.w -= dx; } else { b.w -= dx; a.x += dx; a.w -= dx; }
    } else {
      if (a.y + a.h / 2 < b.y + b.h / 2) { a.h -= dy; b.y += dy; b.h -= dy; } else { b.h -= dy; a.y += dy; a.h -= dy; }
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
 * @property {number|null} item index into the page's items (null when several items were merged)
 */
