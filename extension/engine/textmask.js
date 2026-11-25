// The learned text mask (3.2): which pixels of a text region's crop are lettering, from a model
// trained on comic text crops (vendor/textmask.onnx: comic-text-mask, a U-Net on a ResNet-18, MIT;
// scripts/vendor-textmask.mjs). The eraser takes its mask in place of its rules' (erase.js:
// lettering by polarity, by colour against the surround, by pen), which leave lettering over art,
// coloured lettering on dark or gradient bubbles, and white lettering on a dark ground.
//
// Each region gets a crop around the lines it will erase (textCrops), run as the authors run
// theirs: scaled to INPUT on its long side and letterboxed into INPUT x INPUT. Run at its own size
// instead (tried first, at a fraction of the time on one CPU thread), the model took the whole of a
// dark bubble lettered 11 px tall for lettering; at the authors' size, it took the letters.
import { run, getOrt } from "./ort.js";
import { plainBubble } from "./erase.js";

/** The square every crop is run in, scaled to it on its long side (the authors' input size). */
export const INPUT = 384;

/**
 * A loaded text-mask model.
 * @param {object} session an ONNX Runtime session of vendor/textmask.onnx
 * @param {{ep?: string, threshold?: number}} [cfg]
 */
export function textMasker(session, cfg = {}) {
  return { session, ort: getOrt(), ep: cfg.ep || "wasm", threshold: cfg.threshold ?? 0.5 };
}

/**
 * The crops a page's regions are masked in: one per region, around the lines the eraser will erase,
 * padded by half a letter (punctuation, long vowel marks and accents reach past the detector's
 * boxes): a bubble's blocks and the detector's lines in it, a free text's paragraph, as the
 * authors run their model on a detector's text region. (A crop per line of free text, tried first,
 * ran the model five times for one paragraph.) None for a bubble with a plain surface (erase.js
 * plainBubble), whose lettering the rules find whole.
 * @param {{regions: Array, lines?: Array, insideOf?: Function}} analysis
 * @param {Set<number>} regionIds the regions to erase (layout.js)
 * @param {ImageData} img the slice
 * @returns {Array<{region:number, x:number, y:number, w:number, h:number}>}
 */
export function textCrops(analysis, regionIds, img) {
  const { width: W, height: H } = img;
  const out = [];
  for (const r of analysis.regions) {
    if (!regionIds.has(r.id) || plainBubble(img, analysis, r)) continue;
    const blocks = r.kind === "bubble" ? r.ref?.blocks || [] : r.ref ? [r.ref] : [];
    if (!blocks.length) continue;
    const pad = Math.max(4, Math.round(0.5 * Math.max(r.letter || 0, 8)));
    const boxes = blocks.map((b) => b.gbox);
    // a bubble's lines as the detector found them too (a coloured line the analysis sized by its core)
    const inside = r.kind === "bubble" ? analysis.insideOf?.(r.id) : null;
    if (inside) for (const l of analysis.lines || []) if (inside(l.x + l.w / 2, l.y + l.h / 2)) boxes.push(l);
    const x = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.x)) - pad)), y = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.y)) - pad));
    const w = Math.min(W, Math.ceil(Math.max(...boxes.map((b) => b.x + b.w)) + pad)) - x, h = Math.min(H, Math.ceil(Math.max(...boxes.map((b) => b.y + b.h)) + pad)) - y;
    if (w >= 4 && h >= 4) out.push({ region: r.id, x, y, w, h });
  }
  return out;
}

/**
 * Each crop's mask: 1 where the model sees lettering, at the crop's own size (`mask`, w * h).
 * @param {ReturnType<typeof textMasker>} masker
 * @param {ImageData} img the slice
 * @param {Array<{x:number,y:number,w:number,h:number}>} crops from textCrops
 * @returns {Promise<Array<{x:number,y:number,w:number,h:number,region:number,mask:Uint8Array}>>}
 */
export async function maskText(masker, img, crops) {
  const out = [], plane = INPUT * INPUT;
  for (const c of crops) {
    const s = INPUT / Math.max(c.w, c.h), w = Math.min(INPUT, Math.round(c.w * s)), h = Math.min(INPUT, Math.round(c.h * s));
    // the crop at the input's scale (by area where smaller, bilinear where larger), at its top left;
    // the rest of the square 0, as the authors pad
    const x = new Float32Array(3 * plane);
    sample(img, c, s, w, h, (q, r, g, b) => { x[q] = r; x[plane + q] = g; x[2 * plane + q] = b; });
    const res = await run(masker.session, { image: new masker.ort.Tensor("float32", x, [1, 3, INPUT, INPUT]) });
    const prob = res.text.data;
    // back at the crop's own size: the probability at each pixel's centre, bilinear
    const mask = new Uint8Array(c.w * c.h);
    for (let yy = 0; yy < c.h; yy++) {
      const v = Math.min(h - 1, Math.max(0, (yy + 0.5) * s - 0.5)), y0 = Math.floor(v), y1 = Math.min(h - 1, y0 + 1), fy = v - y0;
      for (let xx = 0; xx < c.w; xx++) {
        const u = Math.min(w - 1, Math.max(0, (xx + 0.5) * s - 0.5)), x0 = Math.floor(u), x1 = Math.min(w - 1, x0 + 1), fx = u - x0;
        const p = (1 - fy) * ((1 - fx) * prob[y0 * INPUT + x0] + fx * prob[y0 * INPUT + x1]) + fy * ((1 - fx) * prob[y1 * INPUT + x0] + fx * prob[y1 * INPUT + x1]);
        if (p > masker.threshold) mask[yy * c.w + xx] = 1;
      }
    }
    res.text.dispose?.();
    out.push({ ...c, mask });
  }
  return out;
}

/**
 * The masks of the regions `ids`, each made once for its crop: a region masked before at the same
 * crop keeps its mask (`cache`, a Map per slice, region id to mask), one whose crop has changed is
 * masked again. Between the prefill (every region, while Claude reads the page) and the page's
 * finish, the layout adopts lines into a region and looking again finds more: a mask kept from
 * before would leave their lettering, which the rules, skipped there, would have erased.
 * @returns {Promise<{masks: Array, made: number}>} the masks, and how many were made now
 */
export async function masksFor(masker, img, analysis, ids, cache) {
  const same = (a, b) => a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  const crops = textCrops(analysis, ids, img), fresh = crops.filter((c) => !same(cache.get(c.region), c));
  for (const m of await maskText(masker, img, fresh)) cache.set(m.region, m);
  return { masks: crops.map((c) => cache.get(c.region)), made: fresh.length };
}

// The crop `c` of `img` scaled by `s` to w x h: each pixel's colour to `put(index in a row of
// INPUT, r, g, b)`. Scaled down, a pixel is the mean of the crop's pixels under it; up, bilinear.
function sample(img, c, s, w, h, put) {
  const { width: W, data: px } = img;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    let r = 0, g = 0, b = 0;
    if (s < 1) {
      const sy0 = c.y + Math.floor(yy / s), sy1 = Math.max(sy0 + 1, c.y + Math.min(c.h, Math.floor((yy + 1) / s)));
      const sx0 = c.x + Math.floor(xx / s), sx1 = Math.max(sx0 + 1, c.x + Math.min(c.w, Math.floor((xx + 1) / s)));
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { const p = (sy * W + sx) * 4; r += px[p]; g += px[p + 1]; b += px[p + 2]; n++; }
      r /= n; g /= n; b /= n;
    } else {
      const v = Math.min(c.h - 1, Math.max(0, (yy + 0.5) / s - 0.5)), u = Math.min(c.w - 1, Math.max(0, (xx + 0.5) / s - 0.5));
      const y0 = Math.floor(v), x0 = Math.floor(u), y1 = Math.min(c.h - 1, y0 + 1), x1 = Math.min(c.w - 1, x0 + 1), fy = v - y0, fx = u - x0;
      const at = (yy2, xx2, k) => px[((c.y + yy2) * W + c.x + xx2) * 4 + k];
      const bl = (k) => (1 - fy) * ((1 - fx) * at(y0, x0, k) + fx * at(y0, x1, k)) + fy * ((1 - fx) * at(y1, x0, k) + fx * at(y1, x1, k));
      r = bl(0); g = bl(1); b = bl(2);
    }
    put(yy * INPUT + xx, r, g, b);
  }
}
