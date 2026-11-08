// Gytakusub – shared typesetting engine (extension content script + web app).
// Given the page pixels and Claude's result (items + detected bubble
// candidates), paints bubble fills and translated text onto a transparent
// overlay context. Depends on bubble.js (globalThis.GyT). Exposed as GyT.typeset.

((root) => {
  "use strict";
  const G = root.GyT;
  // The bundled face ("Gytakusub Comic" = Comic Neue Bold, SIL OFL) comes first;
  // the rest is the fallback stack if the font file could not be loaded.
  const DEFAULT_FONT = '"Gytakusub Comic", "Comic Neue", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  const SIZE_MUL = { small: 0.75, normal: 1, large: 1.3 };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function clampRect(r, limit) {
    const x1 = Math.max(limit.x, r.x), y1 = Math.max(limit.y, r.y);
    const x2 = Math.min(limit.x + limit.w, r.x + r.w), y2 = Math.min(limit.y + limit.h, r.y + r.h);
    return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
  }
  function unionRect(r, box, limit) {
    const x1 = Math.max(limit.x, Math.min(r.x, box.x));
    const y1 = Math.max(limit.y, Math.min(r.y, box.y));
    const x2 = Math.min(limit.x + limit.w, Math.max(r.x + r.w, box.x + box.w));
    const y2 = Math.min(limit.y + limit.h, Math.max(r.y + r.h, box.y + box.h));
    return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
  }
  function iou(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / (a.w * a.h + b.w * b.h - inter || 1);
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Text-safe rectangle inside a region. Rectangular boxes (fill ≈ 1) get a
  // small inset; round bubbles get the inscribed rectangle of their ellipse
  // (sides ≈ 1/√2 of the bounding box) so lines never cross the outline.
  function innerRect(bbox, fillRatio) {
    const k = fillRatio > 0.92 ? 0.88 : fillRatio > 0.8 ? 0.78 : 0.71;
    const ix = (1 - k) / 2, iy = (1 - k) / 2;
    return { x: bbox.x + bbox.w * ix, y: bbox.y + bbox.h * iy, w: bbox.w * k, h: bbox.h * k };
  }
  /**
   * Largest axis-aligned rectangle (approx.) inside a region, sampled from its
   * `inside(x,y)` predicate within `bbox` and optionally a row window.
   * Rows are scanned for their longest inside run; the rectangle is the best
   * window of consecutive rows × the intersection of their runs.
   */
  function inscribedRect(inside, bbox, y0 = bbox.y, y1 = bbox.y + bbox.h) {
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
    // small inset so letters don't kiss the outline
    const k = 0.92;
    return { x: bestRect.x + bestRect.w * (1 - k) / 2, y: bestRect.y + bestRect.h * (1 - k) / 2, w: bestRect.w * k, h: bestRect.h * k };
  }

  /** Row (y) with the narrowest inside span between ya and yb — the "waist" between two lobes. */
  function waistRow(inside, bbox, ya, yb) {
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

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  /** Resolve a detected candidate (fractions) to a paintable region at overlay resolution. */
  function resolveCandidate(cand, pixels, W, H) {
    const bbox = { x: cand.box[0] * W, y: cand.box[1] * H, w: cand.box[2] * W, h: cand.box[3] * H };
    const cx = cand.centroid[0] * W, cy = cand.centroid[1] * H;
    const seed = { x: cx - bbox.w * 0.04, y: cy - bbox.h * 0.04, w: Math.max(4, bbox.w * 0.08), h: Math.max(4, bbox.h * 0.08) };
    const exact = G.findBubble(pixels, seed, { maxArea: cand.areaFrac * W * H * 1.8, skipOverlapCheck: true });
    if (exact && iou(exact.bbox, bbox) >= 0.5) {
      return { kind: "exact", bubble: exact, bbox: exact.bbox, color: exact.color, fillRatio: exact.fillRatio, inside: (x, y) => G.insideBubble(exact, x, y) };
    }
    const kx = cand.blockW * W, ky = cand.blockH * H;
    const inside = (x, y) => {
      const bx = Math.floor((x - bbox.x) / kx), by = Math.floor((y - bbox.y) / ky);
      const bw = cand.cols.length / 2, bh = cand.rows.length / 2;
      if (bx < 0 || by < 0 || bx >= bw || by >= bh) return false;
      return cand.rows[by * 2] >= 0 && bx >= cand.rows[by * 2] && bx <= cand.rows[by * 2 + 1] &&
        cand.cols[bx * 2] >= 0 && by >= cand.cols[bx * 2] && by <= cand.cols[bx * 2 + 1];
    };
    return { kind: "mask", cand, bbox, color: cand.color, fillRatio: cand.fillRatio, kx, ky, inside };
  }

  function paintRegion(ctx, region) {
    if (region.kind === "exact") { G.paintBubble(ctx, region.bubble); return; }
    const { cand, bbox, kx, ky } = region;
    const bw = cand.cols.length / 2, bh = cand.rows.length / 2;
    const out = ctx.createImageData(bw, bh);
    const d = out.data;
    for (let y = 0; y < bh; y++) {
      if (cand.rows[y * 2] < 0) continue;
      for (let x = cand.rows[y * 2]; x <= cand.rows[y * 2 + 1]; x++) {
        if (cand.cols[x * 2] < 0 || y < cand.cols[x * 2] || y > cand.cols[x * 2 + 1]) continue;
        const i = (y * bw + x) * 4;
        d[i] = cand.color[0]; d[i + 1] = cand.color[1]; d[i + 2] = cand.color[2]; d[i + 3] = 255;
      }
    }
    const tmp = makeCanvas(bw, bh);
    tmp.getContext("2d").putImageData(out, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, bbox.x, bbox.y, bw * kx, bh * ky);
  }

  function drawLines(ctx, fit, rect, color, family) {
    ctx.font = `bold ${fit.size}px ${family}`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const total = fit.lines.length * fit.lineHeight;
    let y = rect.y + (rect.h - total) / 2 + fit.lineHeight / 2;
    for (const line of fit.lines) { ctx.fillText(line, rect.x + rect.w / 2, y); y += fit.lineHeight; }
  }

  /**
   * Paint translations onto `ctx` (a transparent W×H overlay).
   * @param ctx      2D context of the overlay canvas (W×H)
   * @param pixels   ImageData of the page at W×H
   * @param result   { items:[{tag,box,size,text}], bubbles:[candidate] } from the translator
   * @param opts     { fontFamily?, uppercase? }
   * @returns {{drawn:number, placements:Array<{tag:(number|null), rect:{x:number,y:number,w:number,h:number}}>}}
   */
  function typeset(ctx, pixels, result, W, H, opts = {}) {
    const { items = [], bubbles = [] } = result;
    const family = (opts.fontFamily || "").trim() || DEFAULT_FONT;
    const setFont = (size) => { ctx.font = `bold ${size}px ${family}`; };
    const measure = (s) => ctx.measureText(s).width;
    const base = Math.max(10, W / 42);
    const page = { x: 0, y: 0, w: W, h: H };

    // Pass 1a: group by tag and validate candidates against the text boxes.
    const candById = new Map(bubbles.map((b) => [b.id, b]));
    const prepared = [];
    for (const it of items) {
      if (!it.text) continue;
      const box = it.box ? { x: it.box[0] * W, y: it.box[1] * H, w: it.box[2] * W, h: it.box[3] * H } : null;
      prepared.push({ it, box: box && box.w >= 4 && box.h >= 4 ? box : null });
    }
    const byTag = new Map();
    for (const p of prepared) if (p.it.tag != null && candById.has(p.it.tag)) (byTag.get(p.it.tag) || byTag.set(p.it.tag, []).get(p.it.tag)).push(p);
    // A tag is authoritative. The stamps are our own numbering drawn on the
    // image, so a matching tag is evidence the model read the picture; its pixel
    // box is not (models drift at coordinates, and a box-gated tag silently fell
    // back to the drifted box — text in the wrong panel, oversized). The box is
    // only used to order speakers inside a joined bubble, or when there is no tag.
    const validTags = new Set(byTag.keys());

    // Pass 1b: resolve regions.
    const regions = new Map();
    const jobs = [];
    for (const { it, box } of prepared) {
      let key = null;
      if (it.tag != null && validTags.has(it.tag)) {
        key = "tag:" + it.tag;
        if (!regions.has(key)) regions.set(key, { region: resolveCandidate(candById.get(it.tag), pixels, W, H), items: [] });
      } else if (box) {
        const b = G.findBubble(pixels, box);
        if (b) {
          key = `fb:${Math.round(b.bbox.x / 3)},${Math.round(b.bbox.y / 3)},${Math.round(b.bbox.w / 3)},${Math.round(b.bbox.h / 3)}`;
          if (!regions.has(key)) regions.set(key, { region: { kind: "exact", bubble: b, bbox: b.bbox, color: b.color, fillRatio: b.fillRatio, inside: (x, y) => G.insideBubble(b, x, y) }, items: [] });
        }
      }
      if (key) regions.get(key).items.push({ it, box });
      jobs.push({ it, box, key });
    }

    // Pass 2: paint regions once; measure original lettering per region.
    const letters = [];
    for (const g of regions.values()) {
      paintRegion(ctx, g.region);
      g.letter = G.estimateLetterSize(pixels, innerRect(g.region.bbox, g.region.fillRatio), g.region.inside);
      if (g.letter) letters.push(g.letter);
    }
    // Page-wide lettering size: the median of the per-bubble estimates is far
    // more stable than any single one. Individual bubbles may deviate a little.
    const median = (a) => { const t = [...a].sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : 0; };
    const pageLetter = clamp(median(letters) || base, base * 0.6, base * 1.3);
    const sizeFor = (letter, mul) => clamp(letter ? clamp(letter, pageLetter * 0.8, pageLetter * 1.25) : pageLetter, base * 0.55, base * 1.5) * mul;

    // Pass 3: decide every text placement (and any extra erasing) BEFORE drawing
    // any text, so later paint can never cover earlier lettering.
    const placements = [];
    const extraErase = [];
    for (const { it, box, key } of jobs) {
      const text = opts.uppercase ? it.text.toUpperCase() : it.text;
      const mul = SIZE_MUL[it.size] || 1;
      if (key) {
        const g = regions.get(key);
        const { bbox, fillRatio, color, inside } = g.region;
        let rect;
        if (g.items.length === 1) {
          // The detected bubble is authoritative: text goes in the largest
          // rectangle inside its actual shape (the model's box is approximate).
          rect = inscribedRect(inside, bbox) || innerRect(bbox, fillRatio);
        } else {
          // Joined bubble: cut the region at the waists between consecutive
          // speakers (ordered top-to-bottom by their boxes, else evenly), then
          // inscribe each lobe.
          if (!g.cuts) {
            const n = g.items.length;
            const centres = g.items.map((j, i) => j.box ? j.box.y + j.box.h / 2 : bbox.y + bbox.h * (i + 0.5) / n);
            const order = centres.map((c, i) => [c, i]).sort((a, b) => a[0] - b[0]);
            const edges = [bbox.y];
            for (let k = 0; k < n - 1; k++) edges.push(waistRow(inside, bbox, order[k][0], order[k + 1][0]));
            edges.push(bbox.y + bbox.h);
            g.cuts = new Map(order.map(([, i], k) => [i, [edges[k], edges[k + 1]]]));
          }
          const idx = g.items.findIndex((j) => j.it === it);
          const [ya, yb] = g.cuts.get(idx);
          rect = inscribedRect(inside, bbox, ya, yb) || { x: bbox.x + bbox.w * 0.15, y: ya + (yb - ya) * 0.1, w: bbox.w * 0.7, h: (yb - ya) * 0.8 };
        }
        placements.push({ text, rect, tag: it.tag, color: G.isDark(color) ? "#fff" : "#000", target: sizeFor(g.letter, mul), minSize: Math.max(7, Math.round(base * 0.4)) });
      } else if (box) {
        // No bubble region: erase glyph-sized ink around the model's box (line
        // art and outlines are protected inside the eraser); the returned rect
        // is the real extent of the lettering, which may exceed the box.
        const erased = G.eraseTextZone(ctx, pixels, box, { letter: pageLetter });
        if (erased) {
          const letter = G.estimateLetterSize(pixels, erased.rect, null);
          placements.push({ text, rect: clampRect(erased.rect, page), tag: null, color: G.isDark(erased.color) ? "#fff" : "#000", target: sizeFor(letter, mul), minSize: Math.max(7, Math.round(base * 0.5)), erasedZone: true });
        } else {
          // Text over artwork: translucent box built around the text at page size.
          const size = Math.round(pageLetter * mul);
          setFont(size);
          const lh = size * 1.15;
          const words = text.split(/\s+/).filter(Boolean);
          const totalW = measure(words.join(" "));
          const idealW = Math.max(box.w, G.longestWordWidth(measure, text), Math.sqrt(totalW * lh * 2.4));
          const lines = G.wrap(measure, text, idealW);
          const tw = Math.max(...lines.map(measure)), th = lines.length * lh;
          const bpad = size * 0.4;
          const rect = { x: box.x + box.w / 2 - tw / 2 - bpad, y: box.y + box.h / 2 - th / 2 - bpad, w: tw + 2 * bpad, h: th + 2 * bpad };
          rect.x = clamp(rect.x, 0, W - rect.w); rect.y = clamp(rect.y, 0, H - rect.h);
          placements.push({ text, rect, tag: null, color: "#000", fixed: { size, lines, lineHeight: lh }, boxFill: bpad });
        }
      }
    }

    // Pass 4: resolve overlaps between text rectangles by trimming the side of
    // each that faces the other (never let two translations share pixels).
    for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i].rect, b = placements[j].rect;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix <= 0 || iy <= 0) continue;
      if (ix < iy) { // separate horizontally
        if (a.x + a.w / 2 < b.x + b.w / 2) { a.w -= ix / 2; b.x += ix / 2; b.w -= ix / 2; } else { b.w -= ix / 2; a.x += ix / 2; a.w -= ix / 2; }
      } else { // separate vertically
        if (a.y + a.h / 2 < b.y + b.h / 2) { a.h -= iy / 2; b.y += iy / 2; b.h -= iy / 2; } else { b.h -= iy / 2; a.y += iy / 2; a.h -= iy / 2; }
      }
      a.w = Math.max(8, a.w); a.h = Math.max(8, a.h); b.w = Math.max(8, b.w); b.h = Math.max(8, b.h);
    }

    // Debug overlay: detected bubbles (red, numbered), model boxes (blue, item
    // index), final text rects (green). Enabled from Options → Debug overlay.
    if (opts.debug) {
      ctx.save();
      ctx.lineWidth = Math.max(1, W / 600);
      ctx.font = `bold ${Math.max(10, W / 60)}px sans-serif`;
      for (const b of bubbles) {
        const bb = { x: b.box[0] * W, y: b.box[1] * H, w: b.box[2] * W, h: b.box[3] * H };
        ctx.strokeStyle = validTags.has(b.id) ? "rgba(220,38,38,.9)" : "rgba(220,38,38,.4)";
        ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
        ctx.fillStyle = "rgba(220,38,38,.9)"; ctx.fillText("#" + b.id, bb.x + 3, bb.y + W / 60);
      }
      prepared.forEach(({ it, box }, i) => {
        if (!box) return;
        ctx.strokeStyle = "rgba(37,99,235,.9)"; ctx.setLineDash([6, 4]); ctx.strokeRect(box.x, box.y, box.w, box.h); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(37,99,235,.9)"; ctx.fillText(`${i}${it.tag != null ? "→#" + it.tag : ""}`, box.x + 3, box.y + box.h - 4);
      });
      for (const p of placements) { ctx.strokeStyle = "rgba(22,163,74,.9)"; ctx.strokeRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h); }
      ctx.restore();
    }

    // Pass 5: paint translucent boxes, then draw all text.
    for (const p of placements) {
      if (p.boxFill) { ctx.fillStyle = "rgba(255,255,255,0.9)"; roundRect(ctx, p.rect.x, p.rect.y, p.rect.w, p.rect.h, p.boxFill); ctx.fill(); }
    }
    let drawn = 0;
    for (const p of placements) {
      const fit = p.fixed || G.fitText(p.text, p.rect, setFont, measure, { maxSize: p.target, minSize: p.minSize });
      drawLines(ctx, fit, p.rect, p.color, family);
      drawn++;
    }
    return { drawn, placements: placements.map((p) => ({ tag: p.tag ?? null, rect: { x: Math.round(p.rect.x), y: Math.round(p.rect.y), w: Math.round(p.rect.w), h: Math.round(p.rect.h) } })) };
  }

  G.typeset = typeset;
  G.DEFAULT_FONT = DEFAULT_FONT;
})(typeof globalThis !== "undefined" ? globalThis : this);
