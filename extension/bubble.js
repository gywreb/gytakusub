// Gytakusub – pure helpers for bubble detection and text layout.
// No DOM access except an optional CanvasRenderingContext2D passed in, so this
// file can be unit-tested in Node. Exposed as globalThis.GyT.

((root) => {
  "use strict";

  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /**
   * Find the closed, flat-coloured region (a speech bubble) that contains the
   * centre of `box`.
   *
   * @param {{data:Uint8ClampedArray|Uint8Array, width:number, height:number}} img  RGBA pixels
   * @param {{x:number,y:number,w:number,h:number}} box  approximate text box in px
   * @param {object} [opts]
   * @returns {null | {
   *   bbox:{x:number,y:number,w:number,h:number},  // bounding box of the bubble interior
   *   rows:Int32Array,  // per bbox row: [minX, maxX] pairs (absolute px)
   *   cols:Int32Array,  // per bbox col: [minY, maxY] pairs (absolute px)
   *   color:[number,number,number],  // bubble background colour
   *   fillRatio:number  // mask area / bbox area (≈0.78 for ellipses, ≈1 for rectangles)
   * }}
   */
  function findBubble(img, box, opts = {}) {
    const tol = opts.tolerance ?? 40; // max per-channel diff from seed colour
    const maxAreaFactor = opts.maxAreaFactor ?? 12; // bubble may be at most N× the text box
    const maxAreaAbs = opts.maxArea; // optional absolute cap in px (when the caller knows the bubble size)
    const { data, width: W, height: H } = img;
    if (!W || !H) return null;

    const bx = Math.max(0, Math.floor(box.x));
    const by = Math.max(0, Math.floor(box.y));
    const bw = Math.min(W - bx, Math.ceil(box.w));
    const bh = Math.min(H - by, Math.ceil(box.h));
    if (bw <= 0 || bh <= 0) return null;

    // --- seed: lightest pixel in the central third of the box ---
    const cx0 = bx + Math.floor(bw / 3), cx1 = bx + Math.ceil((2 * bw) / 3);
    const cy0 = by + Math.floor(bh / 3), cy1 = by + Math.ceil((2 * bh) / 3);
    let seedX = -1, seedY = -1, best = -1;
    for (let y = cy0; y < cy1; y++) {
      for (let x = cx0; x < cx1; x++) {
        const i = (y * W + x) * 4;
        const l = lum(data[i], data[i + 1], data[i + 2]);
        if (l > best) { best = l; seedX = x; seedY = y; }
      }
    }
    if (seedX < 0) return null;
    const si = (seedY * W + seedX) * 4;
    const sr = data[si], sg = data[si + 1], sb = data[si + 2];

    // --- flood fill (4-connected) ---
    const maxArea = maxAreaAbs || Math.min(W * H * 0.6, Math.max(bw * bh * maxAreaFactor, 400));
    const visited = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    let sp = 0, area = 0;
    let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY;
    stack[sp++] = seedY * W + seedX;
    visited[seedY * W + seedX] = 1;

    while (sp > 0) {
      const p = stack[--sp];
      const i = p * 4;
      if (
        Math.abs(data[i] - sr) > tol ||
        Math.abs(data[i + 1] - sg) > tol ||
        Math.abs(data[i + 2] - sb) > tol
      ) continue;
      area++;
      if (area > maxArea) return null; // leaked out of the bubble -> open background
      const x = p % W, y = (p - x) / W;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && !visited[p - 1]) { visited[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < W - 1 && !visited[p + 1]) { visited[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !visited[p - W]) { visited[p - W] = 1; stack[sp++] = p - W; }
      if (y < H - 1 && !visited[p + W]) { visited[p + W] = 1; stack[sp++] = p + W; }
    }
    // visited marks tested pixels; the mask is the subset that matched colour.
    // Recompute spans from matched pixels only.
    const bbW = maxX - minX + 1, bbH = maxY - minY + 1;
    if (bbW < 4 || bbH < 4) return null;

    const rows = new Int32Array(bbH * 2).fill(-1);
    const cols = new Int32Array(bbW * 2).fill(-1);
    let matched = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = y * W + x;
        if (!visited[p]) continue;
        const i = p * 4;
        if (
          Math.abs(data[i] - sr) > tol ||
          Math.abs(data[i + 1] - sg) > tol ||
          Math.abs(data[i + 2] - sb) > tol
        ) continue;
        matched++;
        const ry = (y - minY) * 2, cx = (x - minX) * 2;
        if (rows[ry] === -1 || x < rows[ry]) rows[ry] = x;
        if (x > rows[ry + 1]) rows[ry + 1] = x;
        if (cols[cx] === -1 || y < cols[cx]) cols[cx] = y;
        if (y > cols[cx + 1]) cols[cx + 1] = y;
      }
    }

    // Sanity: the bubble must actually overlap the text box we were given.
    if (!opts.skipOverlapCheck) {
      const ix = Math.max(0, Math.min(bx + bw, maxX + 1) - Math.max(bx, minX));
      const iy = Math.max(0, Math.min(by + bh, maxY + 1) - Math.max(by, minY));
      if (ix * iy < 0.3 * bw * bh) return null;
    }

    return {
      bbox: { x: minX, y: minY, w: bbW, h: bbH },
      rows, cols,
      color: [sr, sg, sb],
      fillRatio: matched / (bbW * bbH),
    };
  }

  /**
   * Find speech-bubble candidates on a whole page without any model:
   * closed, light, flat regions that contain dark ink and don't touch the
   * image border. Runs on a downsampled copy for speed.
   *
   * @returns {Array<{bbox:{x,y,w,h}, area:number, centroid:{x,y}, color:[r,g,b],
   *           rows:number[], cols:number[], scale:number}>}
   *   bbox/centroid/area are in full-resolution px; rows/cols are span pairs at
   *   the downsampled scale (multiply by `scale` to get px), relative to bbox.
   */
  function detectBubbles(img, opts = {}) {
    const { data, width: W, height: H } = img;
    const f = Math.max(1, Math.ceil(Math.max(W, H) / (opts.workSize || 800)));
    const w = Math.floor(W / f), h = Math.floor(H / f);
    if (w < 8 || h < 8) return [];
    const lightThr = opts.lightThreshold ?? 160;
    const inkThr = opts.inkThreshold ?? 110;

    // Downsample: mean luminance + "has ink" per block.
    const light = new Uint8Array(w * h);
    const ink = new Uint8Array(w * h);
    const R = new Float32Array(w * h), Gc = new Float32Array(w * h), B = new Float32Array(w * h);
    const n = f * f;
    for (let by = 0; by < h; by++) {
      for (let bx = 0; bx < w; bx++) {
        let sr = 0, sg = 0, sb = 0, minL = 255;
        for (let dy = 0; dy < f; dy++) {
          let i = ((by * f + dy) * W + bx * f) * 4;
          for (let dx = 0; dx < f; dx++, i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            sr += r; sg += g; sb += b;
            const l = lum(r, g, b);
            if (l < minL) minL = l;
          }
        }
        const k = by * w + bx;
        R[k] = sr / n; Gc[k] = sg / n; B[k] = sb / n;
        light[k] = lum(R[k], Gc[k], B[k]) >= lightThr ? 1 : 0;
        ink[k] = minL < inkThr ? 1 : 0;
      }
    }

    // Connected components over light blocks (4-connected).
    const label = new Int32Array(w * h); // 0 = unlabeled
    const stack = new Int32Array(w * h);
    const out = [];
    let next = 0;
    const minArea = (opts.minAreaFrac ?? 0.0012) * w * h;
    const maxArea = (opts.maxAreaFrac ?? 0.08) * w * h;

    for (let start = 0; start < w * h; start++) {
      if (!light[start] || label[start]) continue;
      next++;
      let sp = 0, area = 0, touches = false;
      let minX = w, maxX = -1, minY = h, maxY = -1, sx = 0, sy = 0;
      let cr = 0, cg = 0, cb = 0, sl = 0, sl2 = 0;
      stack[sp++] = start; label[start] = next;
      while (sp > 0) {
        const p = stack[--sp];
        const x = p % w, y = (p - x) / w;
        area++; sx += x; sy += y; cr += R[p]; cg += Gc[p]; cb += B[p];
        const lp = lum(R[p], Gc[p], B[p]); sl += lp; sl2 += lp * lp;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
        if (x > 0 && light[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
        if (x < w - 1 && light[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
        if (y > 0 && light[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
        if (y < h - 1 && light[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
      }
      if (touches || area < minArea || area > maxArea) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      if (bw < 10 || bh < 10) continue;
      const aspect = bw / bh;
      if (aspect < 0.12 || aspect > 8) continue;
      if (area / (bw * bh) < 0.4) continue;
      // A bubble interior is flat; sky, gradients and screentone are not.
      const lumStd = Math.sqrt(Math.max(0, sl2 / area - (sl / area) ** 2));
      if (lumStd > (opts.maxLumStd ?? 14)) continue;

      // Row/column spans; ink must sit inside the region.
      const rows = new Array(bh * 2).fill(-1);
      const cols = new Array(bw * 2).fill(-1);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (label[y * w + x] !== next) continue;
          const ry = (y - minY) * 2, cx = (x - minX) * 2;
          if (rows[ry] === -1 || x - minX < rows[ry]) rows[ry] = x - minX;
          if (x - minX > rows[ry + 1]) rows[ry + 1] = x - minX;
          if (cols[cx] === -1 || y - minY < cols[cx]) cols[cx] = y - minY;
          if (y - minY > cols[cx + 1]) cols[cx + 1] = y - minY;
        }
      }
      let inkIn = 0, inside = 0;
      for (let y = 0; y < bh; y++) {
        if (rows[y * 2] < 0) continue;
        for (let x = rows[y * 2]; x <= rows[y * 2 + 1]; x++) {
          if (cols[x * 2] < 0 || y < cols[x * 2] || y > cols[x * 2 + 1]) continue;
          inside++;
          if (ink[(y + minY) * w + (x + minX)]) inkIn++;
        }
      }
      const inkRatio = inkIn / Math.max(1, inside);
      if (inkRatio < 0.012 || inkRatio > 0.4) continue;

      out.push({
        bbox: { x: minX * f, y: minY * f, w: bw * f, h: bh * f },
        area: area * f * f,
        centroid: { x: (sx / area) * f, y: (sy / area) * f },
        color: [Math.round(cr / area), Math.round(cg / area), Math.round(cb / area)],
        rows, cols, scale: f,
        fillRatio: area / (bw * bh),
        lumStd,
      });
    }
    // Stable order: top-to-bottom bands, right-to-left within a band (manga reading order).
    out.sort((a, b) => {
      const band = Math.round(a.bbox.y / 120) - Math.round(b.bbox.y / 120);
      return band !== 0 ? band : b.bbox.x - a.bbox.x;
    });
    return out;
  }

  /**
   * Paint a detected candidate (row/col spans at `scale`) onto ctx, scaled by
   * `k` (ctx px per candidate px). Soft edges from upscaling are acceptable.
   */
  function paintCandidate(ctx, cand, k) {
    const { rows, cols, color, bbox, scale } = cand;
    const bw = cols.length / 2, bh = rows.length / 2;
    const out = ctx.createImageData(bw, bh);
    const d = out.data;
    for (let y = 0; y < bh; y++) {
      if (rows[y * 2] < 0) continue;
      for (let x = rows[y * 2]; x <= rows[y * 2 + 1]; x++) {
        if (cols[x * 2] < 0 || y < cols[x * 2] || y > cols[x * 2 + 1]) continue;
        const i = (y * bw + x) * 4;
        d[i] = color[0]; d[i + 1] = color[1]; d[i + 2] = color[2]; d[i + 3] = 255;
      }
    }
    const tmp = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(bw, bh)
      : Object.assign(document.createElement("canvas"), { width: bw, height: bh });
    tmp.getContext("2d").putImageData(out, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, bbox.x * k, bbox.y * k, bw * scale * k, bh * scale * k);
  }

  /**
   * Estimate the original lettering size (em in px) inside a region from ink
   * projections. Returns null when there isn't enough ink to judge.
   * `inside(x,y)` says whether a pixel belongs to the bubble interior.
   */
  function estimateLetterSize(img, bbox, inside, opts = {}) {
    const { data, width: W } = img;
    const inkThr = opts.inkThreshold ?? 110;
    const x0 = Math.max(0, Math.floor(bbox.x)), y0 = Math.max(0, Math.floor(bbox.y));
    const x1 = Math.min(img.width, Math.ceil(bbox.x + bbox.w)), y1 = Math.min(img.height, Math.ceil(bbox.y + bbox.h));
    const rowCount = new Int32Array(y1 - y0), colCount = new Int32Array(x1 - x0);
    let total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (inside && !inside(x, y)) continue;
        const i = (y * W + x) * 4;
        if (lum(data[i], data[i + 1], data[i + 2]) < inkThr) { rowCount[y - y0]++; colCount[x - x0]++; total++; }
      }
    }
    if (total < 30) return null;
    const runs = (arr, min) => {
      const r = []; let len = 0;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] >= min) len++;
        else { if (len >= 3) r.push(len); len = 0; }
      }
      if (len >= 3) r.push(len);
      return r;
    };
    const median = (a) => { if (!a.length) return 0; const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    const rowRuns = runs(rowCount, 2), colRuns = runs(colCount, 2);
    const rh = median(rowRuns), cw = median(colRuns);
    if (!rh && !cw) return null;
    // Vertical CJK: column runs are whole characters (~1 em). Horizontal Latin:
    // row runs are lines (~0.75 em for caps). Pick the larger, scale accordingly.
    const vertical = cw > rh * 1.3 && colRuns.length >= 2;
    return vertical ? cw * 0.9 : rh * 1.25;
  }

  /**
   * Paint the bubble interior (row-span ∩ column-span of the flood mask) onto
   * `ctx` in the bubble's own colour. This erases the original lettering while
   * staying inside the bubble outline.
   */
  function paintBubble(ctx, bubble) {
    const { bbox, rows, cols, color } = bubble;
    const out = ctx.createImageData(bbox.w, bbox.h);
    const d = out.data;
    for (let y = 0; y < bbox.h; y++) {
      const rMin = rows[y * 2], rMax = rows[y * 2 + 1];
      if (rMin < 0) continue;
      for (let x = rMin - bbox.x; x <= rMax - bbox.x; x++) {
        const cMin = cols[x * 2], cMax = cols[x * 2 + 1];
        const ay = y + bbox.y;
        if (cMin < 0 || ay < cMin || ay > cMax) continue;
        const i = (y * bbox.w + x) * 4;
        d[i] = color[0]; d[i + 1] = color[1]; d[i + 2] = color[2]; d[i + 3] = 255;
      }
    }
    // Draw through a temp canvas so existing overlay pixels are preserved.
    const tmp = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(bbox.w, bbox.h)
      : Object.assign(document.createElement("canvas"), { width: bbox.w, height: bbox.h });
    tmp.getContext("2d").putImageData(out, 0, 0);
    ctx.drawImage(tmp, bbox.x, bbox.y);
  }

  /** Inner rectangle safe for text inside a bubble (ellipses need more inset). */
  function textRect(bubble) {
    const { bbox, fillRatio } = bubble;
    const insetX = fillRatio > 0.92 ? 0.06 : 0.14;
    const insetY = fillRatio > 0.92 ? 0.06 : 0.11;
    return {
      x: bbox.x + bbox.w * insetX,
      y: bbox.y + bbox.h * insetY,
      w: bbox.w * (1 - 2 * insetX),
      h: bbox.h * (1 - 2 * insetY),
    };
  }

  /**
   * Word-wrap `text` to fit `maxW` at a given font; returns lines or null if a
   * single word cannot fit (caller should try a smaller size).
   */
  function wrap(measure, text, maxW) {
    return wrapInfo(measure, text, maxW).lines;
  }

  function wrapInfo(measure, text, maxW, opts = {}) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    let broken = false;
    const minBreakLen = opts.minBreakLen ?? 8;
    for (const w of words) {
      if (measure(w) > maxW) {
        if ([...w].length < minBreakLen && !opts.force) {
          // Short word that doesn't fit: report as not fitting rather than splitting it.
          if (cur) { lines.push(cur); cur = ""; }
          lines.push(w); broken = true; continue;
        }
        // break the long word by characters
        broken = true;
        if (cur) { lines.push(cur); cur = ""; }
        // Hyphenate letters; break bare at punctuation/digits.
        let piece = "";
        const chars = [...w];
        for (let i = 0; i < chars.length; i++) {
          const ch = chars[i];
          const hy = /[A-Za-z\u00C0-\u024F]/.test(ch) && i < chars.length - 1 && /[A-Za-z\u00C0-\u024F]/.test(chars[i + 1]) ? "-" : "";
          if (measure(piece + ch + hy) > maxW && piece) { lines.push(piece + (/[A-Za-z\u00C0-\u024F]$/.test(piece) && /[A-Za-z\u00C0-\u024F]/.test(ch) ? "-" : "")); piece = ch; }
          else piece += ch;
        }
        cur = piece;
        continue;
      }
      const t = cur ? cur + " " + w : w;
      if (measure(t) <= maxW) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return { lines, broken };
  }

  /**
   * Find the largest font size whose wrapped lines fit in rect.
   * Prefers layouts that keep words whole; only splits a word mid-way when no
   * size down to minSize can fit it.
   * `setFont(size)` must configure the measuring context; `measure(str)` returns width.
   * @returns {{size:number, lines:string[], lineHeight:number, broken:boolean}}
   */
  function fitText(text, rect, setFont, measure, opts = {}) {
    const minSize = opts.minSize ?? 8;
    const maxSize = Math.min(opts.maxSize ?? 64, rect.h);
    const lh = opts.lineHeightRatio ?? 1.15;
    // Prefer whole words, but accept a hyphenated break when keeping the word
    // whole would force the text much smaller (letterers hyphenate, they
    // don't shrink a name to a whisper).
    let brokenFit = null, wholeFit = null;
    for (let size = Math.floor(maxSize); size >= minSize; size--) {
      setFont(size);
      const { lines, broken } = wrapInfo(measure, text, rect.w);
      const totalH = lines.length * size * lh;
      const widest = Math.max(0, ...lines.map(measure));
      if (totalH <= rect.h && widest <= rect.w) {
        const fit = { size, lines, lineHeight: size * lh, broken };
        if (!broken) { wholeFit = fit; break; }
        if (!brokenFit) brokenFit = fit;
      }
    }
    if (wholeFit && (!brokenFit || wholeFit.size >= brokenFit.size * (opts.hyphenRatio ?? 0.6))) return wholeFit;
    if (brokenFit) return brokenFit;
    // Nothing fits even at minSize: force character breaks so the text at least stays inside.
    setFont(minSize);
    const { lines, broken } = wrapInfo(measure, text, rect.w, { force: true, minBreakLen: 1 });
    return { size: minSize, lines, lineHeight: minSize * lh, broken };
  }

  /** Width of the longest word at the current font (for widening boxes). */
  function longestWordWidth(measure, text) {
    return Math.max(0, ...text.split(/\s+/).filter(Boolean).map(measure));
  }

  function isDark([r, g, b]) {
    return lum(r, g, b) < 128;
  }

  /**
   * Erase lettering near a text box without knowing the bubble outline.
   * Only GLYPH-SIZED ink components (height ≈ lettering size) are painted over,
   * so bubble outlines, line art and logos survive even if the model's box is
   * wrong. Components may extend past `core` (the model's box) up to `search`.
   * Returns null when the zone has no glyph-sized ink or too little flat
   * background (text over artwork) — the caller then draws a translucent box.
   *
   * @returns {null | { color:[r,g,b], rect:{x,y,w,h} }}  rect = extent of erased glyphs ∪ core
   */
  function eraseTextZone(ctx, img, core, opts = {}) {
    const { data, width: W, height: H } = img;
    const L = opts.letter || Math.max(10, W / 42); // page lettering size in px
    const r = opts.radius ?? Math.max(2, Math.round(L * 0.12));
    const inkThr = opts.inkThreshold ?? 110, lightThr = opts.lightThreshold ?? 150;
    const grow = opts.search ?? 0.5;
    const x0 = Math.max(0, Math.floor(core.x - core.w * grow)), y0 = Math.max(0, Math.floor(core.y - core.h * grow));
    const x1 = Math.min(W, Math.ceil(core.x + core.w * (1 + grow))), y1 = Math.min(H, Math.ceil(core.y + core.h * (1 + grow)));
    const zw = x1 - x0, zh = y1 - y0;
    if (zw < 4 || zh < 4) return null;

    // Classify pixels: ink / light / other.
    const ink = new Uint8Array(zw * zh);
    let nLight = 0, sr = 0, sg = 0, sb = 0;
    for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) {
      const i = ((y + y0) * W + (x + x0)) * 4;
      const l = lum(data[i], data[i + 1], data[i + 2]);
      if (l < inkThr) ink[y * zw + x] = 1;
      else if (l >= lightThr) { nLight++; sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; }
    }
    if (nLight < 0.35 * zw * zh) return null; // not on a light background
    const color = [Math.round(sr / nLight), Math.round(sg / nLight), Math.round(sb / nLight)];

    // Connected components of ink (8-connected). Glyph-sized components that
    // touch the core box are erased, and inclusion chains outward: any glyph
    // within ~1.5 letters of an erased one joins too (a line of text is a chain
    // of neighbours), so a too-small model box still clears the whole lettering.
    const label = new Int32Array(zw * zh);
    const stack = new Int32Array(zw * zh);
    const keep = new Uint8Array(zw * zh);
    const maxH = L * 2.4, maxW = L * 10, near = L * 1.5;
    const comps = [];
    let inkArea = 0, next = 0;
    for (let s0 = 0; s0 < zw * zh; s0++) {
      if (!ink[s0] || label[s0]) continue;
      next++;
      let sp = 0, n = 0, bx0 = zw, bx1 = -1, by0 = zh, by1 = -1;
      stack[sp++] = s0; label[s0] = next;
      const pix = [];
      while (sp > 0) {
        const p = stack[--sp]; const x = p % zw, y = (p - x) / zw;
        n++; pix.push(p);
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= zw || yy >= zh) continue;
          const q = yy * zw + xx;
          if (ink[q] && !label[q]) { label[q] = next; stack[sp++] = q; }
        }
      }
      inkArea += n;
      const h = by1 - by0 + 1, w = bx1 - bx0 + 1;
      if (h <= maxH && w <= maxW && n >= 2) comps.push({ pix, bx0, bx1, by0, by1, used: false });
    }
    // Seed: glyphs overlapping the core box (in zone coordinates); then chain.
    let ex0 = core.x - x0, ey0 = core.y - y0, ex1 = core.x + core.w - x0, ey1 = core.y + core.h - y0;
    let erasedArea = 0, changed = true, any = false;
    while (changed) {
      changed = false;
      for (const c of comps) {
        if (c.used) continue;
        if (c.bx1 >= ex0 - near && c.bx0 <= ex1 + near && c.by1 >= ey0 - near && c.by0 <= ey1 + near) {
          c.used = true; changed = true; any = true;
          for (const p of c.pix) keep[p] = 1;
          erasedArea += c.pix.length;
          ex0 = Math.min(ex0, c.bx0); ey0 = Math.min(ey0, c.by0); ex1 = Math.max(ex1, c.bx1); ey1 = Math.max(ey1, c.by1);
        }
      }
    }
    if (!any || (erasedArea < 0.3 * inkArea && erasedArea < L * L)) return null; // mostly artwork here

    // Paint: dilate the kept glyph pixels by r, but never over non-glyph ink.
    const out = ctx.createImageData(zw, zh);
    const od = out.data;
    for (let y = 0; y < zh; y++) for (let x = 0; x < zw; x++) {
      const p = y * zw + x;
      if (ink[p] && !keep[p]) continue; // protected line art / outline
      let hit = keep[p];
      for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r && !hit; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < zw && yy < zh && keep[yy * zw + xx]) hit = 1;
      }
      if (!hit) continue;
      od[p * 4] = color[0]; od[p * 4 + 1] = color[1]; od[p * 4 + 2] = color[2]; od[p * 4 + 3] = 255;
    }
    const tmp = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(zw, zh)
      : Object.assign(document.createElement("canvas"), { width: zw, height: zh });
    tmp.getContext("2d").putImageData(out, 0, 0);
    ctx.drawImage(tmp, x0, y0);

    // Text area: extent of what we erased ∪ the core box, padded a little.
    const pad = L * 0.3;
    const rx0 = ex0 + x0 - pad, ry0 = ey0 + y0 - pad, rx1 = ex1 + x0 + 1 + pad, ry1 = ey1 + y0 + 1 + pad;
    return { color, rect: { x: Math.max(0, rx0), y: Math.max(0, ry0), w: Math.min(W, rx1) - Math.max(0, rx0), h: Math.min(H, ry1) - Math.max(0, ry0) } };
  }

  /** True if (x,y) is inside a findBubble result (row-span ∩ col-span). */
  function insideBubble(bubble, x, y) {
    const { bbox, rows, cols } = bubble;
    const ry = (y - bbox.y) * 2, cx = (x - bbox.x) * 2;
    if (ry < 0 || cx < 0 || ry >= rows.length || cx >= cols.length) return false;
    return rows[ry] >= 0 && x >= rows[ry] && x <= rows[ry + 1] && cols[cx] >= 0 && y >= cols[cx] && y <= cols[cx + 1];
  }

  root.GyT = {
    findBubble, detectBubbles, paintBubble, paintCandidate, insideBubble, estimateLetterSize, eraseTextZone,
    textRect, fitText, wrap, wrapInfo, longestWordWidth, isDark, lum,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
