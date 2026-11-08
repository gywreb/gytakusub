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
 * @returns {{image: ImageData, rois: Array<{x:number,y:number,w:number,h:number}>}} cleaned page and the areas that changed
 */
export function erase(cv, img, analysis, regionIds) {
  const { W, H } = analysis;
  const src = cv.matFromImageData(img);
  const rgb = new cv.Mat(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  const mask = cv.Mat.zeros(H, W, cv.CV_8UC1);
  const md = mask.data;
  const rois = []; // {x,y,w,h,radius}

  const paintGlyph = (labels, lbl, g) => {
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) { const p = y * W + x; if (labels[p] === lbl) md[p] = 255; }
  };

  for (const r of analysis.regions) {
    if (!regionIds.has(r.id)) continue;
    const pol = analysis.polarities[r.dark ? 1 : 0];
    const glyphLabels = pol.glyphLabels.data32S, regionLabels = pol.regionLabels.data32S;
    const letter = Math.max(4, r.letter);
    if (r.kind === "bubble") {
      const b = r.ref, { x, y, w, h } = b.box;
      // Lettering = ink components that sit inside the bubble, are glyph-sized
      // relative to it, and touch its surface (the outline fails all three).
      const seen = new Set();
      for (const bl of b.blocks) for (const gi of bl.glyphs) seen.add(gi);
      for (let gi = 1; gi < pol.glyphs.length; gi++) {
        const g = pol.glyphs[gi]; if (!g || seen.has(gi)) continue;
        if (g.x < x + 1 || g.y < y + 1 || g.x + g.w > x + w - 1 || g.y + g.h > y + h - 1) continue;
        if (g.a > 0.2 * b.area || g.h > 3 * letter) continue;
        // adjacent to the bubble surface?
        const cx = g.x + (g.w >> 1), cy = g.y + (g.h >> 1), d = 2;
        const near = [[g.x - d, cy], [g.x + g.w + d, cy], [cx, g.y - d], [cx, g.y + g.h + d]].some(([sx, sy]) => sx >= 0 && sy >= 0 && sx < W && sy < H && regionLabels[sy * W + sx] === b.labelId);
        if (near) seen.add(gi);
      }
      for (const gi of seen) paintGlyph(glyphLabels, gi, pol.glyphs[gi]);
      rois.push({ x, y, w, h, radius: 3, confine: b.labelId, labels: regionLabels, dark: r.dark });
    } else {
      const bl = r.ref, { x, y, w, h } = bl.box;
      for (const gi of bl.glyphs) paintGlyph(glyphLabels, gi, pol.glyphs[gi]);
      const pad = Math.round(letter * 0.8);
      rois.push({ x: Math.max(0, x - pad), y: Math.max(0, y - pad), w: Math.min(W, x + w + pad) - Math.max(0, x - pad), h: Math.min(H, y + h + pad) - Math.max(0, y - pad), radius: Math.max(3, Math.round(letter * 0.3)) });
    }
  }

  if (rois.length) {
    // Grow the mask over the anti-aliased fringe of each stroke; inside bubbles
    // never past the bubble surface (so outlines stay crisp).
    const grow = Math.max(2, Math.round(analysis.letter * 0.15));
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(2 * grow + 1, 2 * grow + 1));
    const grown = new cv.Mat(); cv.dilate(mask, grown, k); k.delete();
    const gd = grown.data, px = img.data;
    for (const r of rois) {
      for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) {
        const p = yy * W + xx;
        if (!gd[p] || md[p]) continue;
        if (r.confine && r.labels[p] !== r.confine) {
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
  src.delete(); rgb.delete(); mask.delete(); out.delete();
  return { image: result, rois: rois.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) };
}
