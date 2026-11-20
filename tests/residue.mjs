// "Marks left" after erasing one region (the measure behind the 2.12.0 gate; tests/audit-core.mjs
// and tone.test.mjs). The lettering's window (its detected lines grown by half a letter) is compared,
// after erasing, with the region's own surface around it (the "ring": inside the bubble, near the
// window, outside it): edge density (ghost outlines raise it, white clouds on screentone lower it),
// level against the ring's, and the share of pixels far from that level, each against the
// ring, so flat and toned surfaces measure alike. `left` ≥ 0.15 = marks left.
// (2.12.0 fixes: whole-pixel bounds for free text, which read nothing before; level against the
// ring's mean, not its median; the ring is only what the eraser left alone, since lettering
// outside the window, which the eraser removed too, is not the surface.)
const lum = (d, p) => (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3;

/**
 * @param {Uint8ClampedArray} before RGBA page before erasing, @param {Uint8ClampedArray} after RGBA after
 * @param {{box, letter, ref}} r a region from analyze(); `inside(x, y)` its interior (null: the box)
 * @returns {{lettered: boolean, left: number, dirty: boolean}|null} null when too small to judge
 */
export function marksLeft(before, after, W, H, r, inside) {
  const { x, y, w, h } = r.box, L = Math.max(4, r.letter || 8);
  // inside a bubble, only what lies half a letter in from its edge: the segmented interior reaches
  // into thick or spiky outlines and the art that crowds them, which is not the surface
  const e = inside ? Math.max(3, Math.round(L / 2)) : 3;
  const blocks = r.ref?.blocks || (r.ref?.gbox ? [r.ref] : []);
  const wins = blocks.map((b) => ({ x0: b.gbox.x - L / 2, y0: b.gbox.y - L / 2, x1: b.gbox.x + b.gbox.w + L / 2, y1: b.gbox.y + b.gbox.h + L / 2 }));
  const near = wins.map((q) => ({ x0: q.x0 - 1.5 * L, y0: q.y0 - 1.5 * L, x1: q.x1 + 1.5 * L, y1: q.y1 + 1.5 * L }));
  const inWin = (xx, yy) => wins.some((q) => xx >= q.x0 && xx < q.x1 && yy >= q.y0 && yy < q.y1);
  const inNear = (xx, yy) => near.some((q) => xx >= q.x0 && xx < q.x1 && yy >= q.y0 && yy < q.y1);
  const ins = inside || (() => true);
  const edge = (img, xx, yy) => Math.abs(lum(img, yy * W + xx + 1) - lum(img, yy * W + xx - 1)) + Math.abs(lum(img, (yy + 1) * W + xx) - lum(img, (yy - 1) * W + xx)) > 60;
  const ring = { n: 0, edges: 0, vals: [] }, win = { n: 0, eb: 0, ea: 0, sum: 0, vals: [], valsBefore: [] };
  // (whole pixels: a letter size is fractional, and a fractional position reads no pixel)
  const X0 = Math.round(inside ? x : x - 2 * L), Y0 = Math.round(inside ? y : y - 2 * L), X1 = Math.round(inside ? x + w : x + w + 2 * L), Y1 = Math.round(inside ? y + h : y + h + 2 * L);
  for (let yy = Math.max(1, Y0 + e); yy < Math.min(H - 1, Y1 - e); yy++) for (let xx = Math.max(1, X0 + e); xx < Math.min(W - 1, X1 - e); xx++) {
    if (!(ins(xx, yy) && ins(xx - e, yy) && ins(xx + e, yy) && ins(xx, yy - e) && ins(xx, yy + e))) continue;
    const p = yy * W + xx;
    if (inWin(xx, yy)) { win.n++; if (edge(before, xx, yy)) win.eb++; if (edge(after, xx, yy)) win.ea++; const v = lum(after, p); win.sum += v; win.vals.push(v); win.valsBefore.push(lum(before, p)); }
    // the ring: the surface the eraser left alone (pixels it changed were lettering it removed, or
    // its own fill spreading past the window, neither of which is the surface)
    else if (inNear(xx, yy) && Math.abs(lum(after, p) - lum(before, p)) <= 8) { ring.n++; if (edge(before, xx, yy)) ring.edges++; ring.vals.push(lum(before, p)); }
  }
  if (win.n <= 50 || ring.n <= 50) return null;
  const surf = ring.vals.slice().sort((p, q) => p - q)[ring.vals.length >> 1];
  const ringMean = ring.vals.reduce((s, v) => s + v, 0) / ring.n;
  const rr = ring.edges / ring.n, wb = win.eb / win.n, wa = win.ea / win.n;
  const far = (vals) => vals.filter((v) => Math.abs(v - surf) > 40).length / vals.length;
  // lettering was there: more edges than the surface has, or (on screentone, which is all edges)
  // more pixels far from its level
  const lettered = wb - rr > 0.02 || far(win.valsBefore) - far(ring.vals) > 0.05;
  const edgeDev = Math.abs(wa - rr) / Math.max(0.02, wb - rr);
  // level: the window's mean against the ring's mean (on screentone the median is the paper between
  // the dots, well above the mean)
  const lumDev = Math.abs(win.sum / win.n - ringMean);
  const pixDev = far(win.vals) - far(ring.vals);
  const left = Math.max(edgeDev / 0.3, lumDev / 18, pixDev / 0.08) * 0.15;
  // Valid on a plain surround (a flat or near-flat bubble): there the window should match the ring.
  // On a textured one (screentone, hatching, art: edges on 3% of the ring or more) it need not match
  // pixel for pixel and this measure misjudges both ways (seen on the real chapters), so those
  // areas are flagged `textured` and judged by the fill test against known backgrounds instead
  // (fill-truth.mjs).
  const textured = rr >= 0.03;
  return { lettered, left, dirty: lettered && left > 0.15, textured, edgeDev, lumDev, pixDev };
}
