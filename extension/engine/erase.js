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
 * @param {{keepMask?: boolean}} [opts] keepMask: also return the inpainting mask (a cv.Mat the caller
 *   deletes) and each area's radius, so the same areas can be inpainted again at the page's full size
 * @returns {{image: ImageData, rois: Array<{x:number,y:number,w:number,h:number,radius?:number}>, mask?: any}} cleaned page and the areas that changed
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
  const paintTextBox = (pol, b, letter) => {
    const across = Math.max(2, Math.round(letter * 0.35)), along = Math.max(3, Math.round(letter * 0.7));
    const padX = b.vertical ? across : along, padY = b.vertical ? along : across;
    const x0 = Math.max(0, b.gbox.x - padX), y0 = Math.max(0, b.gbox.y - padY), x1 = Math.min(W, b.gbox.x + b.gbox.w + padX), y1 = Math.min(H, b.gbox.y + b.gbox.h + padY);
    const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
    const roi = pol.inkMask.roi(new cv.Rect(x0, y0, w, h)), lab = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
    const n = cv.connectedComponentsWithStats(roi, lab, st, ce, 8, cv.CV_32S);
    const S = st.data32S, Lb = lab.data32S;
    const keep = new Uint8Array(n);
    for (let i = 1; i < n; i++) {
      const cx = S[i * 5], cy = S[i * 5 + 1], cw = S[i * 5 + 2], ch = S[i * 5 + 3];
      const touches = cx <= 0 || cy <= 0 || cx + cw >= w || cy + ch >= h;
      // size across the line only: along it a mark may be long (a wave dash, a
      // long vowel mark in a column) and still be lettering — a stroke of art or
      // an outline crossing the window touches its edge instead
      if (!touches && (b.vertical ? cw : ch) <= 2.5 * letter) keep[i] = 1;
    }
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const l = Lb[yy * w + xx]; if (l && keep[l]) md[(y0 + yy) * W + x0 + xx] = 255; }
    roi.delete(); lab.delete(); st.delete(); ce.delete();
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
      const letter = Math.max(4, r.letter);
      const blocks = r.kind === "bubble" ? r.ref.blocks : [r.ref];
      let roi;
      if (blocks.length) {
        for (const b of blocks) paintTextBox(pol, b, b.letter || letter);
        const pad = Math.round(letter * 0.8);
        const tx0 = Math.min(...blocks.map((b) => b.gbox.x)) - pad, ty0 = Math.min(...blocks.map((b) => b.gbox.y)) - pad;
        const tx1 = Math.max(...blocks.map((b) => b.gbox.x + b.gbox.w)) + pad, ty1 = Math.max(...blocks.map((b) => b.gbox.y + b.gbox.h)) + pad;
        roi = { x: Math.max(0, Math.round(tx0)), y: Math.max(0, Math.round(ty0)) };
        roi.w = Math.max(1, Math.min(W, Math.round(tx1)) - roi.x); roi.h = Math.max(1, Math.min(H, Math.round(ty1)) - roi.y);
      } else if (r.kind === "bubble" && r.ref.fill && paintInsideMask(pol, r.ref, letter)) {
        roi = { ...r.box };
      } else continue;
      if (r.kind === "bubble") rois.push({ ...roi, radius: 3, inside: analysis.insideOf(r.id), dark: r.dark });
      else rois.push({ ...roi, radius: Math.max(3, Math.round(letter * 0.3)) });
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
    // Inpaint each ROI separately: cost scales with ROI size, not the page.
    for (const r of rois) {
      const rect = new cv.Rect(r.x, r.y, r.w, r.h);
      const srcRoi = rgb.roi(rect), maskRoi = mask.roi(rect), dst = new cv.Mat();
      cv.inpaint(srcRoi, maskRoi, dst, r.radius, cv.INPAINT_TELEA);
      dst.copyTo(srcRoi);
      srcRoi.delete(); maskRoi.delete(); dst.delete();
    }
  }

  const out = new cv.Mat(); cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
  const result = new ImageData(new Uint8ClampedArray(out.data), W, H);
  src.delete(); rgb.delete(); out.delete();
  if (opts.keepMask) return { image: result, rois: rois.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, radius: r.radius })), mask };
  mask.delete();
  return { image: result, rois: rois.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) };
}

/**
 * Inpaints one changed area again at the page's full size, so the patch drawn over the
 * reader's image has that image's own pixels around the erased lettering (the work-resolution
 * patch, stretched, is softer than the page it covers). `natural`: that area of the full-size
 * page as ImageData, whose top-left is (nx, ny) in page pixels. `mask`: the slice's
 * work-resolution mask from erase(..., {keepMask: true}); `scale`: work pixels per page pixel;
 * (ox, oy): the slice's origin in page pixels. The mask is resampled onto the full-size pixel
 * grid by the exact affine map (pixel centres), not by resizing a rounded rectangle, so the
 * patch lines up with the original to a fraction of a pixel.
 * @returns {ImageData|null} the inpainted area, or null when no mask pixel falls inside it
 */
export function eraseFullSize(cv, natural, nx, ny, mask, scale, ox, oy, radius) {
  const W = natural.width, H = natural.height;
  const M = cv.matFromArray(2, 3, cv.CV_64F, [scale, 0, (nx - ox + 0.5) * scale - 0.5, 0, scale, (ny - oy + 0.5) * scale - 0.5]);
  const m = new cv.Mat();
  cv.warpAffine(mask, m, M, new cv.Size(W, H), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
  M.delete();
  // a quarter of a work pixel's coverage counts: the work mask was already grown over each stroke's fringe
  cv.threshold(m, m, 63, 255, cv.THRESH_BINARY);
  if (!cv.countNonZero(m)) { m.delete(); return null; }
  const src = cv.matFromImageData(natural), rgb = new cv.Mat(), dst = new cv.Mat(), out = new cv.Mat();
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  cv.inpaint(rgb, m, dst, Math.max(3, Math.round(radius / scale)), cv.INPAINT_TELEA);
  cv.cvtColor(dst, out, cv.COLOR_RGB2RGBA);
  const result = new ImageData(new Uint8ClampedArray(out.data), W, H);
  src.delete(); rgb.delete(); dst.delete(); out.delete(); m.delete();
  return result;
}
