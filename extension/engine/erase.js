import { aotInpaint, contextWindow } from "./inpaint.js";
import { latticeFill } from "./tone.js";

// A surround is plain when 9 in 10 of its pixels lie within COLOUR_PLAIN of their median in every
// channel (JPEG noise and a gentle gradient do; screentone, hatching and art do not); there,
// lettering is what lies more than COLOUR_APART from it in some channel — black, white, or a
// coloured letter alike, and well clear of the surround's own spread. Anything less plain keeps
// to the polarity masks alone.
const COLOUR_PLAIN = 40, COLOUR_APART = 64, PLAIN_SHARE = 0.9;
// adopted lettering (layout.js) is erased only when this share of its line's ink is taken
const ADOPTED_TAKEN = 0.6;

// Removes the original lettering from the regions that received a translation.
// Inside a bubble: the glyph components (never the outline) are inpainted with
// the bubble's own surface. Free text over artwork: the glyphs are inpainted
// (Telea) in a small ROI, which reconstructs tone and simple strokes behind
// the letters. Everything else on the page is untouched.

/**
 * @param {typeof import("../vendor/opencv.js")} cv
 * @param {ImageData} img working-resolution page (same one analyze() saw)
 * @param {import("./analyze.js").Analysis} analysis
 * @param {Set<number>} regionIds regions that have translations to place
 * @param {{keepMask?: boolean, outline?: number}} [opts] keepMask: also return the inpainting mask
 *   and the surfaces (cv.Mats the caller deletes) and how each area is to be filled, for
 *   fillTexture() and for erasing again at the page's full size; outline: grow the mask over
 *   lettering outlines by this share of a letter
 * @returns {{image: ImageData, rois: Array<{x:number,y:number,w:number,h:number,radius?:number}>, mask?: any, surface?: any}} cleaned page and the areas that changed
 */
export function erase(cv, img, analysis, regionIds, opts = {}) {
  const { W, H } = analysis;
  const src = cv.matFromImageData(img);
  const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const mask = cv.Mat.zeros(H, W, cv.CV_8UC1);
  const md = mask.data;
  const rois = []; // {x,y,w,h,radius}

  const paintGlyph = (labels, lbl, g) => {
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) { const p = y * W + x; if (labels[p] === lbl) md[p] = 255; }
  };

  // Learned analysis: the lettering is the ink inside each detected text box (grown
  // by a third of a letter across the lines and most of a letter along them, where
  // the detector tends to stop short of a last glyph), as connected components that
  // stay inside that window — an outline or a stroke of art crossing the window is
  // not a letter.
  // the extent of what the current region's lettering painted: the area to fill must hold all of it
  let painted = null;
  const extend = (x0, y0, x1, y1) => { painted = painted ? { x0: Math.min(painted.x0, x0), y0: Math.min(painted.y0, y0), x1: Math.max(painted.x1, x1), y1: Math.max(painted.y1, y1) } : { x0, y0, x1, y1 }; };
  const paintTextBox = (pol, b, letter, inside = null, withColour = true) => {
    const across = Math.max(2, Math.round(letter * 0.35)), along = Math.max(3, Math.round(letter * 0.7));
    const padX = b.vertical ? across : along, padY = b.vertical ? along : across;
    const x0 = Math.max(0, b.gbox.x - padX), y0 = Math.max(0, b.gbox.y - padY), x1 = Math.min(W, b.gbox.x + b.gbox.w + padX), y1 = Math.min(H, b.gbox.y + b.gbox.h + padY);
    const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
    // lettering the analysis had set aside (layout.js adoptLettering) is erased all or nothing: when
    // most of the ink on its line is not taken (outlined display lettering, a logo), the line stays
    // as it was — half a word and a smudge read worse than the original under the translation
    const saved = b.adopted ? [] : null;
    if (saved) for (let yy = y0; yy < y1; yy++) saved.push(md.slice(yy * W + x0, yy * W + x1));
    // the lettering is ink of its polarity (pol), and — on a plain surround — whatever stands out
    // from that surround in colour, which is how coloured lettering is found (blue, orange: neither
    // dark nor light enough for the polarity masks). The colour window also takes in the detector's
    // own box for the line (`line`): the analysis sizes a line by its dark ink, which in a coloured
    // letter is a thin core.
    const masks = [];
    if (pol) masks.push({ roi: pol.inkMask.roi(new cv.Rect(x0, y0, w, h)), x0, y0, w, h });
    if (withColour) {
      const l = b.line, cx0 = Math.max(0, Math.min(x0, l ? Math.floor(l.x) : x0)), cy0 = Math.max(0, Math.min(y0, l ? Math.floor(l.y) : y0));
      const cx1 = Math.min(W, Math.max(x1, l ? Math.ceil(l.x + l.w) : x1)), cy1 = Math.min(H, Math.max(y1, l ? Math.ceil(l.y + l.h) : y1));
      const colour = colourLettering(cx0, cy0, cx1 - cx0, cy1 - cy0, inside);
      if (colour) masks.push({ roi: colour, x0: cx0, y0: cy0, w: cx1 - cx0, h: cy1 - cy0, colour: true });
    }
    for (const { roi, x0, y0, w, h, colour } of masks) {
      const lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
      const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
      const S = st.data32S, Lb = lab.data32S;
      const keep = new Uint8Array(n);
      for (let i = 1; i < n; i++) {
        const cx = S[i * 5], cy = S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
        const touches = cx <= 0 || cy <= 0 || cx + cw >= w || cy + ch >= h;
        // size across the line only: along it a mark may be long (a wave dash, a
        // long vowel mark in a column) and still be lettering — a stroke of art or
        // an outline crossing the window touches its edge instead
        // in a bubble, what stands apart in colour is lettering only wholly inside the interior (as in
        // paintBubbleColour): past the outline it is the art around the bubble, which the bubble's
        // own fill would paint over
        const X0 = x0 + cx, Y0 = y0 + cy;
        if (colour && inside && !(inside(X0 - 1, Y0 - 1) && inside(X0 + cw, Y0 - 1) && inside(X0 - 1, Y0 + ch) && inside(X0 + cw, Y0 + ch))) continue;
        if (!touches && (b.vertical ? cw : ch) <= 2.5 * letter) { keep[i] = 1; extend(X0, Y0, X0 + cw, Y0 + ch); }
      }
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const l = Lb[yy * w + xx]; if (l && keep[l]) md[(y0 + yy) * W + x0 + xx] = 255; }
      roi.delete(); lab.delete(); st.delete(); ce.delete();
    }
    if (saved) {
      // the line's ink (its polarity's, else what stands apart from the window's median) against what was taken
      const g = b.gbox, I = pol ? pol.inkMask.data : null;
      let ink = 0, taken = 0;
      const mid = I ? null : (() => { const v = []; for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) { const p = (yy * W + xx) * 4; v.push((pix[p] + pix[p + 1] + pix[p + 2]) / 3); } v.sort((p, q) => p - q); return v[v.length >> 1]; })();
      for (let yy = Math.max(0, g.y); yy < Math.min(H, g.y + g.h); yy++) for (let xx = Math.max(0, g.x); xx < Math.min(W, g.x + g.w); xx++) {
        const q = yy * W + xx, p = q * 4;
        if (I ? !I[q] : Math.abs((pix[p] + pix[p + 1] + pix[p + 2]) / 3 - mid) <= COLOUR_APART) continue;
        ink++; if (md[q]) taken++;
      }
      if (ink && taken < ADOPTED_TAKEN * ink) saved.forEach((row, i) => md.set(row, (y0 + i) * W + x0));
    }
  };

  // What stands out in colour from the window's surround, as a mask of the window (null when the
  // surround is not plain: art and tone around free text are not one colour, and there the polarity
  // masks alone decide). The surround is the window's edge — inside the bubble, for a bubble.
  const pix = img.data;
  const colourLettering = (x0, y0, w, h, inside) => {
    const rs = [], gs = [], bs = [];
    const ring = (x, y) => { if (inside && !inside(x, y)) return; const p = (y * W + x) * 4; rs.push(pix[p]); gs.push(pix[p + 1]); bs.push(pix[p + 2]); };
    for (let x = x0; x < x0 + w; x++) for (const y of [y0, y0 + 1, y0 + h - 2, y0 + h - 1]) ring(x, y);
    for (let y = y0 + 2; y < y0 + h - 2; y++) for (const x of [x0, x0 + 1, x0 + w - 2, x0 + w - 1]) ring(x, y);
    if (rs.length < 24) return null;
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    const c = [med(rs), med(gs), med(bs)];
    let near = 0;
    for (let i = 0; i < rs.length; i++) if (Math.max(Math.abs(rs[i] - c[0]), Math.abs(gs[i] - c[1]), Math.abs(bs[i] - c[2])) <= COLOUR_PLAIN) near++;
    if (near < PLAIN_SHARE * rs.length) return null;
    const m = cv.Mat.zeros(h, w, cv.CV_8UC1), d = m.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const p = ((y0 + yy) * W + x0 + xx) * 4;
      if (Math.max(Math.abs(pix[p] - c[0]), Math.abs(pix[p + 1] - c[1]), Math.abs(pix[p + 2] - c[2])) > COLOUR_APART) d[yy * w + xx] = 255;
    }
    return m;
  };

  // In a bubble with a plain surface: whatever stands out from the surface near the lettering, in
  // marks wholly inside the interior. The text detector finds a line of coloured (or faint) lettering,
  // but the analysis sizes it by its dark ink, which in a blue or orange letter is a thin core; this
  // takes the whole letter. Marks touching the interior's edge (the outline) and specks far from the
  // text (decoration) stay.
  const paintBubbleColour = (r, blocks, letter, inside) => {
    const { x, y, w, h } = r.box;
    if (w < 4 || h < 4) return;
    // near the lettering: the lines as the analysis sized them and as the detector boxed them (a
    // coloured line it sized by its dark core, or dropped for having none, is still the detector's)
    const cxIn = (l) => inside(l.x + l.w / 2, l.y + l.h / 2);
    const lines = blocks.flatMap((b) => [b.gbox, b.line, ...(b.lineBoxes || [])]).concat((analysis.lines || []).filter(cxIn)).filter(Boolean);
    const zone = lines.map((b) => ({ x: b.x - letter, y: b.y - letter, w: b.w + 2 * letter, h: b.h + 2 * letter }));
    const inZone = (xx, yy) => zone.some((z) => xx >= z.x && xx < z.x + z.w && yy >= z.y && yy < z.y + z.h);
    // the surface: the interior away from its edge and from the lettering
    const e = 3, deep = (xx, yy) => inside(xx, yy) && inside(xx - e, yy) && inside(xx + e, yy) && inside(xx, yy - e) && inside(xx, yy + e);
    const rs = [], gs = [], bs = [];
    for (let yy = y; yy < y + h; yy += 2) for (let xx = x; xx < x + w; xx += 2) if (deep(xx, yy) && !inZone(xx, yy)) { const p = (yy * W + xx) * 4; rs.push(pix[p]); gs.push(pix[p + 1]); bs.push(pix[p + 2]); }
    if (rs.length < 50) return;
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    const c = [med(rs), med(gs), med(bs)];
    let near = 0;
    for (let i = 0; i < rs.length; i++) if (Math.max(Math.abs(rs[i] - c[0]), Math.abs(gs[i] - c[1]), Math.abs(bs[i] - c[2])) <= COLOUR_PLAIN) near++;
    if (near < PLAIN_SHARE * rs.length) return; // the surface is not one colour: tone, a gradient, art
    const m = cv.Mat.zeros(h, w, cv.CV_8UC1), d = m.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const X = x + xx, Y = y + yy, p = (Y * W + X) * 4;
      if (inside(X, Y) && Math.max(Math.abs(pix[p] - c[0]), Math.abs(pix[p + 1] - c[1]), Math.abs(pix[p + 2] - c[2])) > COLOUR_APART) d[yy * w + xx] = 255;
    }
    const lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
    const n = cv.connectedComponentsWithStats(m, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S, Lb = lab.data32S, keep = new Uint8Array(n);
    for (let i = 1; i < n; i++) {
      const cx = x + S[i * 5], cy = y + S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
      // not a letter (a drawing) — but a long stroke as thin as one is: a stretched long vowel mark
      if ((cw > 3 * letter || ch > 3 * letter) && !(Math.min(cw, ch) <= 1.2 * letter && Math.max(cw, ch) <= 0.9 * Math.max(w, h))) continue;
      // wholly inside: the corners of its box, a pixel in from each, on the interior
      if (!(inside(cx - 1, cy - 1) && inside(cx + cw, cy - 1) && inside(cx - 1, cy + ch) && inside(cx + cw, cy + ch))) continue;
      if (!zone.some((z) => cx < z.x + z.w && cx + cw > z.x && cy < z.y + z.h && cy + ch > z.y)) continue;
      keep[i] = 1; extend(cx, cy, cx + cw, cy + ch);
    }
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const l = Lb[yy * w + xx]; if (l && keep[l]) md[(y + yy) * W + x + xx] = 255; }
    m.delete(); lab.delete(); st.delete(); ce.delete();
  };

  // A bubble the segmentation model found but the text detector left empty: the
  // lettering is whatever letter-sized ink lies wholly inside the mask.
  const paintInsideMask = (pol, b, letter) => {
    const { x, y, w, h } = b.box, m = b.fill;
    const roi = pol.inkMask.roi(new cv.Rect(x, y, w, h)), lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S, Lb = lab.data32S, keep = new Uint8Array(n);
    for (let i = 1; i < n; i++) {
      const cx = S[i * 5], cy = S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
      if (ch > 3 * letter || cw > 0.9 * w) continue;
      // all four corners of the component's box on the mask: it does not touch the outline
      if (m[cy * w + cx] && m[cy * w + Math.min(w - 1, cx + cw)] && m[Math.min(h - 1, cy + ch) * w + cx] && m[Math.min(h - 1, cy + ch) * w + Math.min(w - 1, cx + cw)]) keep[i] = 1;
    }
    let any = false;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const l = Lb[yy * w + xx]; if (l && keep[l]) { md[(y + yy) * W + x + xx] = 255; any = true; } }
    roi.delete(); lab.delete(); st.delete(); ce.delete();
    return any;
  };

  for (const r of analysis.regions) {
    if (!regionIds.has(r.id)) continue;
    const pol = analysis.polarities[r.dark ? 1 : 0];
    if (analysis.learned) {
      // lettering adopted from a translated line's box may have no known polarity (layout.js
      // adoptLettering): then both polarities' ink, besides its colour against the surround
      const pols = r.dark == null ? analysis.polarities : [pol];
      const inside = r.kind === "bubble" ? analysis.insideOf(r.id) : null;
      const letter = Math.max(4, r.letter);
      const blocks = r.kind === "bubble" ? r.ref.blocks : [r.ref];
      let roi;
      painted = null;
      if (blocks.length) {
        // Free text: line by line (`parts`, the detected lines a paragraph was merged from), not
        // the paragraph's whole box: lines chained across a picture make a box that holds the art
        // between them, and every small stroke in it would pass for lettering.
        for (const b of blocks) {
          pols.forEach((P, k) => {
            if (r.kind !== "bubble" && b.parts) b.parts.forEach((g, i) => paintTextBox(P, { ...b, gbox: g, line: b.lineBoxes?.[i], adopted: !!b.lineAdopted?.[i] }, b.lineLetters?.[i] || b.letter || letter, null, k === 0));
            else paintTextBox(P, b, b.letter || letter, inside, k === 0);
          });
        }
        if (inside) {
          paintBubbleColour(r, blocks, letter, inside);
          // and along each of the detector's lines in the bubble, its window's own surround: a
          // coloured line the analysis sized by its dark core (or dropped) is read whole there,
          // even when speed lines or tone elsewhere in the bubble leave the bubble as a whole not plain
          for (const l of analysis.lines || []) {
            if (!inside(l.x + l.w / 2, l.y + l.h / 2)) continue;
            const g = { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) };
            paintTextBox(null, { gbox: g, line: g, vertical: !!l.vertical }, Math.max(letter, 0.85 * (l.vertical ? g.w : g.h)), inside, true);
          }
        }
        const pad = Math.round(letter * 0.8);
        // around the lettering's boxes, and whatever of it the masks found beyond them (a coloured
        // line read whole, the rest of an adopted line)
        const P = painted || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        const tx0 = Math.min(P.x0, ...blocks.map((b) => b.gbox.x)) - pad, ty0 = Math.min(P.y0, ...blocks.map((b) => b.gbox.y)) - pad;
        const tx1 = Math.max(P.x1, ...blocks.map((b) => b.gbox.x + b.gbox.w)) + pad, ty1 = Math.max(P.y1, ...blocks.map((b) => b.gbox.y + b.gbox.h)) + pad;
        roi = { x: Math.max(0, Math.round(tx0)), y: Math.max(0, Math.round(ty0)) };
        roi.w = Math.max(1, Math.min(W, Math.round(tx1)) - roi.x); roi.h = Math.max(1, Math.min(H, Math.round(ty1)) - roi.y);
      } else if (r.kind === "bubble" && r.ref.fill && paintInsideMask(pol, r.ref, letter)) {
        roi = { ...r.box };
      } else continue;
      if (r.kind === "bubble") rois.push({ ...roi, radius: 3, inside: analysis.insideOf(r.id), dark: r.dark, letter });
      else rois.push({ ...roi, radius: Math.max(3, Math.round(letter * 0.3)), letter });
      continue;
    }
    const glyphLabels = pol.glyphLabels.data32S, regionLabels = pol.regionLabels.data32S;
    const letter = Math.max(4, r.letter);
    if (r.kind === "bubble") {
      const b = r.ref, { x, y, w, h } = b.box;
      // Lettering = the detected text blocks' components, plus glyph-sized ink
      // within a letter of them (accents, punctuation, bits the grouping missed).
      // Never a sweep of the whole shape: if this "bubble" is really a face or a
      // sleeve, the art in it must survive a wrong tag.
      const seen = new Set();
      for (const bl of b.blocks) for (const gi of bl.glyphs) seen.add(gi);
      const nearText = (g) => b.blocks.some((bl) => g.x + g.w >= bl.gbox.x - letter && g.x <= bl.gbox.x + bl.gbox.w + letter && g.y + g.h >= bl.gbox.y - letter && g.y <= bl.gbox.y + bl.gbox.h + letter);
      for (let gi = 1; gi < pol.glyphs.length; gi++) {
        const g = pol.glyphs[gi]; if (!g || seen.has(gi)) continue;
        if (g.x < x + 1 || g.y < y + 1 || g.x + g.w > x + w - 1 || g.y + g.h > y + h - 1) continue;
        if (g.a > 0.2 * b.area || g.h > 1.6 * letter || !nearText(g)) continue;
        // adjacent to the bubble surface?
        const cx = g.x + (g.w >> 1), cy = g.y + (g.h >> 1), d = 2;
        const near = [[g.x - d, cy], [g.x + g.w + d, cy], [cx, g.y - d], [cx, g.y + g.h + d]].some(([sx, sy]) => sx >= 0 && sy >= 0 && sx < W && sy < H && regionLabels[sy * W + sx] === b.labelId);
        if (near) seen.add(gi);
      }
      // the inpaint ROI is the lettering's neighbourhood, not the whole shape
      const tx0 = Math.max(x, Math.min(...b.blocks.map((bl) => bl.gbox.x)) - 2 * letter), ty0 = Math.max(y, Math.min(...b.blocks.map((bl) => bl.gbox.y)) - 2 * letter);
      const tx1 = Math.min(x + w, Math.max(...b.blocks.map((bl) => bl.gbox.x + bl.gbox.w)) + 2 * letter), ty1 = Math.min(y + h, Math.max(...b.blocks.map((bl) => bl.gbox.y + bl.gbox.h)) + 2 * letter);
      for (const gi of seen) paintGlyph(glyphLabels, gi, pol.glyphs[gi]);
      rois.push({ x: Math.round(tx0), y: Math.round(ty0), w: Math.max(1, Math.round(tx1 - tx0)), h: Math.max(1, Math.round(ty1 - ty0)), radius: 3, inside: analysis.insideOf(r.id), dark: r.dark });
    } else {
      const bl = r.ref, { x, y, w, h } = bl.box;
      for (const gi of bl.glyphs) paintGlyph(glyphLabels, gi, pol.glyphs[gi]);
      const pad = Math.round(letter * 0.8);
      rois.push({ x: Math.max(0, x - pad), y: Math.max(0, y - pad), w: Math.min(W, x + w + pad) - Math.max(0, x - pad), h: Math.min(H, y + h + pad) - Math.max(0, y - pad), radius: Math.max(3, Math.round(letter * 0.3)) });
    }
  }

  if (rois.length) {
    // Grow the mask over the anti-aliased fringe of each stroke; inside bubbles
    // never past the bubble's interior (so outlines stay crisp).
    const grow = Math.max(2, Math.round(analysis.letter * 0.15));
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * grow + 1, 2 * grow + 1));
    const grown = new cv.Mat(); cv.dilate(mask, grown, k); k.delete();
    const gd = grown.data, px = img.data;
    for (const r of rois) {
      for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
        const p = yy * W + xx;
        if (!gd[p] || md[p]) continue;
        if (r.inside && !r.inside(xx, yy)) {
          // Not bubble surface: admit the anti-aliased fringe of a stroke, never
          // the outline itself (solid ink of the bubble's own colour polarity).
          const lum = (px[p * 4] + px[p * 4 + 1] + px[p * 4 + 2]) / 3;
          if (r.dark ? lum > 200 : lum < 70) continue;
        }
        md[p] = 255;
      }
    }
    grown.delete();
    if (opts.outline) growOutline(cv, mask, rois, W, opts.outline);
    // lettering a line with nothing to translate claimed (layout.js: region.kept) stays as drawn
    for (const r of analysis.regions) {
      if (!regionIds.has(r.id) || !r.kept) continue;
      for (const k of r.kept) {
        const x0 = Math.max(0, Math.floor(k.x)), y0 = Math.max(0, Math.floor(k.y)), x1 = Math.min(W, Math.ceil(k.x + k.w)), y1 = Math.min(H, Math.ceil(k.y + k.h));
        for (let yy = y0; yy < y1; yy++) md.fill(0, yy * W + x0, yy * W + x1);
      }
    }
    for (const r of rois) {
      const rect = new cv.Rect(r.x, r.y, r.w, r.h);
      const srcRoi = rgb.roi(rect), maskRoi = mask.roi(rect);
      // How the area is filled: a flat surface (most white bubbles) takes its own colour, exactly;
      // anything else (screentone, gradients, art) is "texture", filled by fillTexture() (the
      // screentone fill where the surface is a lattice, else the learned inpainter, else Telea)
      // and given Telea meanwhile.
      const rc = srcRoi.clone(), mc = maskRoi.clone(); // continuous copies to read
      const flat = flatSurface(rc, mc, r.inside ? (x, y) => r.inside(r.x + x, r.y + y) : null);
      rc.delete(); mc.delete();
      if (flat) { r.fill = "flat"; r.color = flat; srcRoi.setTo(new cv.Scalar(flat[0], flat[1], flat[2]), maskRoi); }
      else {
        r.fill = "texture";
        const dst = new cv.Mat();
        cv.inpaint(srcRoi, maskRoi, dst, r.radius, cv.INPAINT_TELEA);
        dst.copyTo(srcRoi); dst.delete();
      }
      srcRoi.delete(); maskRoi.delete();
    }
  }

  const out = new cv.Mat(); cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
  const result = new ImageData(new Uint8ClampedArray(out.data), W, H);
  src.delete(); rgb.delete(); out.delete();
  if (opts.keepMask) {
    // Each textured bubble's surface (its interior, as far around the area as the fill looks),
    // labelled with the area's number: the screentone fill copies only from there, never from the
    // outline or the art outside.
    const surface = cv.Mat.zeros(H, W, cv.CV_8UC1), sd = surface.data;
    rois.forEach((r, i) => {
      if (r.fill !== "texture" || !r.inside || i >= 254) return;
      r.label = i + 1;
      const m = contextMargin(r.letter);
      for (let yy = Math.max(0, r.y - m); yy < Math.min(H, r.y + r.h + m); yy++) for (let xx = Math.max(0, r.x - m); xx < Math.min(W, r.x + r.w + m); xx++) if (r.inside(xx, yy)) sd[yy * W + xx] = r.label;
    });
    return { image: result, rois: rois.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, radius: r.radius, fill: r.fill, color: r.color, letter: r.letter, label: r.label || 0 })), mask, surface };
  }
  mask.delete();
  return { image: result, rois: rois.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) };
}

/**
 * Grows each area's mask over the lettering's outline (a white stroke around black letters, a
 * dark one around white letters, the glow of a shout): by `k` × the area's letter size, which is
 * how thick lettering outlines run, and never past a bubble's interior, so the bubble's own
 * outline stays. The fill (flat or texture) then covers the outline too; Telea alone smeared it.
 */
function growOutline(cv, mask, rois, W, k) {
  for (const r of rois) {
    const g = Math.max(1, Math.round((r.letter || 8) * k));
    const sub = mask.roi(new cv.Rect(r.x, r.y, r.w, r.h)), m = sub.clone(), grown = new cv.Mat(); // clones: continuous rows
    const kern = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * g + 1, 2 * g + 1));
    cv.dilate(m, grown, kern); kern.delete();
    const gd = grown.data, md = m.data;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      if (gd[i] && !md[i] && (!r.inside || r.inside(r.x + x, r.y + y))) md[i] = 255;
    }
    m.copyTo(sub);
    grown.delete(); m.delete(); sub.delete();
  }
}

/**
 * The colour of the area's surface when it is flat (a white or plain bubble), else null.
 * Measured on the area's unmasked pixels, and for a bubble only those at least 3 px inside its
 * interior (the interior's edge carries bits of outline). Flat = nearly all of them sit at one
 * level (within 8 of the median: JPEG noise), so a few stray marks don't make a white bubble
 * "textured", while screentone (dots on a quarter or more of it) or a gradient is not flat.
 */
export function flatSurface(rgb, mask, inside) {
  const d = rgb.data, md = mask.data, w = rgb.cols, h = rgb.rows, e = 3;
  const lums = [], rs = [], gs = [], bs = [];
  const deep = inside ? (x, y) => inside(x, y) && inside(x - e, y) && inside(x + e, y) && inside(x, y - e) && inside(x, y + e) : () => true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (md[y * w + x] || !deep(x, y)) continue;
    const p = (y * w + x) * 3;
    lums.push((d[p] + d[p + 1] + d[p + 2]) / 3); rs.push(d[p]); gs.push(d[p + 1]); bs.push(d[p + 2]);
  }
  if (lums.length < 50) return null;
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const m = med(lums);
  const atLevel = lums.filter((l) => Math.abs(l - m) <= 8).length / lums.length;
  if (atLevel < 0.95) return null;
  return [med(rs), med(gs), med(bs)];
}

/**
 * Erases one changed area again at the page's full size, so the patch drawn over the reader's
 * image has that image's own pixels around the erased lettering (the work-resolution patch,
 * stretched, is softer than the page it covers). `natural`: that area of the full-size page as
 * ImageData, whose top-left is (nx, ny) in page pixels. `mask`: the slice's work-resolution mask
 * from erase(..., {keepMask: true}); `scale`: work pixels per page pixel; (ox, oy): the slice's
 * origin in page pixels. The mask is resampled onto the full-size pixel grid by the exact affine
 * map (pixel centres), not by resizing a rounded rectangle, so the patch lines up with the
 * original to a fraction of a pixel. The area is filled the way erase() chose for it (`area.fill`):
 * its flat colour, or as texture (fillArea: screentone, learned, Telea), copying screentone only
 * from the area's surface (`surface`, erase()'s, resampled the same way).
 * @param {{fill?: "flat"|"texture", color?: number[], radius?: number, label?: number, letter?: number}} area
 * @param {Map<string, object>|null} [cache] see fillArea
 * @param {{image: ImageData, x: number, y: number, side: number}|null} [context] the full-size page around
 *   `natural` (whose top-left is at x, y in it), for a learned inpainter of one input size (`side`)
 * @returns {Promise<ImageData|null>} the erased area, or null when no mask pixel falls inside it
 */
export async function eraseFullSize(cv, natural, nx, ny, mask, scale, ox, oy, area = {}, model = null, surface = null, cache = null, context = null) {
  const W = natural.width, H = natural.height;
  const M = cv.matFromArray(2, 3, cv.CV_64F, [scale, 0, (nx - ox + 0.5) * scale - 0.5, 0, scale, (ny - oy + 0.5) * scale - 0.5]);
  const m = new cv.Mat();
  cv.warpAffine(mask, m, M, new cv.Size(W, H), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
  // a quarter of a work pixel's coverage counts: the work mask was already grown over each stroke's fringe
  cv.threshold(m, m, 63, 255, cv.THRESH_BINARY);
  if (!cv.countNonZero(m)) { M.delete(); m.delete(); return null; }
  let on = null;
  if (surface && area.label) {
    on = new cv.Mat();
    cv.warpAffine(surface, on, M, new cv.Size(W, H), cv.INTER_NEAREST | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
    const od = on.data; for (let i = 0; i < od.length; i++) od[i] = od[i] === area.label ? 255 : 0;
  }
  M.delete();
  const src = cv.matFromImageData(natural), rgb = new cv.Mat(), out = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  let done = null;
  if (area.fill === "flat" && area.color) { done = rgb.clone(); done.setTo(new cv.Scalar(area.color[0], area.color[1], area.color[2]), m); }
  else if (area.fill === "texture") {
    let f;
    // (context: the full-size page around the patch, for a model of one size; see fillTexture)
    let ctx = null;
    if (context) { const c = cv.matFromImageData(context.image); ctx = { image: new cv.Mat(), x: context.x, y: context.y, side: context.side }; cv.cvtColor(c, ctx.image, cv.COLOR_RGBA2RGB); c.delete(); }
    try { f = await fillArea(cv, model, rgb, m, on, { margin: Math.ceil(2 / scale), cache, context: ctx }); }
    catch (e) { ctx?.image.delete(); src.delete(); rgb.delete(); out.delete(); m.delete(); on?.delete(); throw e; } // (NotLoaded: the caller leaves it for later)
    ctx?.image.delete();
    done = f.mat; area.filled = f.kind; area.fillMs = f.ms; area.fillHit = !!f.hit;
  }
  if (!done) { done = new cv.Mat(); cv.inpaint(rgb, m, done, Math.max(3, Math.round((area.radius || 3) / scale)), cv.INPAINT_TELEA); }
  cv.cvtColor(done, out, cv.COLOR_RGB2RGBA);
  const result = new ImageData(new Uint8ClampedArray(out.data), W, H);
  src.delete(); rgb.delete(); done.delete(); out.delete(); m.delete(); on?.delete();
  return result;
}

/**
 * Fills one textured area: the screentone fill where its surface is a lattice (engine/tone.js),
 * else the learned inpainter where there is one, else nothing (null: the caller keeps Telea).
 * `opts.cache` (a Map, see fillKey): an area filled before from the very same pixels, mask and
 * surface is not filled again — prefillPage() fills a page's areas while its translation is on the
 * way, and finishPage() then finds them there. A changed input is a new key, so the cache can
 * only ever save time, never change a result.
 * @returns {Promise<{mat: any|null, kind: "tone"|"learned"|"telea", ms: number, hit?: boolean}>} ms: the time it took
 */
/**
 * Thrown by a model function (see fillArea) whose model isn't loaded yet, for a caller that
 * would rather leave the area for later than wait for the load (prefillPage). fillTexture() then
 * skips that area (`filled: "later"`, nothing cached) and goes on with the next.
 */
export class NotLoaded extends Error {}

export async function fillArea(cv, model, rgb, hole, source, opts = {}) {
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
  const key = opts.cache ? fillKey(rgb, hole, source, opts.margin, opts.context) : null;
  const had = key && opts.cache.get(key);
  if (had) {
    const mat = had.data ? cv.matFromArray(had.rows, had.cols, had.type, had.data) : null;
    return { mat, kind: had.kind, ms: ms(), hit: true };
  }
  const done = await fillAreaNow(cv, model, rgb, hole, source, opts);
  if (key) opts.cache.set(key, { kind: done.kind, ms: done.ms ?? ms(), ...(done.mat ? { data: new Uint8Array(done.mat.data), rows: done.mat.rows, cols: done.mat.cols, type: done.mat.type() } : {}) });
  return { ...done, ms: ms() };
}

async function fillAreaNow(cv, model, rgb, hole, source, opts) {
  const tone = latticeFill(cv, rgb, hole, source, opts);
  if (tone) return { mat: tone, kind: "tone" };
  // (the model may be given as a function that loads it: then it is loaded only when an area needs it)
  const m = typeof model === "function" ? await model() : model;
  if (m) {
    try { const mat = await aotInpaint(cv, m, rgb, hole, { context: opts.context }); return { mat, kind: "learned" }; }
    catch (e) { console.warn("Gytakusub: learned inpainting failed, using Telea", e); }
  }
  return { mat: null, kind: "telea" };
}

/**
 * What a fill depends on, as one string: the area's pixels, its mask, the surface it may copy
 * from, and the margin. Two 32-bit hashes over all of it (a wrong hit would need both to collide
 * on equal sizes) — a few milliseconds for a large area, against a fill's tens to hundreds.
 */
export function fillKey(rgb, hole, source, margin = 0, context = null) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  const eat = (d) => { for (let i = 0; i < d.length; i++) { const v = d[i]; a = Math.imul(a ^ v, 0x01000193); b = Math.imul(b ^ v, 0x5bd1e995) ^ (b >>> 15); } };
  eat(rgb.data); eat(hole.data); if (source) eat(source.data);
  if (context?.side) {
    // the page around the area that a model of one size sees (inpaint.js), and where the area sits in it
    const im = context.image, w = contextWindow(im.cols, im.rows, context.x, context.y, rgb.cols, rgb.rows, context.side);
    for (let y = w.y; y < w.y + w.h; y++) eat(im.data.subarray((y * im.cols + w.x) * 3, (y * im.cols + w.x + w.w) * 3));
    eat([context.x - w.x, context.y - w.y, w.w, w.h]);
  }
  return `${rgb.cols}x${rgb.rows}:${margin}:${source ? 1 : 0}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}

/**
 * The fill for erase()'s textured areas, at the size erase() worked at (pages analysed at their
 * own size, and the work copy): fillArea() on each, with some of the page around it, which both
 * fills need to continue the texture. Changes only masked pixels of `img`; notes on each area
 * how it was filled (`filled`) and how long that took (`fillMs`).
 * @param {any} model the learned inpainter (or a function resolving to it, or throwing NotLoaded to
 *   leave the areas that need it for later), or null (screentone fill, else Telea)
 * @param {{rois: any[], mask: any, surface?: any}} erased erase()'s answer with keepMask
 * @param {{cache?: Map<string, object>, checkpoint?: () => Promise<void>, side?: number}} [opts] cache: see
 *   fillArea; checkpoint: awaited before each area (it throws to stop); side: the learned inpainter's one
 *   input size, when it has one (LaMa): it then sees that much of the page around each area
 */
export async function fillTexture(cv, model, img, erased, opts = {}) {
  const textured = erased.rois.filter((r) => r.fill === "texture");
  if (!textured.length) return img;
  const W = img.width, H = img.height;
  const src = cv.matFromImageData(img), rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); src.delete();
  for (const r of textured) {
    if (opts.checkpoint) await opts.checkpoint(); // (prefillPage: a more urgent page may go first, or the answer has come)
    const m = contextMargin(r.letter);
    const x0 = Math.max(0, r.x - m), y0 = Math.max(0, r.y - m), x1 = Math.min(W, r.x + r.w + m), y1 = Math.min(H, r.y + r.h + m);
    const rect = new cv.Rect(x0, y0, x1 - x0, y1 - y0);
    const view = rgb.roi(rect), crop = view.clone(), hole = erased.mask.roi(rect).clone(); // continuous copies
    let on = null;
    if (erased.surface && r.label) { on = erased.surface.roi(rect).clone(); const od = on.data; for (let i = 0; i < od.length; i++) od[i] = od[i] === r.label ? 255 : 0; }
    try {
      if (cv.countNonZero(hole)) {
        const f = await fillArea(cv, model, crop, hole, on, { cache: opts.cache, context: opts.side ? { image: rgb, x: x0, y: y0, side: opts.side } : null });
        r.filled = f.kind; r.fillMs = f.ms; r.fillHit = !!f.hit;
        if (f.mat) { f.mat.copyTo(view); f.mat.delete(); }
      }
    } catch (e) {
      if (!(e instanceof NotLoaded)) throw e;
      r.filled = "later";
    } finally { view.delete(); crop.delete(); hole.delete(); on?.delete(); }
  }
  const out = new cv.Mat(); cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
  const result = new ImageData(new Uint8ClampedArray(out.data), W, H);
  rgb.delete(); out.delete();
  return result;
}

/** How much of the page around an area the texture fill sees: two letters, at least 24 px. */
export const contextMargin = (letter) => Math.max(24, Math.round((letter || 8) * 2));
