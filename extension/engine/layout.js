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
//
// The box is also the second witness for free text: lettering the analysis
// found but set aside (too small or too large for dialogue, strokes it took for
// art, a line it dropped) becomes text to erase when a translated line's box
// holds it — the two together are evidence neither is alone (adoptLettering).

import { LAYOUT } from "./tuning.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Whether a translation says anything in words or numbers (not only punctuation and symbols). */
export const said = (text) => /[\p{L}\p{N}]/u.test(text);
/** A line to translate and draw: it says something, and Claude did not give it back as it is drawn
 * (`same`, prompt.js checkCopies): those stay as drawn, like a line of only punctuation. */
export const tells = (it) => said(it.text) && !it.same;

/**
 * @param {import("./analyze.js").Analysis} an (adoptLettering may add regions to it, or widen its free-text regions)
 * @param {Array<{tag:(number|null), box:(number[]|null), text:string, size:string, kind:string}>} items normalized items (box as fractions of the page)
 * @param {{newId?: () => number, readerBoxes?: boolean}} [opts] newId: ids for regions made from adopted lettering
 *   (unique on the page; by default above the analysis's own). readerBoxes: a translated line whose box
 *   holds no lettering the analysis found has that box erased too, as a region of its own (adoptLettering),
 *   and a region's lines that Claude says aren't in a bubble give it their boxes (`readerBoxes`), where the
 *   mask also looks: only when the eraser has the learned text mask, which finds the lettering's pixels there
 * @returns {{placements: Placement[], regionIds: Set<number>}}
 */
export function layout(an, items, opts = {}) {
  const { W, H } = an;
  // A line with nothing to translate (only "…", "!", "?!", "♪") is left as drawn: no letter or
  // digit in the translation means the original reads the same in any language, and erasing it
  // only to draw it again loses the letterer's marks (dots too small to be found came out doubled).
  // It still takes its place among a bubble's lines, so the others keep off its lettering, which
  // the eraser then leaves (region.kept); a region given nothing else is not erased at all.
  adoptLettering(an, items.filter((it) => !it.text || tells(it)), opts.newId, !!opts.readerBoxes);
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
        // (only a box mostly on that region and little on the stamped one: a box between two
        // regions — loose, as the model's boxes often are around free text — is no evidence)
        const alt = holder(an, px, region);
        if (alt && overlap(px, alt.box) >= LAYOUT.most * area(px) && overlap(px, region.box) < LAYOUT.strayOnStamp * area(px)) region = alt;
        else if (!alt) {
          const off = boxOffset(region.box, px);
          const letters = region.kind === "bubble" ? region.ref.blocks.reduce((n, b) => n + b.glyphCount, 0) : region.ref.glyphCount;
          const ratio = it.text.length / Math.max(1, letters); // translation length vs lettering found (≈1 for a right match)
          if (off > LAYOUT.driftFar || (off > LAYOUT.driftNear && (ratio < LAYOUT.lengthLow || ratio > LAYOUT.lengthHigh))) region = null;
        }
      }
    }
    // A shape too narrow for the line (one letter per row) is not where it goes.
    if (region && region.kind === "bubble" && px && region.box.w < LAYOUT.narrowLetters * region.letter && it.text.length > LAYOUT.narrowChars) region = null;
    if (!region && px) region = nearestRegion(an, px);
    // A distrusted tag is overruled only by a box that points at some other region;
    // a box pointing nowhere (drifted off the shape, clipped at the page edge) is
    // weaker evidence than the stamp, so the stamp stands.
    if (!region && stamped && !(stamped.kind === "bubble" && stamped.box.w < LAYOUT.narrowLetters * stamped.letter && it.text.length > LAYOUT.narrowChars)) region = stamped;
    if (region) (groups.get(region.id) || groups.set(region.id, []).get(region.id)).push({ it, px });
    else if (px) loose.push({ it, px });
  }
  shareStamp(an, groups);
  for (const [id, members] of groups) if (!members.some((m) => tells(m.it))) groups.delete(id);
  // With the learned text mask (4.0 step 2, 3.6): the boxes of the lines Claude placed in a region and
  // says aren't in a speech bubble (free text, a sign, narration). The mask also looks across them
  // (textmask.js textCrops) and the eraser takes what it finds there, mostly inside a box (erase.js):
  // Claude's box holds a whole paragraph where the detector may have found only some of its lines.
  for (const r of an.regions) delete r.readerBoxes;
  if (opts.readerBoxes) for (const [id, members] of groups) {
    const boxes = members.filter((m) => tells(m.it) && m.px && m.it.kind !== "bubble").map((m) => clampRect(m.px, W, H));
    if (boxes.length) byId.get(id).readerBoxes = boxes;
  }
  // Lettering a translated line's box holds that no line of its own names is part of that line:
  // Claude read it there, and what Claude reads is erased (ADR 0015). The detector often splits one
  // line of large lettering into two regions (a title and its reading, a column each), and the
  // region no line was tagged with stayed on the page beside the translation (2.14.2; measured on
  // researcher-marked pages, docs/QUALITY.md). Free text only (a bubble's lettering is its own
  // region's), at least half of it under the box, and never a region any line names (a sound
  // effect or a line left as drawn included). Erased only: the translation keeps its own region's
  // room (lettering claimed across a page of notes made one wide strip of tiny text).
  const named = new Set(items.map((it) => it.tag).filter((t) => t != null));
  const claimed = new Map(); // region id → the region whose line holds it
  for (const [id, members] of groups) for (const m of members) {
    if (!tells(m.it) || !m.px) continue;
    for (const q of an.regions) {
      if (q.kind === "bubble" || groups.has(q.id) || named.has(q.id) || claimed.has(q.id)) continue;
      if (overlap(q.box, m.px) >= LAYOUT.most * area(q.box)) claimed.set(q.id, id);
    }
  }

  const placements = [];
  for (const [id, members] of groups) {
    const r = byId.get(id);
    const letter = members.some((m) => tells(m.it) && hangul(m.it.source)) ? hangulLetter(r) : r.letter;
    const color = r.dark ? "#fff" : "#000";
    if (r.kind === "bubble") {
      const inside = an.insideOf(id), bbox = r.box;
      // Each speaker's translation is anchored to the lettering it replaces (the
      // detector's text block nearest its box; members without a box take the
      // remaining blocks in reading order) and keeps off the other speakers' lines.
      // The lettering to anchor to: the bubble's text blocks, minus specks (a row
      // of tone dots the detector read as a 4 px line next to the real text).
      const blocks = r.ref.blocks, biggest = Math.max(...blocks.map((b) => area(b.gbox)));
      let lettering = blocks.filter((b) => b.letter >= LAYOUT.anchorLetter * letter && area(b.gbox) >= LAYOUT.anchorArea * biggest);
      if (!lettering.length) lettering = blocks;
      // A line left as drawn keeps the block of lettering its box lies on (the largest share of
      // a block under the box), else the block nearest it within a letter, else its own box in the
      // bubble; the lines to draw are anchored among the rest, and keep off it. Any of the
      // bubble's blocks: a short "Ah..." is often one too small to anchor a translation to, and
      // Claude's box for it can miss it by a few pixels; it was erased, its lobe left empty (2.14.1).
      const kept = [], taken = new Set();
      for (const m of members) {
        if (tells(m.it) || !m.px) continue;
        const free = blocks.filter((b) => !taken.has(b));
        let best = null, most = 0;
        for (const b of free) { const o = overlap(m.px, b.gbox) / Math.max(1, area(b.gbox)); if (o > most) { most = o; best = b; } }
        if (!best) { let near = letter; for (const b of free) { const g = gap(m.px, b.gbox); if (g <= near) { near = g; best = b; } } }
        if (best) { taken.add(best); kept.push({ ...best.gbox }); lettering = lettering.filter((b) => b !== best); }
        else if (inBox(bbox, m.px.x + m.px.w / 2, m.px.y + m.px.h / 2)) kept.push(clip(m.px, bbox));
      }
      const told = members.filter((m) => tells(m.it));
      const anchors = lettering.length ? assignAnchors(lettering, told, bbox, letter) : told.map((m) => (m.px && inBox(bbox, m.px.x + m.px.w / 2, m.px.y + m.px.h / 2) ? m.px : { x: bbox.x + bbox.w / 2 - letter, y: bbox.y + bbox.h / 2 - letter, w: 2 * letter, h: 2 * letter }));
      const anchoredToLettering = anchors.map((a) => a.fromLettering === true);
      // Smaller regions lying within this shape are never written over: the
      // bubbles inside a light background that passed as a bubble, say.
      const foreign = an.regions.filter((q) => q.id !== id && area(q.box) < area(bbox) && overlap(q.box, bbox) >= LAYOUT.most * area(q.box)).map((q) => grow(q.box, letter * LAYOUT.keepClear));
      // The room: the bubble's interior, and the lettering a line replaces (erased) where it lies in
      // a hole of the interior — never past the outline. An interior from light regions has holes
      // where the lettering was; a box around that lettering reaches past a slanted or curved side at
      // its corners, and the translation set to the box crossed the outline (2.15: the owner's
      // French chapter). A hole is what the interior encloses, not merely what lies between its two
      // sides on a row: between a burst's spikes, or in a cloud's notch, is outside.
      const inHole = inside ? holesOf(inside, bbox) : () => false;
      // Lettering the interior does not hold (a box mostly past it) says the shape is wrong for it: a
      // patch of light art taken for a bubble around text drawn over the art. Its room keeps the
      // lettering's boxes whole, as before 2.15, so the text is never set smaller than it was drawn.
      const held = (boxes) => {
        let n = 0, k = 0;
        for (const b of boxes) for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const x = b.x + (i + 0.5) * b.w / 8, y = b.y + (j + 0.5) * b.h / 8; n++; if (inside(x, y) || inHole(x, y)) k++; }
        return n ? k / n : 1;
      };
      const owns = told.map((m, i) => (!anchoredToLettering[i] ? [] : anchors[i].parts || lettering.filter((b) => overlap(b.gbox, anchors[i]) >= LAYOUT.most * area(b.gbox)).map((b) => b.gbox)));
      const parts = inside ? roomParts(an, r, inside, inHole, bbox, anchors, owns) : null;
      const othersPart = anchors.length > 1 ? parts?.othersPart : null;
      // (judged on the lettering's lines: a block's upright box reaches past a slanted bubble's side
      // at its corners, and such bubbles were doubted, their text set across the slant)
      const linesOf = (i) => (!anchoredToLettering[i] ? [] : anchors[i].parts || lettering.filter((b) => overlap(b.gbox, anchors[i]) >= LAYOUT.most * area(b.gbox)).flatMap((b) => b.parts || [b.gbox]));
      const doubted = (i) => !!inside && held(linesOf(i)) < LAYOUT.letteringHeld;
      const roomOf = (own, i) => !inside ? inside : doubted(i)
        ? (x, y) => inside(x, y) || own.some((b) => inBox(b, x, y))
        : (x, y) => (inside(x, y) || (own.some((b) => inBox(b, x, y)) && inHole(x, y))) && !othersPart?.(i, x, y);
      // the room as far as the bubble's ink bounds it, with no margin: the bubble model's mask is
      // smooth, and reaches past a burst's or a narrow bubble's outline. text.js takes the box's fit
      // only when its letters stay inside this (2.15: such fits crossed bursts' outlines).
      const boundOf = (room, i) => (parts && room ? (x, y) => room(x, y) && parts.within(i, x, y) : null);
      told.forEach((m, i) => {
        const a = anchors[i], own = owns[i];
        const room = roomOf(own, i);
        // off limits: the other speakers' lettering, and everything past the cut
        // between the two (the waist of a joined bubble, else midway between them),
        // and lettering left as drawn
        const others = [...foreign, ...kept.map((k) => grow(k, letter * LAYOUT.keepClear))];
        anchors.forEach((o, j) => { if (j !== i) others.push(grow(o, letter * LAYOUT.speakerClear), beyondCut(inside, bbox, a, o)); });
        const slack = Math.max(LAYOUT.slackLetters * letter, LAYOUT.slackShare * Math.min(bbox.w, bbox.h));
        let rect = inscribedRect(room, bbox, { anchor: a, exclude: others, slack })
          || inscribedRect(room, bbox, { exclude: others })
          || inscribedRect(room, bbox)
          || inset(bbox, LAYOUT.fallbackInset);
        // The text is centred on the lettering it replaces and never gets less room than it had: the
        // box is the rectangle and that lettering's box together. Its corners may lie past a curved
        // or slanted side, so in a bubble text.js sets the text to the shape below, and to the box
        // only where the box's lines stay in the room (2.15: past it, they crossed the outline).
        if (anchoredToLettering[i]) rect = union([rect, clip(a, bbox)]);
        // The room row by row, for text.js to set each line as wide as the bubble is there: a
        // rectangle in an oval leaves its widest rows unused, and the text came out small (2.14.1).
        // Its margin is kept off the outline's ink where the ink is known: the bubble model's mask
        // is smooth and reaches onto, or past, the outline, and lines set to the mask's edge touched
        // caption borders and a burst's spikes (2.15, the owner's French chapter, pages 6 and 9).
        // A doubted room (light art taken for a bubble) is its lettering's boxes, and the ink around
        // them is the art's, not an outline: the text is set to the box, as before 2.15. Read as an
        // outline, art lines crossing the room set text over art at half its size (generated pages).
        const edge = Math.max(LAYOUT.edgeMinPx, LAYOUT.edgeLetters * letter), art = doubted(i);
        const inked = art ? null : boundOf(room, i), bound = inked && roomShape(inked, bbox, rect, [], others, 0);
        const shape = art ? null : roomShape(inked || room, bbox, rect, [], others, edge);
        // The same room centred on the lettering itself: where the box above is far wider than the
        // lettering and off its centre (the wide middle of an L-shaped caption), the room on both sides
        // of the box's centre was narrow where the lettering stood, and the text came out ragged and
        // small (2.15, the owner's French chapter, page 6). text.js sets the text in whichever fits it larger.
        const mine = anchoredToLettering[i] ? clip(a, bbox) : null;
        const alt = !art && mine && (Math.abs(mine.x + mine.w / 2 - (rect.x + rect.w / 2)) > LAYOUT.altOffset * letter || Math.abs(mine.y + mine.h / 2 - (rect.y + rect.h / 2)) > LAYOUT.altOffset * letter) ? roomShape(inked || room, bbox, mine, [], others, edge) : null;
        const altBound = alt && inked ? roomShape(inked, bbox, mine, [], others, 0) : null;
        // The same room around its own centre line: lettering off its bubble's middle (or a box
        // drawn around it) put the text's centre line off the room's, and the room on both sides of
        // that line was narrow on one side; text centred in the bubble fitted larger (3.0, generated
        // pages: lines in clouds and slanted bubbles set under 0.7 of their size that the bubble held).
        const axisRect = shape && Math.abs(shape.axis - shape.cx) > LAYOUT.axisOffset * letter ? { ...rect, x: shape.axis - rect.w / 2 } : null;
        const centred = axisRect ? roomShape(inked || room, bbox, axisRect, [], others, edge) : null;
        const centredBound = centred && inked ? roomShape(inked, bbox, axisRect, [], others, 0) : null;
        const alts = [...(alt ? [{ rect: mine, shape: alt, ...(altBound ? { bound: altBound } : {}) }] : []), ...(centred ? [{ rect: axisRect, shape: centred, ...(centredBound ? { bound: centredBound } : {}) }] : [])];
        placements.push({ text: m.it.text, size: m.it.size, rect, letter, measured: true, color, halo: false, tag: id, item: m.it.index ?? null, ...(shape ? { shape } : {}), ...(bound ? { bound } : {}), ...(alts.length ? { alt: alts } : {}) });
      });
      r.kept = kept.length ? kept : null;
    } else {
      // Free text block: the translation takes the block's own footprint, with
      // a little room, and is drawn with a halo since it sits on artwork.
      const b = r.box, pad = letter * LAYOUT.freePad;
      let rect = clampRect({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, W, H);
      // Lettering set in a column or two: the translation runs in rows and needs
      // a width the column does not have. Widen it about its centre (to 0.6 of its
      // height) as far as the other regions and the page allow.
      if (r.ref.vertical && rect.h > LAYOUT.columnTall * rect.w) {
        const others = an.regions.filter((q) => q.id !== id).map((q) => q.box);
        for (const f of LAYOUT.widenTries) {
          const w = rect.w + (LAYOUT.columnWidth * rect.h - rect.w) * f, cand = clampRect({ x: rect.x + rect.w / 2 - w / 2, y: rect.y, w, h: rect.h }, W, H);
          if (!others.some((o) => overlap(o, cand) > LAYOUT.widenClash * Math.min(area(o), area(cand)))) { rect = cand; break; }
        }
      }
      const told = members.filter((m) => tells(m.it));
      const text = told.map((m) => m.it.text).join(" ");
      placements.push({ text, size: told[0].it.size, rect, letter, measured: true, color: r.dark ? "#fff" : "#000", halo: true, tag: id, item: told.length === 1 ? told[0].it.index ?? null : null });
    }
  }
  for (const { it, px } of loose) {
    if (!tells(it)) continue;
    placements.push({ text: it.text, size: it.size, rect: clampRect(px, W, H), letter: an.letter, color: "#000", halo: true, tag: null, item: it.index ?? null });
  }

  separate(placements);
  // Regions made from a translated line's box alone (adoptLettering) are erased only: the line is
  // placed as it was without them (its box, or the region nearest it), and no line is drawn into them.
  const fromBoxes = an.fromBoxes || [];
  delete an.fromBoxes;
  an.regions.push(...fromBoxes);
  return { placements, regionIds: new Set([...groups.keys(), ...claimed.keys(), ...fromBoxes.map((r) => r.id)]) };
}

const union = (bs) => { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)); return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 }; };
const clip = (b, to) => { const x0 = Math.max(b.x, to.x), y0 = Math.max(b.y, to.y), x1 = Math.min(b.x + b.w, to.x + to.w), y1 = Math.min(b.y + b.h, to.y + to.h); return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : b; };
const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const grow = (b, k) => ({ x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k });
const area = (b) => b.w * b.h;
/**
 * The room a bubble gives one line of translation, row by row: how far the bubble's interior
 * (or the lettering the line replaces, erased) reaches on both sides of the text box's centre
 * line, short of the parts kept for others (`exclude`: other speakers' lettering and the cut
 * between them, lines left as drawn). Text centred on that line stays inside. `{dy, step, half}`:
 * rows from rect.y + dy, one every `step` px, half[k] the half-width there (0: none). Its centre
 * line and top are kept too (`cx`, `top`): separate() trims the placements' rects afterwards, and
 * text centred on a trimmed rect sat off its room by up to 8 px, against a caption's border (2.15,
 * page 6 in the owner's browser). null without the bubble's shape, or when the centre line is out.
 *
 * The margin (`edge` px) is kept in every direction: the room is eroded by it, so a line keeps it
 * from the outline above and below as well as beside. A row's half-width is the narrowest over all
 * the pixel rows it spans, not the width at its middle. (3.0: the margin was taken off the sides
 * only and the width read once per row, so a line near a bubble's top or bottom curve, or at its
 * steep sides, came within a pixel of the outline; set a fraction of a pixel larger, many touched.)
 */
export function roomShape(inside, bbox, rect, own, exclude, edge = 0) {
  if (!inside) return null;
  const cx = rect.x + rect.w / 2;
  const ok = (x, y) => (inside(x, y) || own.some((b) => inBox(b, x, y))) && !exclude.some((e) => inBox(e, x, y));
  const step = Math.max(1, Math.round(Math.min(bbox.w, bbox.h) / LAYOUT.shapeRows));
  const gx0 = Math.floor(bbox.x), gy0 = Math.floor(bbox.y), gw = Math.ceil(bbox.x + bbox.w) - gx0, gh = Math.ceil(bbox.y + bbox.h) - gy0;
  if (!(gw > 0 && gh > 0)) return null;
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) grid[y * gw + x] = ok(gx0 + x + 0.5, gy0 + y + 0.5) ? 1 : 0;
  const room = edge > 0 ? erode(grid, gw, gh, edge) : grid;
  const at = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && room[y * gw + x] === 1;
  const col = Math.floor(cx) - gx0, frac = cx - Math.floor(cx);
  // per row: the room left and right of the centre line over every pixel row it spans (`left`,
  // `right`), and the nearer of the two (`half`)
  const half = [], left = [], right = [], mids = [];
  for (let y = gy0; y < bbox.y + bbox.h; y += step) {
    let h = Infinity, lo = Infinity, hi = Infinity, mid = null;
    for (let r = y - gy0; r < y - gy0 + step && r < gh; r++) {
      if (!at(col, r)) { h = lo = hi = 0; break; }
      let l = 0, rr = 0;
      while (at(col - l - 1, r)) l++;
      while (at(col + rr + 1, r)) rr++;
      if (frac + l < h || 1 - frac + rr < h) mid = gx0 + col + (1 + rr - l) / 2; // the run's own middle
      h = Math.min(h, frac + l, 1 - frac + rr); lo = Math.min(lo, frac + l); hi = Math.min(hi, 1 - frac + rr);
    }
    const f = (v) => (v === Infinity ? 0 : Math.max(0, Math.floor(v)));
    half.push(f(h)); left.push(f(lo)); right.push(f(hi));
    mids.push(h > 0 && h !== Infinity ? mid : null);
  }
  let a = 0, b = half.length;
  while (a < b && !half[a]) a++;
  while (b > a && !half[b - 1]) b--;
  if (a >= b) return null;
  // the room's own centre line: the middle of its rows' runs (the median), where text centred in
  // the bubble would stand
  const ms = mids.slice(a, b).filter((m) => m != null).sort((p, q) => p - q);
  return { dy: gy0 + a * step - rect.y, step, half: half.slice(a, b), left: left.slice(a, b), right: right.slice(a, b), edge, cx, top: gy0 + a * step, axis: ms.length ? ms[ms.length >> 1] : cx };
}

/**
 * A room grid (1: room) less every cell closer than `r` px to anything else, the grid's border included:
 * an exact Euclidean distance transform (Felzenszwalb and Huttenlocher), rows then columns.
 */
export function erode(grid, w, h, r) {
  const INF = 1e12, d = new Float64Array(w * h), f = new Float64Array(Math.max(w, h) + 2), out = new Float64Array(Math.max(w, h) + 2);
  const v = new Int32Array(Math.max(w, h) + 2), z = new Float64Array(Math.max(w, h) + 3);
  // squared distance along a line to the nearest zero, with zeros just past both ends
  const pass = (n) => {
    // f[0] and f[n+1] are the zeros past the ends
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q <= n + 1; q++) {
      let s;
      for (;;) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k]) k--; else break; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 1; q <= n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let y = 0; y < h; y++) {
    f[0] = 0; f[w + 1] = 0;
    for (let x = 0; x < w; x++) f[x + 1] = grid[y * w + x] ? INF : 0;
    pass(w);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x + 1];
  }
  for (let x = 0; x < w; x++) {
    f[0] = 0; f[h + 1] = 0;
    for (let y = 0; y < h; y++) f[y + 1] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y + 1];
  }
  // a cell's edge at least r px from the nearest other cell's: centres r + 1 apart
  const keep = new Uint8Array(w * h), r2 = (r + 1) * (r + 1);
  for (let q = 0; q < w * h; q++) keep[q] = grid[q] && d[q] >= r2 - 1e-9 ? 1 : 0;
  return keep;
}

/** How far apart two boxes are (0 when they touch or overlap). */
const gap = (a, b) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

// (LAYOUT.adoptMaxLetter, tuning.js: a shout runs to three or four times the dialogue size; a drawn sound effect beyond)

/**
 * Lettering the analysis set aside, which a translated line's box vouches for. The analysis drops
 * a paragraph it cannot be sure is text — dialogue-sized marks only, no stroke spanning the line,
 * not a closed shape read as a glyph — and a detector line with no lettering contrast in grey (a
 * coloured line); each guard keeps art from being erased on a guess. When Claude's box for a line
 * it translated holds such lettering, the two witnesses agree, and the lettering becomes text to
 * erase: added to the free-text region the line was tagged to (the rest of a title the detector
 * cut in two), or as a region of its own for an untagged line (text the analysis never offered).
 * A line in a bubble takes nothing: a bubble's lettering is its own, and a loose box around it
 * must not reach the narration beside it. Lettering over LAYOUT.adoptMaxLetter times the dialogue size
 * (a sound effect drawn as art, which Claude is asked to leave alone) is never taken.
 * With `readerBoxes` (the eraser has the learned text mask, 4.0), an untagged line whose box holds
 * none of it, nor any region's, becomes a region of its own all the same, the box standing for its
 * lettering (`fromBox`): the detector found nothing there, but Claude read a line there, and the
 * mask is a witness of its own that finds which pixels are lettering. The eraser takes only what
 * the mask finds in such a region, never its rules (erase.js): on busy art the rules would take any
 * stroke in the box for lettering. Such a region is erased only, set aside in `an.fromBoxes` until
 * the lines are placed (layout): the line is placed as it would be without it.
 * Adds to `an.regions` (and widens free-text regions there) in place.
 */
export function adoptLettering(an, items, newId, readerBoxes = false) {
  const { W, H } = an;
  if (!an.blocks || !items.some((it) => it.text && it.box)) return;
  const byId = new Map(an.regions.map((r) => [r.id, r]));
  let next = Math.max(0, ...an.regions.map((r) => r.id)) + 1;
  const fresh = newId || (() => next++);
  const held = (b) => an.regions.some((r) => overlap(r.box, b) > LAYOUT.most * area(b)); // already some region's
  const fromBoxes = (an.fromBoxes = []); // regions made from a line's box alone: erased only (layout)
  // set-aside paragraphs, line by line (the lines of one paragraph may be several translated
  // lines: a block of credits), then detector lines no paragraph came from
  const pool = [];
  for (const p of an.blocks) {
    // (not lines the analysis guessed by slicing one tall box into three or more, then judged not
    // lettering: a logo or a drawing read as a stack of lines — two signals against one loose box)
    if (p.bubble || p.region != null || (p.score ?? 1) < LAYOUT.adoptScore || (p.pieces || 1) >= LAYOUT.adoptPieces) continue;
    const parts = p.parts || [p.gbox];
    parts.forEach((g, i) => {
      if (held(g)) return;
      const letter = p.lineLetters?.[i] || p.letter, line = p.lineBoxes?.[i] || (p.parts ? g : p.line || g);
      pool.push({ ...p, box: { ...g }, gbox: { ...g }, parts: [g], lineLetters: [letter], lineSyllables: [p.lineSyllables?.[i] || p.syllable || letter], syllable: p.lineSyllables?.[i] || p.syllable || letter, lineBoxes: [line], line, letter, glyphCount: Math.max(1, Math.round((p.vertical ? g.h : g.w) / Math.max(1, p.vertical ? letter : LAYOUT.glyphWidth * letter))) });
    });
  }
  for (const l of an.lines || []) {
    // (a line the second look found on Claude's box, zoomed in, at the detector's own threshold)
    if ((l.score ?? 1) < (l.second ? LAYOUT.secondLookScore : LAYOUT.lineScore) || an.blocks.some((p) => overlap(p.gbox, l) > LAYOUT.most * area(l)) || held(l)) continue;
    const box = { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) };
    const letter = Math.max(LAYOUT.minLetterPx, LAYOUT.lineLetter * (l.vertical ? box.w : box.h));
    // polarity unknown (no grey contrast): erase.js reads the lettering against its surround
    pool.push({ box, gbox: { ...box }, parts: [{ ...box }], lineBoxes: [{ ...box }], letter, lineLetters: [letter], vertical: !!l.vertical, dark: null, score: l.score, glyphCount: Math.max(1, Math.round((l.vertical ? box.h : box.w) / letter)), lines: 1, glyphs: [] });
  }
  if (!pool.length && !readerBoxes) return;
  // each piece of lettering goes to the one line whose box holds it best (several boxes may reach
  // it: the model's boxes run loose, and a long caption's box can reach the credits beside it)
  const boxes = items.map((it) => (it.text && it.box ? { x: it.box[0] * W, y: it.box[1] * H, w: it.box[2] * W, h: it.box[3] * H } : null));
  const zones = boxes.map((px) => px && grow({ x: px.x - LAYOUT.adoptZone * px.w, y: px.y - LAYOUT.adoptZone * px.h, w: (1 + 2 * LAYOUT.adoptZone) * px.w, h: (1 + 2 * LAYOUT.adoptZone) * px.h }, LAYOUT.adoptZoneLetters * an.letter));
  const owner = new Map(); // pool entry → item index
  for (const p of pool) {
    if (p.letter > LAYOUT.adoptMaxLetter * an.letter) continue;
    let best = -1, bestFit = 0;
    boxes.forEach((px, k) => {
      // the lettering inside the box (with some slack), or the box on the lettering's core: a tight
      // box round big lettering covers a part of it only (not more than a quarter, though)
      if (!px || (overlap(p.gbox, zones[k]) < LAYOUT.adoptInside * area(p.gbox) && !(overlap(p.gbox, px) >= LAYOUT.adoptCore * area(px) && area(p.gbox) <= LAYOUT.adoptCoreMax * area(px)))) return;
      // the overlap against both sizes: a tight box round the lettering beats a long one reaching it
      const fit = overlap(p.gbox, px) / Math.sqrt(area(p.gbox) * area(px));
      if (best < 0 || fit > bestFit) { best = k; bestFit = fit; }
    });
    if (best >= 0) { owner.set(p, best); globalThis.GYT_TRACE?.("adopt", p.gbox, `for line ${best}`, { fit: bestFit, letter: p.letter, dark: p.dark }); }
  }
  // two lines given one bubble's stamp, one boxed inside the bubble and one outside it: the stamp
  // was misread for the second (a shout drawn beside the bubble), which then takes lettering like
  // an untagged line
  const centreIn = (b, px) => inBox(b, px.x + px.w / 2, px.y + px.h / 2);
  const misread = (k, stamped) => !centreIn(stamped.box, boxes[k]) && items.some((o, j) => j !== k && o.tag === stamped.id && boxes[j] && centreIn(stamped.box, boxes[j]));
  for (const [k, it] of items.entries()) {
    const px = boxes[k];
    if (!px) continue;
    let stamped = it.tag != null ? byId.get(it.tag) : null;
    if (stamped && stamped.kind === "bubble") {
      if (!misread(k, stamped)) continue;
      stamped = null;
    }
    const zone = zones[k];
    const picks = pool.filter((p) => owner.get(p) === k);
    if (!picks.length) {
      // the box alone, when the mask can find its lettering: not a line tagged to a region, nor
      // one whose box is already a region's, nor a box of under a letter (it says nothing of where)
      if (!readerBoxes || stamped || held(px) || fromBoxes.some((r) => overlap(r.box, px) > LAYOUT.most * area(px)) || px.w < an.letter || px.h < an.letter) continue;
      const box = { x: Math.round(px.x), y: Math.round(px.y), w: Math.round(px.w), h: Math.round(px.h) };
      const letter = an.letter, vertical = box.h > 2 * box.w;
      const ref = { gbox: box, box, parts: [box], lineBoxes: [box], letter, lineLetters: [letter], lineSyllables: [letter], syllable: letter, vertical, dark: null, glyphCount: Math.max(1, Math.round((vertical ? box.h : box.w) / letter)), lines: 1, glyphs: [], adopted: true, fromBox: true, across: letter / LAYOUT.lineLetter };
      const r = { id: fresh(), kind: "block", ref, box, letter, dark: null, adopted: true, fromBox: true };
      ref.region = r.id;
      fromBoxes.push(r);
      globalThis.GYT_TRACE?.("readerBox", box, `for line ${k}`, {});
      continue;
    }
    const lines = (p) => (p.parts || [p.gbox]).map((g, i) => ({ g, letter: p.lineLetters?.[i] || p.letter, syllable: p.lineSyllables?.[i] || p.syllable || p.lineLetters?.[i] || p.letter, line: p.lineBoxes?.[i] || (p.parts ? g : p.line || g) }));
    if (stamped && stamped.kind === "block" && overlap(stamped.box, zone) > 0) {
      // the rest of the tagged text: one region, its lines erased one by one (erase.js)
      const ref = stamped.ref, all = [...lines(ref), ...picks.flatMap(lines)];
      const box = union([ref.gbox, ...picks.map((p) => p.gbox)]);
      const own = (ref.parts || [ref.gbox]).length;
      stamped.ref = { ...ref, gbox: box, box: union([ref.box || ref.gbox, ...picks.map((p) => p.box || p.gbox)]), parts: all.map((l) => l.g), lineLetters: all.map((l) => l.letter), lineSyllables: all.map((l) => l.syllable), lineBoxes: all.map((l) => l.line), lineAdopted: all.map((_, i) => i >= own), glyphCount: (ref.glyphCount || 0) + picks.reduce((n, p) => n + (p.glyphCount || 0), 0), adopted: true };
      stamped.box = box;
      continue;
    }
    if (stamped) continue; // tagged to a region the box is nowhere near: the layout below decides
    const all = picks.flatMap(lines), box = union(picks.map((p) => p.gbox));
    // a sliver of a large box (a corner of a title whose rest could not be taken) is not the line's
    // lettering: the translation would shrink into it while the rest stays
    if (overlap(box, px) < LAYOUT.adoptSliver * Math.sqrt(area(box) * area(px))) continue;
    const letter = Math.max(...picks.map((p) => p.letter)), dark = picks.every((p) => p.dark === picks[0].dark) ? picks[0].dark : null;
    const ref = { ...picks[0], gbox: box, box, parts: all.map((l) => l.g), lineLetters: all.map((l) => l.letter), lineSyllables: all.map((l) => l.syllable), lineBoxes: all.map((l) => l.line), lineAdopted: all.map(() => true), letter, dark, vertical: picks.every((p) => p.vertical), glyphCount: picks.reduce((n, p) => n + (p.glyphCount || 0), 0), adopted: true };
    const r = { id: fresh(), kind: "block", ref, box, letter, dark, adopted: true };
    an.regions.push(r); byId.set(r.id, r);
    ref.region = r.id;
    // the line now has its region, so it is laid out (and erased) there
    it.tag = r.id;
  }
}

/**
 * Two lines given one bubble's stamp: the stamp is right for one of them at most, and the boxes
 * decide which. A member whose box lies more on the lettering of a region no line was given (a
 * neighbouring bubble, a caption) than on its own bubble's lettering goes there; each such region
 * takes one. Without this the neighbour's lettering stays and two translations share one bubble.
 * Updates `groups` (region id → members) in place.
 */
/**
 * The parts of a region its ink divides among its lines: what of the interior (and of the lettering's
 * holes in it, `inHole`) each line's lettering reaches without crossing ink, with the ink it encloses.
 * Two caption boxes drawn side by side are one white region to the bubble model, but a box's border
 * runs across it. Returns `othersPart(i, x, y)`: whether the point is in another line's part and not in
 * line i's, which line i's room then leaves out; and `within(i, x, y)`: whether it is in line i's part. What no line reaches (the outline, its inner edge
 * inside the bubble model's mask) stays in every room, so a region no ink divides keeps its room
 * whole. Null, for the region undivided, when the analysis has no ink mask, when the parts together
 * leave out much of the interior (ink across a bubble that is not a border: tone, speed lines), or
 * when a line's lettering reaches nothing.
 */
function roomParts(an, r, inside, inHole, bbox, anchors, owns) {
  const ink = an.polarities?.[r.dark ? 1 : 0]?.inkMask;
  if (!ink?.data) return null;
  const I = ink.data, IW = ink.cols;
  const x0 = Math.max(0, Math.floor(bbox.x)), y0 = Math.max(0, Math.floor(bbox.y));
  const w = Math.min(IW, Math.ceil(bbox.x + bbox.w)) - x0, h = Math.min(ink.rows, Math.ceil(bbox.y + bbox.h)) - y0;
  if (w <= 0 || h <= 0) return null;
  const boxes = owns.flat();
  const pass = new Uint8Array(w * h);
  let open = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x0 + x, py = y0 + y;
    const lettered = boxes.some((b) => inBox(b, px, py)) && inHole(px, py);
    if (lettered || (inside(px, py) && !I[py * IW + px])) { pass[y * w + x] = 1; open++; }
  }
  if (!open) return null;
  const parts = [], covered = new Uint8Array(w * h);
  let reached = 0;
  for (let i = 0; i < anchors.length; i++) {
    const seeds = owns[i].length ? owns[i] : [anchors[i]], mark = new Uint8Array(w * h), queue = [];
    for (const b of seeds) for (let y = Math.max(0, Math.floor(b.y) - y0); y < Math.min(h, Math.ceil(b.y + b.h) - y0); y++) for (let x = Math.max(0, Math.floor(b.x) - x0); x < Math.min(w, Math.ceil(b.x + b.w) - x0); x++) { const q = y * w + x; if (pass[q] && !mark[q]) { mark[q] = 1; queue.push(q); } }
    for (let k = 0; k < queue.length; k++) {
      const q = queue[k], x = q % w;
      for (const n of [q - w, q + w, x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1]) if (n >= 0 && n < w * h && pass[n] && !mark[n]) { mark[n] = 1; queue.push(n); }
    }
    if (!queue.length) { globalThis.GYT_TRACE?.("room", bbox, "one room: a line's lettering reaches nothing", { line: i }); return null; }
    // and the ink it encloses (marks of the lettering past its line boxes, an accent): what cannot
    // reach the box's edge without crossing the part. A border between two captions runs to the
    // outline, so it is never enclosed.
    const out = new Uint8Array(w * h), edgeQ = [];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const q = y * w + x; if (!mark[q] && !out[q]) { out[q] = 1; edgeQ.push(q); } }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const q = y * w + x; if (!mark[q] && !out[q]) { out[q] = 1; edgeQ.push(q); } }
    for (let k = 0; k < edgeQ.length; k++) {
      const q = edgeQ[k], x = q % w;
      for (const n of [q - w, q + w, x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1]) if (n >= 0 && n < w * h && !mark[n] && !out[n]) { out[n] = 1; edgeQ.push(n); }
    }
    for (let q = 0; q < w * h; q++) if (!mark[q] && !out[q]) mark[q] = 1;
    for (const q of queue) if (!covered[q]) { covered[q] = 1; reached++; }
    parts.push(mark);
  }
  globalThis.GYT_TRACE?.("room", bbox, reached >= LAYOUT.partsCover * open ? "its ink's parts" : "one room: its ink's parts leave out too much", { parts: parts.length, cover: +(reached / open).toFixed(2) });
  if (reached < LAYOUT.partsCover * open) return null;
  const at = (px, py) => { const x = Math.floor(px) - x0, y = Math.floor(py) - y0; return x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x; };
  return {
    othersPart: (i, px, py) => { const q = at(px, py); return q >= 0 && !parts[i][q] && parts.some((m, j) => j !== i && m[q]); },
    within: (i, px, py) => { const q = at(px, py); return q >= 0 && parts[i][q] === 1; },
  };
}

/**
 * The holes of a bubble's interior within its box: what the interior encloses (where the lettering
 * was, in an interior from light regions), as against what lies outside it, reached from the box's
 * edge without crossing the interior. Returns a test for a point.
 */
function holesOf(inside, bbox) {
  const x0 = Math.floor(bbox.x), y0 = Math.floor(bbox.y), w = Math.ceil(bbox.x + bbox.w) - x0, h = Math.ceil(bbox.y + bbox.h) - y0;
  if (w <= 0 || h <= 0) return () => false;
  const out = new Uint8Array(w * h), queue = [];
  const reach = (q) => { if (!out[q] && !inside(x0 + (q % w), y0 + ((q / w) | 0))) { out[q] = 1; queue.push(q); } };
  for (let x = 0; x < w; x++) { reach(x); reach((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { reach(y * w); reach(y * w + w - 1); }
  for (let k = 0; k < queue.length; k++) {
    const q = queue[k], x = q % w;
    if (q >= w) reach(q - w);
    if (q < (h - 1) * w) reach(q + w);
    if (x > 0) reach(q - 1);
    if (x < w - 1) reach(q + 1);
  }
  return (px, py) => {
    const x = Math.floor(px) - x0, y = Math.floor(py) - y0;
    return x >= 0 && y >= 0 && x < w && y < h && !out[y * w + x] && !inside(px, py);
  };
}

/** Text mostly in Hangul (Claude's reading of the lettering): at least half its letters. */
export function hangul(text) {
  const s = String(text || "");
  const letters = (s.match(/\p{L}/gu) || []).length;
  return letters > 0 && (s.match(/[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/gu) || []).length >= LAYOUT.hangulShare * letters;
}

/**
 * A region's letter size for lettering in Hangul: its lines' syllable heights (analyze.js
 * syllableHeight), weighted by their glyphs as its own letter is, instead of the band rowLetter takes
 * for Latin letters, which stops above a syllable's lower part. Where the region's letter was raised
 * to the page's (marks too small to be letters), no smaller than that.
 */
export function hangulLetter(r) {
  const blocks = r.kind === "bubble" ? r.ref.blocks || [] : [r.ref];
  const weighed = (key) => {
    const v = blocks.flatMap((b) => Array(Math.max(1, Math.min(LAYOUT.hangulWeightMax, b.glyphCount | 0))).fill(b[key] ?? b.letter)).sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : 0;
  };
  const own = weighed("letter"), syl = weighed("syllable");
  if (!syl) return r.letter;
  return r.letter > own ? Math.max(r.letter, syl) : syl;
}

function shareStamp(an, groups) {
  const lettering = (q) => (q.kind === "bubble" ? q.ref.blocks.map((b) => b.gbox) : [q.ref.gbox || q.box]);
  const on = (px, q) => lettering(q).reduce((n, g) => n + overlap(px, g), 0);
  const moves = [];
  for (const [id, members] of groups) {
    const r = an.regions.find((q) => q.id === id);
    if (members.length < 2 || r.kind !== "bubble") continue;
    // the stamp is the line's that lies most on the bubble's lettering; the others may have misread it
    const own = members.map((m) => (m.px ? on(m.px, r) : 0)), keeper = own.indexOf(Math.max(...own));
    members.forEach((m, i) => {
      if (!m.px || i === keeper || !tells(m.it)) return;
      let best = null, most = 0;
      for (const q of an.regions) {
        if (groups.has(q.id) || moves.some((v) => v.to === q)) continue;
        const o = on(m.px, q);
        if (o > most) { most = o; best = q; }
      }
      if (best && most > own[i] && most >= LAYOUT.moveMin * area(m.px)) moves.push({ m, from: members, to: best });
    });
  }
  for (const { m, from, to } of moves) {
    if (from.length < 2) continue; // the bubble keeps one line at least
    from.splice(from.indexOf(m), 1);
    groups.set(to.id, [m]);
  }
}

/** Whether the region's shape (its interior for a bubble, its box otherwise) holds the point. */
function shapeHolds(an, r, x, y) {
  if (!inBox(r.box, x, y)) return false;
  const inside = r.kind === "bubble" ? an.insideOf(r.id) : null;
  return inside ? inside(x, y) : true;
}

/** Whether a region is big enough to hold the text the model boxed (a speck of a region never is). */
const canHold = (r, px) => area(r.box) >= LAYOUT.canHold * area(px);

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
    const score = overlap(px, r.box) / Math.max(1, area(px)) + (shapeHolds(an, r, cx, cy) ? LAYOUT.shapeBonus : 0);
    if (score > bestScore + 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && best && area(r.box) < area(best.box))) { bestScore = score; best = r; }
  }
  return bestScore >= LAYOUT.holderScore ? best : null;
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
  const free = blocks.map((b) => ({ ...b.gbox, fromLettering: true, vertical: !!b.vertical, parts: b.parts })).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const anchors = new Array(members.length).fill(null);
  // boxes first, best overlap first, so two members never claim one block
  const claims = [];
  members.forEach((m, i) => { if (m.px) for (const g of free) { const o = overlap(m.px, g); if (o > 0) claims.push({ i, g, o: o / Math.min(area(m.px), area(g)) }); } });
  claims.sort((a, b) => b.o - a.o);
  for (const c of claims) if (!anchors[c.i] && free.includes(c.g)) { anchors[c.i] = c.g; free.splice(free.indexOf(c.g), 1); }
  shareBlocks(anchors, members);
  members.forEach((m, i) => { if (!anchors[i] && free.length) anchors[i] = free.shift(); });
  members.forEach((m, i) => {
    if (anchors[i]) return;
    const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
    anchors[i] = m.px && inBox(bbox, m.px.x + m.px.w / 2, m.px.y + m.px.h / 2) ? m.px : { x: cx - letter, y: cy - letter, w: 2 * letter, h: 2 * letter };
  });
  return anchors;
}

/**
 * A member whose box lies on lettering another member already took shares that
 * block: the detector merged into one paragraph lines the model translated as
 * separate items (a narration column and its parenthesis). Without this the
 * second member gets only its own box, often a sliver, and its text comes out
 * tiny. The block is cut across its lines — between columns for vertical text,
 * between rows otherwise — midway between the members' boxes, and each member
 * anchors to its part. When the block's lines each lie under one member's box, each member takes
 * its own lines instead: two captions' lettering side by side, merged into one paragraph, were cut
 * across their rows and each translation spread over both captions (2.15, the owner's French
 * chapter, page 6). Updates `anchors` in place.
 */
function shareBlocks(anchors, members) {
  const groups = new Map(); // claimed block → indices of the members on it
  members.forEach((m, i) => {
    if (anchors[i] || !m.px) return;
    let best = null, most = 0;
    for (const g of anchors) if (g && g.fromLettering) { const o = overlap(m.px, g); if (o > most) { most = o; best = g; } }
    if (!best || most < LAYOUT.joinShare * area(m.px)) return;
    if (!groups.has(best)) groups.set(best, [anchors.indexOf(best)]);
    groups.get(best).push(i);
  });
  for (const [g, idx] of groups) {
    // Lettering of as many paragraphs as members (two captions merged into one block): each member
    // takes a whole paragraph, the one-to-one choice its boxes overlap most. Claude's box can cover a
    // caption's first line only, and taken line by line, the caption's other lines went to the next
    // member (2.15, the owner's French chapter, page 6: the first caption's text set at 16 px).
    const runs = g.parts?.length > 1 ? paragraphs(g.parts, !!g.vertical) : [];
    if (runs.length === idx.length && idx.length > 1 && idx.length <= 4) {
      const boxes = runs.map((r) => union(r));
      let best = null, most = 0;
      for (const order of permutations(idx.length)) {
        const os = order.map((r, k) => overlap(members[idx[k]].px, boxes[r]));
        const sum = os.reduce((a, b) => a + b, 0);
        if (os.every((o) => o > 0) && sum > most) { most = sum; best = order; }
      }
      if (best) { idx.forEach((i, k) => { anchors[i] = { ...boxes[best[k]], fromLettering: true, vertical: g.vertical, parts: runs[best[k]] }; }); continue; }
    }
    if (g.parts?.length > 1) {
      const mine = idx.map(() => []);
      for (const part of g.parts) {
        let best = -1, most = 0;
        idx.forEach((i, k) => { const o = overlap(members[i].px, part); if (o > most) { most = o; best = k; } });
        if (best >= 0 && most >= LAYOUT.most * area(part)) mine[best].push(part);
      }
      if (mine.every((ps) => ps.length)) { idx.forEach((i, k) => { anchors[i] = { ...union(mine[k]), fromLettering: true, vertical: g.vertical, parts: mine[k] }; }); continue; }
    }
    const across = g.vertical ? "x" : "y", len = g.vertical ? "w" : "h";
    const at = (i) => members[i].px[across] + members[i].px[len] / 2;
    idx.sort((a, b) => at(a) - at(b));
    const lo = g[across], hi = g[across] + g[len], margin = LAYOUT.cutMargin * g[len];
    let start = lo;
    // the cut: midway between the two boxes' facing edges (between their centres if they overlap)
    const cut = (a, b) => { const pa = members[a].px, pb = members[b].px, e = pa[across] + pa[len], f = pb[across]; return e <= f ? (e + f) / 2 : (at(a) + at(b)) / 2; };
    idx.forEach((i, k) => {
      const end = k === idx.length - 1 ? hi : clamp(cut(i, idx[k + 1]), start + margin, hi - margin);
      anchors[i] = { ...g, [across]: start, [len]: Math.max(1, end - start) };
      start = end;
    });
  }
}

/**
 * A block's lines (or columns, `vertical`) in the paragraphs they read as: a line belongs with the one
 * before it when it follows it (a gap under a line's height) and overlaps it across at least half the
 * narrower one (LAYOUT.most). Two captions side by side, merged into one block, come apart.
 */
export function paragraphs(parts, vertical) {
  const [x, w, y, h] = vertical ? ["y", "h", "x", "w"] : ["x", "w", "y", "h"];
  const order = [...parts].sort((a, b) => vertical ? (b.x + b.w) - (a.x + a.w) : a.y - b.y);
  const runs = [];
  for (const p of order) {
    let best = null, most = 0;
    for (const r of runs) {
      const q = r[r.length - 1];
      const gap = vertical ? q.x - (p.x + p.w) : p.y - (q.y + q.h);
      if (gap > Math.max(p[h], q[h])) continue;
      const o = Math.min(p[x] + p[w], q[x] + q[w]) - Math.max(p[x], q[x]);
      const share = o / Math.max(1, Math.min(p[w], q[w]));
      if (share >= LAYOUT.most && share > most) { most = share; best = r; }
    }
    if (best) best.push(p); else runs.push([p]);
  }
  return runs;
}

/** The orders of 0..n-1 (n ≤ 4: a bubble's members). */
function permutations(n) {
  if (n <= 1) return [[0]];
  const out = [];
  for (const p of permutations(n - 1)) for (let k = 0; k <= p.length; k++) out.push([...p.slice(0, k), n - 1, ...p.slice(k)]);
  return out;
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
  if (hi - lo < LAYOUT.waistMinPx) return null;
  const step = Math.max(1, Math.round((hi - lo) / LAYOUT.waistRows)), cross = Math.max(1, Math.round((rows ? bbox.w : bbox.h) / LAYOUT.waistCross));
  const width = (p) => { let n = 0; if (rows) { for (let x = bbox.x; x < bbox.x + bbox.w; x += cross) if (inside(x, p)) n++; } else { for (let y = bbox.y; y < bbox.y + bbox.h; y += cross) if (inside(p, y)) n++; } return n; };
  let best = null, bestW = Infinity;
  for (let p = lo; p <= hi; p += step) { const w = width(p); if (w < bestW) { bestW = w; best = p; } }
  const ends = Math.min(width(lo), width(hi));
  return ends > 0 && bestW < LAYOUT.waistNarrow * ends ? best : null;
}

function inset(b, k) { return { x: b.x + b.w * (1 - k) / 2, y: b.y + b.h * (1 - k) / 2, w: b.w * k, h: b.h * k }; }
function clampRect(r, W, H) {
  const x = clamp(r.x, 0, W - 1), y = clamp(r.y, 0, H - 1);
  return { x, y, w: clamp(r.w, LAYOUT.minRectPx, W - x), h: clamp(r.h, LAYOUT.minRectPx, H - y) };
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
  const step = Math.max(1, Math.round(Math.min(bbox.w, bbox.h) / LAYOUT.rectRows));
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
  return inset(bestRect, LAYOUT.airInset); // letters should not kiss the outline
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
    a.w = Math.max(LAYOUT.minSplitPx, a.w); a.h = Math.max(LAYOUT.minSplitPx, a.h); b.w = Math.max(LAYOUT.minSplitPx, b.w); b.h = Math.max(LAYOUT.minSplitPx, b.h);
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
