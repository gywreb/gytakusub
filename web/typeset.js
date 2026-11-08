// Gytakusub – shared typesetting engine (extension content script + web app).
// Given the page pixels and Claude's result (items + detected bubble
// candidates), paints bubble fills and translated text onto a transparent
// overlay context. Depends on bubble.js (globalThis.GyT). Exposed as GyT.typeset.

(function (root) {
  "use strict";
  const G = root.GyT;
  const DEFAULT_FONT = '"Comic Neue", "Comic Sans MS", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
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
  function innerRect(bbox, fillRatio) {
    const ix = fillRatio > 0.92 ? 0.06 : 0.13, iy = fillRatio > 0.92 ? 0.06 : 0.10;
    return { x: bbox.x + bbox.w * ix, y: bbox.y + bbox.h * iy, w: bbox.w * (1 - 2 * ix), h: bbox.h * (1 - 2 * iy) };
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
   * @returns number of items drawn
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
    const validTags = new Set();
    for (const [tag, ps] of byTag) {
      const cand = candById.get(tag);
      const cb = { x: cand.box[0] * W, y: cand.box[1] * H, w: cand.box[2] * W, h: cand.box[3] * H };
      const boxes = ps.map((p) => p.box).filter(Boolean);
      if (!boxes.length) { validTags.add(tag); continue; }
      const centresInside = boxes.every((b) => {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        return cx >= cb.x - cb.w * 0.1 && cx <= cb.x + cb.w * 1.1 && cy >= cb.y - cb.h * 0.1 && cy <= cb.y + cb.h * 1.1;
      });
      const ux1 = Math.min(...boxes.map((b) => b.x)), uy1 = Math.min(...boxes.map((b) => b.y));
      const ux2 = Math.max(...boxes.map((b) => b.x + b.w)), uy2 = Math.max(...boxes.map((b) => b.y + b.h));
      if (centresInside && cand.areaFrac * W * H <= 6 * (ux2 - ux1) * (uy2 - uy1)) validTags.add(tag);
    }

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

    // Pass 2: paint regions once; measure original lettering.
    for (const g of regions.values()) {
      paintRegion(ctx, g.region);
      g.letter = G.estimateLetterSize(pixels, innerRect(g.region.bbox, g.region.fillRatio), g.region.inside);
    }

    // Pass 3: typeset.
    let drawn = 0;
    for (const { it, box, key } of jobs) {
      const text = opts.uppercase ? it.text.toUpperCase() : it.text;
      const mul = SIZE_MUL[it.size] || 1;
      if (key) {
        const g = regions.get(key);
        const { bbox, fillRatio, color } = g.region;
        const textColor = G.isDark(color) ? "#fff" : "#000";
        let rect;
        if (g.items.length === 1) {
          rect = box ? unionRect(innerRect(bbox, fillRatio), box, bbox) : innerRect(bbox, fillRatio);
        } else if (box) {
          const px = box.w * 0.15, py = box.h * 0.15;
          rect = clampRect({ x: box.x - px, y: box.y - py, w: box.w + 2 * px, h: box.h + 2 * py }, bbox);
        } else {
          const idx = g.items.findIndex((j) => j.it === it), n = g.items.length;
          const inner = innerRect(bbox, fillRatio);
          rect = { x: inner.x, y: inner.y + (inner.h / n) * idx, w: inner.w, h: inner.h / n };
        }
        const target = clamp(g.letter || base, base * 0.7, base * 1.4) * mul;
        const fit = G.fitText(text, rect, setFont, measure, { maxSize: target, minSize: Math.max(7, Math.round(base * 0.4)) });
        drawLines(ctx, fit, rect, textColor, family);
        drawn++;
      } else if (box) {
        // No bubble region: erase lettering inside the text box if it is mostly
        // light (bubble cut by a panel border), else a translucent box.
        const pad = Math.max(4, Math.min(box.w, box.h) * 0.16);
        const zone = clampRect({ x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }, page);
        const erased = G.eraseTextZone(ctx, pixels, zone, { radius: Math.max(3, Math.round(base * 0.12)) });
        if (erased) {
          const letter = G.estimateLetterSize(pixels, zone, null);
          const target = clamp(letter || base, base * 0.7, base * 1.4) * mul;
          const textColor = G.isDark(erased.color) ? "#fff" : "#000";
          const grow = { x: zone.x - zone.w * 0.08, y: zone.y - zone.h * 0.08, w: zone.w * 1.16, h: zone.h * 1.16 };
          const fit = G.fitText(text, grow, setFont, measure, { maxSize: target, minSize: Math.max(7, Math.round(base * 0.55)) });
          if (fit.lines.length * fit.lineHeight > grow.h * 1.3 || fit.broken) {
            const need = { x: grow.x, y: grow.y + grow.h / 2 - (fit.lines.length * fit.lineHeight) / 2 - pad, w: grow.w, h: fit.lines.length * fit.lineHeight + 2 * pad };
            G.eraseTextZone(ctx, pixels, clampRect(need, page), { radius: 3, minLightFrac: 0 });
          }
          drawLines(ctx, fit, grow, textColor, family);
          drawn++;
          continue;
        }
        const size = Math.round(base * mul);
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
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, bpad);
        ctx.fill();
        drawLines(ctx, { size, lines, lineHeight: lh }, rect, "#000", family);
        drawn++;
      }
    }
    return drawn;
  }

  G.typeset = typeset;
  G.DEFAULT_FONT = DEFAULT_FONT;
})(typeof globalThis !== "undefined" ? globalThis : this);
