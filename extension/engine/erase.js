import { aotInpaint, contextWindow, copyOf } from "./inpaint.js";
import { owning } from "./owner.js";
import { latticeFill } from "./tone.js";
import { ERASE } from "./tuning.js";

// A surround is plain when 9 in 10 of its pixels lie within COLOUR_PLAIN of their median in every
// channel (JPEG noise and a gentle gradient do; screentone, hatching and art do not); there,
// lettering is what lies more than COLOUR_APART from it in some channel — black, white, or a
// coloured letter alike, and well clear of the surround's own spread. Anything less plain keeps
// to the polarity masks alone.
const COLOUR_PLAIN = ERASE.colourPlain, COLOUR_APART = ERASE.colourApart, PLAIN_SHARE = ERASE.plainShare;
// adopted lettering (layout.js) is erased only when this share of its line's ink is taken
const ADOPTED_TAKEN = ERASE.adoptedTaken;

/**
 * Telea's neighbourhood (px) for an area's lettering size: 0.3 letter, 3 at least and TELEA_MAX at
 * most. Its time grows about with the square of the radius: at 0.3 letter, a sound effect of 125 px
 * letters (radius 38) took 35.6 s on one area, holding the engine's thread meanwhile (Claude's
 * answers, the other pages), where 6 takes 1.1 s (2.14). 6 is what dialogue up to 20 px letters
 * always had. On textured areas Telea is the stand-in until fillTexture(), and stays only where
 * no learned model runs.
 */
export const TELEA_MAX = ERASE.teleaMax;
export const teleaRadius = (letter) => Math.min(TELEA_MAX, Math.max(ERASE.teleaMin, Math.round(letter * ERASE.teleaLetters)));

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
  return owning((own) => eraseRegions(cv, img, analysis, regionIds, opts, own));
}

function eraseRegions(cv, img, analysis, regionIds, opts, own) {
  const { W, H } = analysis;
  const src = own(cv.matFromImageData(img));
  const rgb = own(new cv.Mat()); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const mask = own(cv.Mat.zeros(H, W, cv.CV_8UC1));
  const md = mask.data;
  const rois = []; // {x,y,w,h,radius}

  const paintGlyph = (labels, lbl, g) => {
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) { const p = y * W + x; if (labels[p] === lbl) md[p] = 255; }
  };

  // Each mark's thickness: twice its distance transform's peak (its stroke's width where widest),
  // over the components `Lb` of a mask (w × h). Lettering is drawn with one pen: the pen of a line
  // is the thickness most of its own ink has (the components on its box, `core`, weighted by ink).
  // A mark swept up beside it as lettering (a dash, a long vowel mark, punctuation) is drawn with
  // that pen too; a stroke far thinner is something else — a panel's frame, an outline of a cloud,
  // screentone. Letter-sized thresholds alone could not tell: around brush lettering 158 px tall
  // (a title the bubble model took for a bubble, 3.0) every frame line and cloud near it was
  // "letter-sized" and was erased.
  const thicknessOf = (mask, Lb, n, w, h) => {
    const dist = own(new cv.Mat()); cv.distanceTransform(mask, dist, cv.DIST_L2, 3);
    const D = dist.data32F, t = new Float32Array(n);
    for (let i = 0; i < w * h; i++) { const l = Lb[i]; if (l && D[i] > t[l]) t[l] = D[i]; }
    dist.delete();
    for (let i = 1; i < n; i++) t[i] *= 2;
    return t;
  };
  // the pen of the marks on the line's boxes (`core`), from the components' stats
  const penAt = (S, n, thick, core) => {
    const marks = [];
    for (let i = 1; i < n; i++) {
      const cx = S[i * 5], cy = S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
      if (core.some((b) => cx < b.x + b.w && cx + cw > b.x && cy < b.y + b.h && cy + ch > b.y)) marks.push({ t: thick[i], a: S[i * 5 + 4] });
    }
    return penOf(marks);
  };

  // Learned analysis: the lettering is the ink inside each detected text box (grown
  // by a third of a letter across the lines and most of a letter along them, where
  // the detector tends to stop short of a last glyph), as connected components that
  // stay inside that window — an outline or a stroke of art crossing the window is
  // not a letter.
  // the extent of what the current region's lettering painted: the area to fill must hold all of it
  let painted = null;
  // the pens of the current region's lines (paintTextBox), and theirs as one: the median
  let pens = [];
  const regionPen = () => (pens.length ? pens.slice().sort((p, q) => p - q)[pens.length >> 1] : 0);
  const extend = (x0, y0, x1, y1) => { painted = painted ? { x0: Math.min(painted.x0, x0), y0: Math.min(painted.y0, y0), x1: Math.max(painted.x1, x1), y1: Math.max(painted.y1, y1) } : { x0, y0, x1, y1 }; };
  // The learned text mask (engine/textmask.js), in place of the rules below: what the model calls
  // lettering in each of the region's crops, as pieces (connected), inside the bubble's interior
  // for a bubble. Only a piece that reaches into the region's lines (its blocks' boxes and the
  // detector's lines in the crop), as the rules keep to marks reaching into the lettering's zone:
  // along the edge of a dark bubble the model sees a ring of lettering, away from the lines. Never
  // the bubble's outline where the interior takes it in (outlineOf), where the image's edge cutting a
  // bubble is no outline and its interior runs to that edge (interiorToEdge). True when it painted anything.
  // Nothing, and false, when it took a shape for lettering: when in a bubble it calls most of the
  // interior lettering (ERASE.modelBubbleShare), or when a piece is thicker than the detector's
  // lines under it are high (ERASE.modelThickLines). Lettering never fills its bubble, and a stroke
  // of it, outline and all, lies about within its line's box; the model takes a small dark bubble
  // whole for a glyph, read as a bubble or as free text.
  const piecesOf = (c, boxes) => {
    const m = own(cv.matFromArray(c.h, c.w, cv.CV_8UC1, c.mask)), lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(m, lab, st, ce, 8, cv.CV_32S);
    const thick = thicknessOf(m, lab.data32S, n, c.w, c.h), labels = Int32Array.from(lab.data32S), onLine = new Uint8Array(n);
    m.delete(); lab.delete(); st.delete(); ce.delete();
    for (const b of boxes) {
      const x0 = Math.max(0, Math.floor(b.x - c.x)), y0 = Math.max(0, Math.floor(b.y - c.y)), x1 = Math.min(c.w, Math.ceil(b.x + b.w - c.x)), y1 = Math.min(c.h, Math.ceil(b.y + b.h - c.y));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) onLine[labels[yy * c.w + xx]] = 1;
    }
    return { n, labels, thick, onLine };
  };
  const paintLearned = (crops, blocks, inside, dark) => {
    const pieces = crops.map((c) => {
      const lines = (analysis.lines || []).filter((l) => { const cx = l.x + l.w / 2, cy = l.y + l.h / 2; return cx >= c.x && cx < c.x + c.w && cy >= c.y && cy < c.y + c.h; });
      const P = piecesOf(c, blocks.flatMap((b) => b.parts || [b.gbox]).concat(lines));
      // (a region from a translated line's box alone has no detected lines: its lines' height as the
      // page's letter makes it, layout.js adoptLettering)
      P.across = Math.max(0, ...lines.map((l) => (l.vertical ? l.w : l.h)), ...blocks.map((b) => b.across || 0));
      return P;
    });
    // A region made from a translated line's box alone (layout.js adoptLettering): the box is all
    // that says where its lettering is. A piece lying mostly outside it is not that line's lettering
    // but what borders it, the outline of a bubble the bubble model missed or a stroke of art; a
    // piece mostly inside it is kept whole, as a reader's box may stop short of its line.
    const boxed = blocks.filter((b) => b.fromBox).map((b) => b.gbox);
    if (boxed.length) crops.forEach((c, k) => {
      const P = pieces[k], area = new Float64Array(P.n), held = new Float64Array(P.n);
      for (let yy = 0; yy < c.h; yy++) for (let xx = 0; xx < c.w; xx++) {
        const l = P.labels[yy * c.w + xx]; if (!l) continue;
        area[l]++; const X = c.x + xx, Y = c.y + yy;
        if (boxed.some((b) => X >= b.x && X < b.x + b.w && Y >= b.y && Y < b.y + b.h)) held[l]++;
      }
      for (let l = 1; l < P.n; l++) if (held[l] < ERASE.readerBoxShare * area[l]) P.onLine[l] = 0;
    });
    for (const P of pieces) if (P.across) for (let i = 1; i < P.n; i++) if (P.onLine[i] && P.thick[i] > ERASE.modelThickLines * P.across) return false;
    const keep = crops.map((c, k) => {
      const edge = inside ? outlineOf({ ...c, inside, dark, cut: true }, img.data, W) : null, P = pieces[k];
      return (xx, yy) => { const i = yy * c.w + xx, l = P.labels[i]; return l > 0 && P.onLine[l] && !(edge && edge[i]) && (!inside || inside(c.x + xx, c.y + yy)); };
    });
    if (inside) {
      let interior = 0, lettering = 0;
      crops.forEach((c, k) => { for (let yy = 0; yy < c.h; yy++) for (let xx = 0; xx < c.w; xx++) if (inside(c.x + xx, c.y + yy)) { interior++; if (keep[k](xx, yy)) lettering++; } });
      if (lettering > ERASE.modelBubbleShare * interior) return false;
    }
    let any = false;
    crops.forEach((c, k) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let yy = 0; yy < c.h; yy++) for (let xx = 0; xx < c.w; xx++) {
        if (!keep[k](xx, yy)) continue;
        const X = c.x + xx, Y = c.y + yy;
        md[Y * W + X] = 255;
        if (X < x0) x0 = X; if (Y < y0) y0 = Y; if (X > x1) x1 = X; if (Y > y1) y1 = Y;
      }
      if (x1 >= x0) { extend(x0, y0, x1 + 1, y1 + 1); any = true; }
    });
    return any;
  };
  const paintTextBox = (pols, b, letter, inside = null, withColour = true) => {
    pols = (Array.isArray(pols) ? pols : [pols]).filter(Boolean);
    const across = Math.max(ERASE.padAcrossMinPx, Math.round(letter * ERASE.padAcross)), along = Math.max(ERASE.padAlongMinPx, Math.round(letter * ERASE.padAlong));
    const padX = b.vertical ? across : along, padY = b.vertical ? along : across;
    const x0 = Math.max(0, b.gbox.x - padX), y0 = Math.max(0, b.gbox.y - padY), x1 = Math.min(W, b.gbox.x + b.gbox.w + padX), y1 = Math.min(H, b.gbox.y + b.gbox.h + padY);
    const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
    // the lettering is ink of its polarity, and — on a plain surround — whatever stands out from
    // that surround in colour, which is how coloured lettering is found (blue, orange: neither dark
    // nor light enough for the polarity masks). The colour window also takes in the detector's own
    // box for the line (`line`): the analysis sizes a line by its dark ink, which in a coloured
    // letter is a thin core.
    const paint = (ps, colourToo = true) => {
      const masks = [];
      for (const pol of ps) masks.push({ roi: own(pol.inkMask.roi(new cv.Rect(x0, y0, w, h))), x0, y0, w, h });
      if (withColour && colourToo) {
        const l = b.line, cx0 = Math.max(0, Math.min(x0, l ? Math.floor(l.x) : x0)), cy0 = Math.max(0, Math.min(y0, l ? Math.floor(l.y) : y0));
        const cx1 = Math.min(W, Math.max(x1, l ? Math.ceil(l.x + l.w) : x1)), cy1 = Math.min(H, Math.max(y1, l ? Math.ceil(l.y + l.h) : y1));
        const colour = colourLettering(cx0, cy0, cx1 - cx0, cy1 - cy0, inside);
        if (colour) masks.push({ roi: colour, x0: cx0, y0: cy0, w: cx1 - cx0, h: cy1 - cy0, colour: true });
      }
      for (const { roi, x0, y0, w, h, colour } of masks) {
        const lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
        const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
        const S = st.data32S, Lb = lab.data32S;
        const keep = new Uint8Array(n);
        // the line's own pen: the marks on its box
        const thick = thicknessOf(roi, Lb, n, w, h), pen = penAt(S, n, thick, [{ x: b.gbox.x - x0, y: b.gbox.y - y0, w: b.gbox.w, h: b.gbox.h }]);
        if (pen) pens.push(pen);
        for (let i = 1; i < n; i++) {
          const cx = S[i * 5], cy = S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
          // (not where the image's edge clipped the window: the image cuts a letter there, as where
          // a webtoon's images part, and the mark has crossed nothing)
          const touches = (cx <= 0 && x0 > 0) || (cy <= 0 && y0 > 0) || (cx + cw >= w && x0 + w < W) || (cy + ch >= h && y0 + h < H);
          // size across the line only: along it a mark may be long (a wave dash, a
          // long vowel mark in a column) and still be lettering — a stroke of art or
          // an outline crossing the window touches its edge instead
          // in a bubble, what stands apart in colour is lettering only wholly inside the interior (as in
          // paintBubbleColour): past the outline it is the art around the bubble, which the bubble's
          // own fill would paint over
          const X0 = x0 + cx, Y0 = y0 + cy;
          if (colour && inside && !(inside(X0 - 1, Y0 - 1) && inside(X0 + cw, Y0 - 1) && inside(X0 - 1, Y0 + ch) && inside(X0 + cw, Y0 + ch))) continue;
          // (a mark on the line's own box is its lettering whatever its pen: a typeface's thin strokes)
          const onBox = X0 < b.gbox.x + b.gbox.w && X0 + cw > b.gbox.x && Y0 < b.gbox.y + b.gbox.h && Y0 + ch > b.gbox.y;
          // a mark the image's edge cuts: how far it runs past the edge isn't seen, nor so whether it
          // is lettering by its pen and size (a stroke of art cut there passes both); only the line's
          // own box says it is
          const cut = (cx <= 0 && x0 === 0) || (cy <= 0 && y0 === 0) || (cx + cw >= w && x0 + w === W) || (cy + ch >= h && y0 + h === H);
          if (!touches && (b.vertical ? cw : ch) <= ERASE.markLetters * letter && (onBox || (!cut && ofPen(thick[i], pen)))) { keep[i] = 1; extend(X0, Y0, X0 + cw, Y0 + ch); }
        }
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const l = Lb[yy * w + xx]; if (l && keep[l]) md[(y0 + yy) * W + x0 + xx] = 255; }
        roi.delete(); lab.delete(); st.delete(); ce.delete();
      }
    };
    // Lettering the analysis had set aside (layout.js adoptLettering) is erased all or nothing: when
    // most of the ink on its line is not taken (outlined display lettering, a logo), the line stays
    // as it was — half a word and a smudge read worse than the original under the translation.
    if (!b.adopted) { paint(pols); return; }
    const saved = [];
    for (let yy = y0; yy < y1; yy++) saved.push(md.slice(yy * W + x0, yy * W + x1));
    const restore = () => saved.forEach((row, i) => md.set(row, (y0 + i) * W + x0));
    // the share of the line's ink (its polarity's, else what stands apart from the window's median) taken
    const g = b.gbox;
    const share = (ps) => {
      const Is = ps.map((P) => P.inkMask.data);
      const mid = Is.length ? null : (() => { const v = []; for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) { const p = (yy * W + xx) * 4; v.push((pix[p] + pix[p + 1] + pix[p + 2]) / 3); } v.sort((p, q) => p - q); return v[v.length >> 1]; })();
      let ink = 0, taken = 0;
      for (let yy = Math.max(0, g.y); yy < Math.min(H, g.y + g.h); yy++) for (let xx = Math.max(0, g.x); xx < Math.min(W, g.x + g.w); xx++) {
        const q = yy * W + xx, p = q * 4;
        if (Is.length ? !Is.some((d) => d[q]) : Math.abs((pix[p] + pix[p + 1] + pix[p + 2]) / 3 - mid) <= COLOUR_APART) continue;
        ink++; if (md[q]) taken++;
      }
      return ink ? taken / ink : 1;
    };
    // each polarity judged on its own ink (of unknown polarity, both are read: lettering found on
    // Claude's box), the colour with the first
    (pols.length ? pols.map((P) => [P]) : [[]]).forEach((t, k) => {
      for (let yy = y0; yy < y1; yy++) saved[yy - y0] = md.slice(yy * W + x0, yy * W + x1);
      paint(t, k === 0);
      if (share(t) < ADOPTED_TAKEN) restore();
    });
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
    if (rs.length < ERASE.ringSamples) return null;
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    const c = [med(rs), med(gs), med(bs)];
    let near = 0;
    for (let i = 0; i < rs.length; i++) if (Math.max(Math.abs(rs[i] - c[0]), Math.abs(gs[i] - c[1]), Math.abs(bs[i] - c[2])) <= COLOUR_PLAIN) near++;
    if (near < PLAIN_SHARE * rs.length) return null;
    const m = own(cv.Mat.zeros(h, w, cv.CV_8UC1)), d = m.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const p = ((y0 + yy) * W + x0 + xx) * 4;
      if (Math.max(Math.abs(pix[p] - c[0]), Math.abs(pix[p + 1] - c[1]), Math.abs(pix[p + 2] - c[2])) > COLOUR_APART) d[yy * w + xx] = 255;
    }
    return m;
  };

  // The zone a bubble's lettering lies in (bubbleZoneOf)
  const bubbleZone = (blocks, letter, inside) => bubbleZoneOf(analysis, blocks, letter, inside);
  // Marks of a mask over a bubble's box (`m`, w × h at x, y) that are the bubble's lettering: wholly
  // inside the interior (never the outline, nor art past it), reaching into the lettering's zone,
  // and letter-sized — or a stroke as thin as a letter, however long (a stretched long vowel mark,
  // a wave dash running past the detector's box). Painted into the page's mask.
  const keepLettering = (m, x, y, w, h, zone, letter, inside, e = 1, pen = 0, core = []) => {
    const lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(m, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S, Lb = lab.data32S, keep = new Uint8Array(n);
    const thick = pen ? thicknessOf(m, Lb, n, w, h) : null;
    for (let i = 1; i < n; i++) {
      const cx = x + S[i * 5], cy = y + S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
      // drawn with another pen (the lettering's: penOf), away from the lines' own boxes
      if (thick && !ofPen(thick[i], pen) && !core.some((g) => cx < g.x + g.w && cx + cw > g.x && cy < g.y + g.h && cy + ch > g.y)) continue;
      // not a letter (a drawing) — but a long stroke as thin as one is: a stretched long vowel mark
      const long = cw > ERASE.longLetters * letter || ch > ERASE.longLetters * letter;
      if (long && !(Math.min(cw, ch) <= ERASE.strokeLetters * letter && Math.max(cw, ch) <= ERASE.strokeSpan * Math.max(w, h))) continue;
      // wholly inside: the corners of its box, `e` pixels in from each, on the interior
      if (!(inside(cx - e, cy - e) && inside(cx + cw - 1 + e, cy - e) && inside(cx - e, cy + ch - 1 + e) && inside(cx + cw - 1 + e, cy + ch - 1 + e))) continue;
      // in the lettering's zone; a long stroke within one line's band, along it (the line's own
      // long vowel mark run past its box, never an arc of the outline that the zone reaches)
      if (long ? !zone.some((z) => (z.v ? ch > cw && cx >= z.x && cx + cw <= z.x + z.w : cw > ch && cy >= z.y && cy + ch <= z.y + z.h))
        : !zone.some((z) => cx < z.x + z.w && cx + cw > z.x && cy < z.y + z.h && cy + ch > z.y)) continue;
      keep[i] = 1; extend(cx, cy, cx + cw, cy + ch);
    }
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const l = Lb[yy * w + xx]; if (l && keep[l]) md[(y + yy) * W + x + xx] = 255; }
    lab.delete(); st.delete(); ce.delete();
  };

  // A bubble's surface colour when it is plain, else null (plainSurfaceOf)
  const plainSurface = (r, zone, inside) => plainSurfaceOf(img, r, zone, inside);

  // In a bubble with a plain surface: whatever stands out from the surface near the lettering, in
  // marks wholly inside the interior. The text detector finds a line of coloured (or faint) lettering,
  // but the analysis sizes it by its dark ink, which in a blue or orange letter is a thin core; this
  // takes the whole letter. Marks touching the interior's edge (the outline) and specks far from the
  // text (decoration) stay.
  const paintBubbleColour = (r, blocks, letter, inside) => {
    const { x, y, w, h } = r.box;
    if (w < ERASE.minBoxPx || h < ERASE.minBoxPx) return;
    const zone = bubbleZone(blocks, letter, inside), c = plainSurface(r, zone, inside);
    if (!c) return; // the surface is not one colour: tone, a gradient, art
    const m = own(cv.Mat.zeros(h, w, cv.CV_8UC1)), d = m.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const X = x + xx, Y = y + yy, p = (Y * W + X) * 4;
      if (inside(X, Y) && Math.max(Math.abs(pix[p] - c[0]), Math.abs(pix[p + 1] - c[1]), Math.abs(pix[p + 2] - c[2])) > COLOUR_APART) d[yy * w + xx] = 255;
    }
    keepLettering(m, x, y, w, h, zone, letter, inside, 1, regionPen(), blocks.map((b) => b.gbox));
    m.delete();
  };

  // In any bubble: the lettering's own ink (its polarity's mask), by the same rule. A detected line
  // is erased within a window around its box, and a mark running past the window (a long dash, a
  // wave dash, the tail of a column the detector stopped short of) was taken for art and left, the
  // part of the line most often still seen after erasing on researcher-marked pages (2.14.2).
  // Only in a plain bubble, where every mark near the lettering is lettering: a "bubble" over art (a
  // title over foliage the bubble model took for one) holds strokes of the art in its zone.
  const paintBubbleInk = (P, r, blocks, letter, inside) => {
    const { x, y, w, h } = r.box;
    if (w < ERASE.minBoxPx || h < ERASE.minBoxPx || !P) return;
    const zone = bubbleZone(blocks, letter, inside);
    if (!plainSurface(r, zone, inside)) return;
    // its own ink only that far from the interior's edge which the outline's would be (an interior
    // drawn a little past the outline holds pieces of it)
    const roi = own(P.inkMask.roi(new cv.Rect(x, y, w, h)));
    keepLettering(roi, x, y, w, h, zone, letter, inside, Math.max(ERASE.keepDepthMinPx, Math.round(ERASE.keepDepthLetters * letter)), regionPen(), blocks.map((b) => b.gbox));
    roi.delete();
  };

  // A bubble the segmentation model found but the text detector left empty: the
  // lettering is whatever letter-sized ink lies wholly inside the mask.
  const paintInsideMask = (pol, b, letter) => {
    const { x, y, w, h } = b.box, m = b.fill;
    const roi = own(pol.inkMask.roi(new cv.Rect(x, y, w, h))), lab = own(new cv.Mat()), st = own(new cv.Mat()), ce = own(new cv.Mat());
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S, Lb = lab.data32S, keep = new Uint8Array(n);
    for (let i = 1; i < n; i++) {
      const cx = S[i * 5], cy = S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
      if (ch > ERASE.longLetters * letter || cw > ERASE.strokeSpan * w) continue;
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
      const letter = Math.max(ERASE.minLetterPx, r.letter);
      const blocks = r.kind === "bubble" ? r.ref.blocks : [r.ref];
      let roi;
      painted = null; pens = [];
      // the learned text mask where it was run and saw lettering in the region's crops; the rules
      // where it saw none (they find what they found before it)
      const learned = opts.textMasks ? opts.textMasks.filter((c) => c.region === r.id) : null;
      const toEdge = inside && learned?.length ? interiorToEdge(inside, r.ref.cell, W, H) : null;
      const byModel = !!(blocks.length && learned?.length && paintLearned(learned, blocks, toEdge, r.dark));
      // a region from a translated line's box alone: only what the mask found there (layout.js adoptLettering)
      if (!byModel && blocks.length && !r.fromBox) {
        // Free text: line by line (`parts`, the detected lines a paragraph was merged from), not
        // the paragraph's whole box: lines chained across a picture make a box that holds the art
        // between them, and every small stroke in it would pass for lettering.
        for (const b of blocks) {
          if (r.kind !== "bubble" && b.parts) b.parts.forEach((g, i) => paintTextBox(pols, { ...b, gbox: g, line: b.lineBoxes?.[i], adopted: !!b.lineAdopted?.[i] }, b.lineLetters?.[i] || b.letter || letter, null, true));
          else paintTextBox(pols, b, b.letter || letter, inside, true);
        }
        if (inside) {
          pols.forEach((P) => paintBubbleInk(P, r, blocks, letter, inside));
          paintBubbleColour(r, blocks, letter, inside);
          // and along each of the detector's lines in the bubble, its window's own surround: a
          // coloured line the analysis sized by its dark core (or dropped) is read whole there,
          // even when speed lines or tone elsewhere in the bubble leave the bubble as a whole not plain
          for (const l of analysis.lines || []) {
            if (!inside(l.x + l.w / 2, l.y + l.h / 2)) continue;
            const g = { x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) };
            paintTextBox(null, { gbox: g, line: g, vertical: !!l.vertical }, Math.max(letter, ERASE.lineLetter * (l.vertical ? g.w : g.h)), inside, true);
          }
        }
      }
      if (r.fromBox && !byModel) continue; // (nothing the mask found: nothing to fill)
      if (blocks.length) {
        const pad = Math.round(letter * ERASE.fillPad);
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
      if (r.kind === "bubble") rois.push({ ...roi, radius: ERASE.bubbleRadius, inside: byModel ? toEdge : analysis.insideOf(r.id), dark: r.dark, letter, byModel });
      else rois.push({ ...roi, radius: teleaRadius(letter), letter, byModel });
      continue;
    }
    const glyphLabels = pol.glyphLabels.data32S, regionLabels = pol.regionLabels.data32S;
    const letter = Math.max(ERASE.minLetterPx, r.letter);
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
        if (g.a > ERASE.glyphArea * b.area || g.h > ERASE.glyphLetters * letter || !nearText(g)) continue;
        // adjacent to the bubble surface?
        const cx = g.x + (g.w >> 1), cy = g.y + (g.h >> 1), d = 2;
        const near = [[g.x - d, cy], [g.x + g.w + d, cy], [cx, g.y - d], [cx, g.y + g.h + d]].some(([sx, sy]) => sx >= 0 && sy >= 0 && sx < W && sy < H && regionLabels[sy * W + sx] === b.labelId);
        if (near) seen.add(gi);
      }
      // the inpaint ROI is the lettering's neighbourhood, not the whole shape
      const tx0 = Math.max(x, Math.min(...b.blocks.map((bl) => bl.gbox.x)) - 2 * letter), ty0 = Math.max(y, Math.min(...b.blocks.map((bl) => bl.gbox.y)) - 2 * letter);
      const tx1 = Math.min(x + w, Math.max(...b.blocks.map((bl) => bl.gbox.x + bl.gbox.w)) + 2 * letter), ty1 = Math.min(y + h, Math.max(...b.blocks.map((bl) => bl.gbox.y + bl.gbox.h)) + 2 * letter);
      for (const gi of seen) paintGlyph(glyphLabels, gi, pol.glyphs[gi]);
      rois.push({ x: Math.round(tx0), y: Math.round(ty0), w: Math.max(1, Math.round(tx1 - tx0)), h: Math.max(1, Math.round(ty1 - ty0)), radius: ERASE.bubbleRadius, inside: analysis.insideOf(r.id), dark: r.dark });
    } else {
      const bl = r.ref, { x, y, w, h } = bl.box;
      for (const gi of bl.glyphs) paintGlyph(glyphLabels, gi, pol.glyphs[gi]);
      const pad = Math.round(letter * ERASE.fillPad);
      rois.push({ x: Math.max(0, x - pad), y: Math.max(0, y - pad), w: Math.min(W, x + w + pad) - Math.max(0, x - pad), h: Math.min(H, y + h + pad) - Math.max(0, y - pad), radius: teleaRadius(letter) });
    }
  }

  if (rois.length) {
    // Grow the mask over the anti-aliased fringe of each stroke; inside bubbles
    // never past the bubble's interior (so outlines stay crisp).
    const grow = Math.max(ERASE.fringeMinPx, Math.round(analysis.letter * ERASE.fringeLetters));
    const k = own(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * grow + 1, 2 * grow + 1)));
    const grown = own(new cv.Mat()); cv.dilate(mask, grown, k); k.delete();
    const gd = grown.data, px = img.data;
    for (const r of rois) {
      // (in a bubble the learned mask painted, not over its outline where the interior takes it
      // in either: the fringe of lettering run close to a burst's spikes took them)
      if (r.byModel && r.inside) r.edge = outlineOf({ ...r, cut: true }, px, W);
      const edge = r.byModel ? r.edge : null;
      for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
        const p = yy * W + xx;
        if (!gd[p] || md[p] || (edge && edge[(yy - r.y) * r.w + xx - r.x])) continue;
        if (r.inside && !r.inside(xx, yy)) {
          // Not bubble surface: admit the anti-aliased fringe of a stroke, never
          // the outline itself (solid ink of the bubble's own colour polarity).
          const lum = (px[p * 4] + px[p * 4 + 1] + px[p * 4 + 2]) / 3;
          if (r.dark ? lum > ERASE.outlineLight : lum < ERASE.outlineDark) continue;
        }
        md[p] = 255;
      }
    }
    grown.delete();
    if (opts.outline) {
      // A bubble's outline, where the interior takes it in: ink of the outline's colour joined to
      // the interior's edge. A bubble whose surface (the interior less that) is flat keeps it out of
      // growOutline, and is filled flat below.
      for (const r of rois) {
        if (!r.inside) continue;
        r.edge = r.edge || outlineOf(r, px, W);
        const rect = new cv.Rect(r.x, r.y, r.w, r.h), rc = own(copyOf(rgb, rect)), mc = own(copyOf(mask, rect));
        r.flat = flatSurface(rc, mc, (x, y) => r.inside(r.x + x, r.y + y) && !r.edge[y * r.w + x]);
        rc.delete(); mc.delete();
      }
      growOutline(cv, mask, rois, W, opts.outline);
    }
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
      const srcRoi = own(rgb.roi(rect)), maskRoi = own(mask.roi(rect));
      // How the area is filled: a flat surface (most white bubbles) takes its own colour, exactly;
      // anything else (screentone, gradients, art) is "texture", filled by fillTexture() (the
      // screentone fill where the surface is a lattice, else the learned inpainter, else Telea)
      // and given Telea meanwhile.
      const rc = own(srcRoi.clone()), mc = own(maskRoi.clone()); // continuous copies to read
      // (a bubble found flat before the growth stays flat: the outline ink the growth left alone
      // would otherwise read as texture, and Telea smeared it into the bubble)
      const flat = r.flat || flatSurface(rc, mc, r.inside ? (x, y) => r.inside(r.x + x, r.y + y) : null);
      rc.delete(); mc.delete();
      if (flat) { r.fill = "flat"; r.color = flat; srcRoi.setTo(new cv.Scalar(flat[0], flat[1], flat[2]), maskRoi); }
      else {
        r.fill = "texture";
        const dst = own(new cv.Mat());
        cv.inpaint(srcRoi, maskRoi, dst, r.radius, cv.INPAINT_TELEA);
        dst.copyTo(srcRoi); dst.delete();
      }
      srcRoi.delete(); maskRoi.delete();
    }
  }

  const out = own(new cv.Mat()); cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
  const result = new ImageData(new Uint8ClampedArray(out.data), W, H);
  src.delete(); rgb.delete(); out.delete();
  if (opts.keepMask) {
    // Each textured bubble's surface (its interior, as far around the area as the fill looks),
    // labelled with the area's number: the screentone fill copies only from there, never from the
    // outline or the art outside.
    const surface = own(cv.Mat.zeros(H, W, cv.CV_8UC1)), sd = surface.data;
    rois.forEach((r, i) => {
      if (r.fill !== "texture" || !r.inside || i >= 254) return;
      r.label = i + 1;
      const m = contextMargin(r.letter);
      for (let yy = Math.max(0, r.y - m); yy < Math.min(H, r.y + r.h + m); yy++) for (let xx = Math.max(0, r.x - m); xx < Math.min(W, r.x + r.w + m); xx++) if (r.inside(xx, yy)) sd[yy * W + xx] = r.label;
    });
    return { image: result, rois: rois.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, radius: r.radius, fill: r.fill, color: r.color, letter: r.letter, label: r.label || 0 })), mask: own.keep(mask), surface: own.keep(surface) };
  }
  mask.delete();
  return { image: result, rois: rois.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) };
}

/**
 * The zone a bubble's lettering lies in: its lines as the analysis sized them and as the detector
 * boxed them (a coloured line it sized by its dark core, or dropped for having none, is still the
 * detector's), each grown by a letter.
 */
function bubbleZoneOf(analysis, blocks, letter, inside) {
  const cxIn = (l) => inside(l.x + l.w / 2, l.y + l.h / 2);
  const lines = blocks.flatMap((b) => [b.gbox, b.line, ...(b.lineBoxes || [])]).concat((analysis.lines || []).filter(cxIn)).filter(Boolean);
  return lines.map((b) => ({ x: b.x - letter, y: b.y - letter, w: b.w + 2 * letter, h: b.h + 2 * letter, v: b.vertical ?? b.h > b.w }));
}

/**
 * A bubble's surface colour when it is plain (the interior away from its edge and from the
 * lettering's zone, nearly all one colour), else null: tone, a gradient, or art taken for a bubble.
 */
function plainSurfaceOf(img, r, zone, inside) {
  const { width: W, data: pix } = img, { x, y, w, h } = r.box;
  const inZone = (xx, yy) => zone.some((z) => xx >= z.x && xx < z.x + z.w && yy >= z.y && yy < z.y + z.h);
  const e = ERASE.depthPx, deep = (xx, yy) => inside(xx, yy) && inside(xx - e, yy) && inside(xx + e, yy) && inside(xx, yy - e) && inside(xx, yy + e);
  const rs = [], gs = [], bs = [];
  for (let yy = y; yy < y + h; yy += 2) for (let xx = x; xx < x + w; xx += 2) if (deep(xx, yy) && !inZone(xx, yy)) { const p = (yy * W + xx) * 4; rs.push(pix[p]); gs.push(pix[p + 1]); bs.push(pix[p + 2]); }
  if (rs.length < ERASE.surfaceSamples) return null;
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  const c = [med(rs), med(gs), med(bs)];
  let near = 0;
  for (let i = 0; i < rs.length; i++) if (Math.max(Math.abs(rs[i] - c[0]), Math.abs(gs[i] - c[1]), Math.abs(bs[i] - c[2])) <= COLOUR_PLAIN) near++;
  return near >= PLAIN_SHARE * rs.length ? c : null;
}

/**
 * Whether a region is a bubble with a plain surface, whose lettering the rules find whole: by its
 * polarity, and by its colour against that surface. The learned text mask is run on the rest
 * (engine/textmask.js textCrops).
 * @param {ImageData} img the slice @param {object} analysis @param {object} r a region of it
 */
export function plainBubble(img, analysis, r) {
  const inside = r.kind === "bubble" ? analysis.insideOf?.(r.id) : null;
  if (!inside || !r.ref?.blocks?.length) return false;
  return !!plainSurfaceOf(img, r, bubbleZoneOf(analysis, r.ref.blocks, Math.max(ERASE.minLetterPx, r.letter), inside), inside);
}

/**
 * A line's pen: the thickness (`t`) most of the ink (`a`) of its marks has, the median weighted by
 * ink; 0 with no marks.
 * @param {Array<{t:number,a:number}>} marks
 */
export function penOf(marks) {
  if (!marks.length) return 0;
  const xs = marks.slice().sort((p, q) => p.t - q.t);
  let half = xs.reduce((s, m) => s + m.a, 0) / 2;
  for (const m of xs) if ((half -= m.a) <= 0) return m.t;
  return xs[xs.length - 1].t;
}
/** A mark `t` thick is drawn with pen `pen` unless far thinner; a pen of a few pixels judges nothing. */
export const ofPen = (t, pen) => !(pen * ERASE.penShare >= ERASE.penMinPx && t < pen * ERASE.penShare);

/**
 * A bubble's interior as the learned text mask's areas take it: where the bubble model's interior
 * (`cell`: one of the model's input pixels, in the slice's) stops no further than `cell` pixels short
 * of the image's edge, it runs on to that edge, a gap the model cannot tell from none. Where the
 * image cuts a bubble, the model's box stops a pixel or two short of it, and the lettering the cut
 * runs by with it. Each pixel of the gap is inside where the interior is just past the gap. An
 * interior found from the pixels themselves (no `cell`) as it is.
 */
export function interiorToEdge(inside, cell, W, H) {
  const k = Math.floor(cell || 0);
  if (!(k > 0)) return inside;
  return (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    if (inside(x, y)) return true;
    const xi = x < k ? k : x >= W - k ? W - 1 - k : x, yi = y < k ? k : y >= H - k ? H - 1 - k : y;
    return (xi !== x || yi !== y) && inside(xi, yi);
  };
}

/**
 * The bubble's outline inside an area, where the bubble's interior takes it in: ink of the
 * outline's colour (dark in a light bubble, light in a dark one) joined, through such ink, to the
 * interior's edge. Lettering run into the outline joins it. A Uint8Array over the area (1: outline).
 * With `r.cut` (the learned mask's areas): not from the image's edge, which cuts a bubble and is no
 * line drawn round it; lettering the cut runs by is no outline, and an outline the cut runs by still
 * joins the rest of its ring.
 */
function outlineOf(r, px, W) {
  const { x: X, y: Y, w, h } = r, ink = new Uint8Array(w * h), edge = new Uint8Array(w * h), stack = [], H = px.length / 4 / W;
  // past the interior there (gx, gy); with `r.cut`, on the image
  const out = r.cut ? (gx, gy) => gx >= 0 && gy >= 0 && gx < W && gy < H && !r.inside(gx, gy) : (gx, gy) => !r.inside(gx, gy);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = X + x, gy = Y + y;
    if (!r.inside(gx, gy)) continue;
    const p = (gy * W + gx) * 4, lum = (px[p] + px[p + 1] + px[p + 2]) / 3;
    if (r.dark ? lum <= ERASE.outlineLight : lum >= ERASE.outlineDark) continue;
    const i = y * w + x;
    ink[i] = 1;
    if (out(gx - 1, gy) || out(gx + 1, gy) || out(gx, gy - 1) || out(gx, gy + 1)) { edge[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy, j = yy * w + xx;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !ink[j] || edge[j]) continue;
      edge[j] = 1; stack.push(j);
    }
  }
  return edge;
}

/**
 * Grows each area's mask over the lettering's outline (a white stroke around black letters, a
 * dark one around white letters, the glow of a shout): by `k` × the area's letter size, which is
 * how thick lettering outlines run, and never past a bubble's interior, so the bubble's own
 * outline stays. The fill (flat or texture) then covers the outline too; Telea alone smeared it.
 * In a bubble with a flat surface (`flat`) it never takes the bubble's outline (`edge`,
 * outlineOf): the interior the bubble model gives takes in its outline, and the growth, set by the
 * letter size, reached it wherever lettering ran close. On tone or art, ink at the interior's edge
 * is the surface too, and the growth takes it as before: leaving it in pieces, the fill smeared it.
 * Not an area the learned text mask painted (`byModel`): its mask takes in a lettering's outline
 * whole (tests/textmask.test.mjs), and grown by a letter size the analysis may have got wrong (a
 * dark bubble read as free text 53 px tall where its letters were 21), the area spread over the
 * art beside it.
 */
function growOutline(cv, mask, rois, W, k) {
  return owning((own) => {
    for (const r of rois) {
      if (r.byModel) continue;
      const g = Math.max(1, Math.round((r.letter || ERASE.defaultLetter) * k));
      const sub = own(mask.roi(new cv.Rect(r.x, r.y, r.w, r.h))), m = own(sub.clone()), grown = own(new cv.Mat()); // clones: continuous rows
      const kern = own(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * g + 1, 2 * g + 1)));
      cv.dilate(m, grown, kern); kern.delete();
      const gd = grown.data, md = m.data;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = y * r.w + x;
        if (!gd[i] || md[i] || (r.inside && !r.inside(r.x + x, r.y + y)) || (r.flat && r.edge[i])) continue;
        md[i] = 255;
      }
      m.copyTo(sub);
      grown.delete(); m.delete(); sub.delete();
    }
  });
}

/**
 * The colour of the area's surface when it is flat (a white or plain bubble), else null.
 * Measured on the area's unmasked pixels, and for a bubble only those at least 3 px inside its
 * interior (the interior's edge carries bits of outline). Flat = nearly all of them sit at one
 * level (within 8 of the median: JPEG noise), so a few stray marks don't make a white bubble
 * "textured", while screentone (dots on a quarter or more of it) or a gradient is not flat.
 */
export function flatSurface(rgb, mask, inside) {
  const d = rgb.data, md = mask.data, w = rgb.cols, h = rgb.rows, e = ERASE.depthPx;
  const lums = [], rs = [], gs = [], bs = [];
  const deep = inside ? (x, y) => inside(x, y) && inside(x - e, y) && inside(x + e, y) && inside(x, y - e) && inside(x, y + e) : () => true;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (md[y * w + x] || !deep(x, y)) continue;
    const p = (y * w + x) * 3;
    lums.push((d[p] + d[p + 1] + d[p + 2]) / 3); rs.push(d[p]); gs.push(d[p + 1]); bs.push(d[p + 2]);
  }
  if (lums.length < ERASE.surfaceSamples) return null;
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const m = med(lums);
  const atLevel = lums.filter((l) => Math.abs(l - m) <= ERASE.flatLevel).length / lums.length;
  if (atLevel < ERASE.flatShare) return null;
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
export function eraseFullSize(cv, natural, nx, ny, mask, scale, ox, oy, area = {}, model = null, surface = null, cache = null, context = null) {
  return owning((own) => eraseArea(cv, natural, nx, ny, mask, scale, ox, oy, area, model, surface, cache, context, own));
}

async function eraseArea(cv, natural, nx, ny, mask, scale, ox, oy, area, model, surface, cache, context, own) {
  const W = natural.width, H = natural.height;
  const M = own(cv.matFromArray(2, 3, cv.CV_64F, [scale, 0, (nx - ox + 0.5) * scale - 0.5, 0, scale, (ny - oy + 0.5) * scale - 0.5]));
  const m = own(new cv.Mat());
  cv.warpAffine(mask, m, M, new cv.Size(W, H), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
  // a quarter of a work pixel's coverage counts: the work mask was already grown over each stroke's fringe
  cv.threshold(m, m, ERASE.fullSizeCut, 255, cv.THRESH_BINARY);
  if (!cv.countNonZero(m)) { M.delete(); m.delete(); return null; }
  let on = null;
  if (surface && area.label) {
    on = own(new cv.Mat());
    cv.warpAffine(surface, on, M, new cv.Size(W, H), cv.INTER_NEAREST | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
    const od = on.data; for (let i = 0; i < od.length; i++) od[i] = od[i] === area.label ? 255 : 0;
  }
  M.delete();
  const src = own(cv.matFromImageData(natural)), rgb = own(new cv.Mat()), out = own(new cv.Mat());
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  let done = null;
  if (area.fill === "flat" && area.color) { done = own(rgb.clone()); done.setTo(new cv.Scalar(area.color[0], area.color[1], area.color[2]), m); }
  else if (area.fill === "texture") {
    let f;
    // (context: the full-size page around the patch, for a model of one size; see fillTexture)
    let ctx = null;
    const at = Date.now(); // (when it started: the debug report's timeline)
    if (context) { const c = own(cv.matFromImageData(context.image)); ctx = { image: own(new cv.Mat()), x: context.x, y: context.y, side: context.side }; cv.cvtColor(c, ctx.image, cv.COLOR_RGBA2RGB); c.delete(); }
    try { f = await fillArea(cv, model, rgb, m, on, { margin: Math.ceil(2 / scale), cache, context: ctx }); }
    catch (e) { ctx?.image.delete(); src.delete(); rgb.delete(); out.delete(); m.delete(); on?.delete(); throw e; } // (NotLoaded: the caller leaves it for later)
    ctx?.image.delete();
    done = own(f.mat); area.filled = f.kind; area.fillMs = f.ms; area.fillRunMs = f.runMs; area.fillAt = at; area.fillHit = !!f.hit; area.fillMiss = f.miss;
  }
  if (!done) { done = own(new cv.Mat()); cv.inpaint(rgb, m, done, Math.min(TELEA_MAX, Math.max(ERASE.teleaMin, Math.round((area.radius || ERASE.teleaMin) / scale))), cv.INPAINT_TELEA); }
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
 * @returns {Promise<{mat: any|null, kind: "tone"|"learned"|"telea", ms: number, runMs?: number, hit?: boolean}>} ms: the time it
 *   took; runMs: the learned model's own run within it
 */
/**
 * Thrown by a model function (see fillArea) whose model isn't loaded yet, for a caller that
 * would rather leave the area for later than wait for the load (prefillPage). fillTexture() then
 * skips that area (`filled: "later"`, nothing cached) and goes on with the next.
 */
export class NotLoaded extends Error {}

export function fillArea(cv, model, rgb, hole, source, opts = {}) {
  return owning((own) => fillOne(cv, model, rgb, hole, source, opts, own));
}

async function fillOne(cv, model, rgb, hole, source, opts, own) {
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
  const key = opts.cache ? fillKey(rgb, hole, source, opts.margin, opts.context) : null;
  const had = key && opts.cache.get(key);
  if (had) {
    const mat = had.data ? own(cv.matFromArray(had.rows, had.cols, had.type, had.data)) : null;
    return { mat: own.keep(mat), kind: had.kind, ms: ms(), hit: true };
  }
  // A miss where the page filled ahead (prefillPage) had this very area, only with other pixels
  // around it ("around"), or not ("area"): the debug report says which. On 6 of 14 pages with
  // fills both ahead and after the answer, none done ahead was used (2.13.1), and nothing said why.
  const areaKey = key && opts.context?.side ? "area:" + fillKey(rgb, hole, source, opts.margin) : null;
  const miss = key ? (areaKey && opts.cache.has(areaKey) ? "around" : "area") : undefined;
  const done = await fillAreaNow(cv, model, rgb, hole, source, opts); own(done.mat);
  if (key) opts.cache.set(key, { kind: done.kind, ms: done.ms ?? ms(), runMs: done.runMs, ...(done.mat ? { data: new Uint8Array(done.mat.data), rows: done.mat.rows, cols: done.mat.cols, type: done.mat.type() } : {}) });
  if (areaKey) opts.cache.set(areaKey, true);
  return { ...done, mat: own.keep(done.mat), ms: ms(), ...(miss ? { miss } : {}) };
}

async function fillAreaNow(cv, model, rgb, hole, source, opts) {
  const tone = latticeFill(cv, rgb, hole, source, opts);
  if (tone) return { mat: tone, kind: "tone" };
  // (the model may be given as a function that loads it: then it is loaded only when an area needs it)
  const m = typeof model === "function" ? await model() : model;
  if (m) {
    try { const timing = {}; const mat = await aotInpaint(cv, m, rgb, hole, { context: opts.context, timing }); return { mat, kind: "learned", runMs: timing.run }; }
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
export function fillTexture(cv, model, img, erased, opts = {}) {
  return owning((own) => fillTextured(cv, model, img, erased, opts, own));
}

async function fillTextured(cv, model, img, erased, opts, own) {
  const textured = erased.rois.filter((r) => r.fill === "texture");
  if (!textured.length) return img;
  const W = img.width, H = img.height;
  const src = own(cv.matFromImageData(img)), rgb = own(new cv.Mat()); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); src.delete();
  for (const r of textured) {
    if (opts.checkpoint) await opts.checkpoint(); // (prefillPage: a more urgent page may go first, or the answer has come)
    const m = contextMargin(r.letter);
    const x0 = Math.max(0, r.x - m), y0 = Math.max(0, r.y - m), x1 = Math.min(W, r.x + r.w + m), y1 = Math.min(H, r.y + r.h + m);
    const rect = new cv.Rect(x0, y0, x1 - x0, y1 - y0);
    const view = own(rgb.roi(rect)), crop = own(view.clone()), hole = own(copyOf(erased.mask, rect)); // continuous copies
    let on = null;
    if (erased.surface && r.label) { on = own(copyOf(erased.surface, rect)); const od = on.data; for (let i = 0; i < od.length; i++) od[i] = od[i] === r.label ? 255 : 0; }
    try {
      if (cv.countNonZero(hole)) {
        const at = Date.now();
        const f = await fillArea(cv, model, crop, hole, on, { cache: opts.cache, context: opts.side ? { image: rgb, x: x0, y: y0, side: opts.side } : null });
        r.filled = f.kind; r.fillMs = f.ms; r.fillRunMs = f.runMs; r.fillAt = at; r.fillHit = !!f.hit; r.fillMiss = f.miss;
        if (f.mat) { own(f.mat).copyTo(view); f.mat.delete(); }
      }
    } catch (e) {
      if (!(e instanceof NotLoaded)) throw e;
      r.filled = "later";
    } finally { view.delete(); crop.delete(); hole.delete(); on?.delete(); }
  }
  const out = own(new cv.Mat()); cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
  const result = new ImageData(new Uint8ClampedArray(out.data), W, H);
  rgb.delete(); out.delete();
  return result;
}

/** How much of the page around an area the texture fill sees: two letters, at least 24 px. */
export const contextMargin = (letter) => Math.max(ERASE.contextMinPx, Math.round((letter || ERASE.defaultLetter) * ERASE.contextLetters));
