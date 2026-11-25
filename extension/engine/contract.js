// What passes between the engine and whoever asks a model to read a page: how a page is cut
// into the slices the model sees, and how the model's answer is checked and turned into page
// fractions. It imports nothing, so any thread can load it without the engine's models
// (scripts/check-engine-contract.mjs keeps it that way). prompt.js re-exports it.

/** Kinds of lettering left as drawn: Claude labels them rather than leaving them out, which it does not reliably do. */
export const LEFT_AS_DRAWN = new Set(["sfx", "logo"]);

/**
 * Convert one slice's raw model items to full-image fractions.
 * @param {Array<{kind: string, source: string, text: string}>|null} [dropped] the lines labelled sound
 *   effect or logo are left as drawn; given, they are added to it (for the debug report: a line
 *   Claude labelled "sfx" that a character says is lost, and the report showed nothing; 2.14.1)
 * @returns {Array}
 */
export function normalizeItems(rawItems, s, width, height, dropped = null) {
  const items = [];
  for (const it of rawItems) {
    let box = null;
    if (Array.isArray(it.box) && it.box.length === 4) {
      let [bx, by, bw, bh] = it.box.map(Number);
      if ([bx, by, bw, bh].every(Number.isFinite)) {
        bx = Math.max(0, Math.min(s.cw, bx));
        by = Math.max(0, Math.min(s.ch, by));
        bw = Math.max(1, Math.min(s.cw - bx, bw));
        bh = Math.max(1, Math.min(s.ch - by, bh));
        box = [(s.x + (bx / s.cw) * s.w) / width, (s.y + (by / s.ch) * s.h) / height, ((bw / s.cw) * s.w) / width, ((bh / s.ch) * s.h) / height];
      }
    }
    let tag = Number(it.tag);
    if (!Number.isInteger(tag) || tag < s.tagFrom || tag > s.tagTo) tag = null;
    if (!box && tag === null) continue;
    // (where it was too, so a report shows whether a line left as a sound effect sat in a bubble: 3.3)
    if (LEFT_AS_DRAWN.has(it.kind) && it.text) dropped?.push({ kind: it.kind, source: String(it.source || ""), text: String(it.text), tag, box });
    if (LEFT_AS_DRAWN.has(it.kind) || !it.text) continue;
    items.push({
      tag, box,
      kind: it.kind || "bubble",
      size: ["small", "normal", "large"].includes(it.size) ? it.size : "normal",
      source: String(it.source || ""),
      text: String(it.text || ""),
      ...(it.same ? { same: true } : {}), // as drawn already (checkCopies)
    });
  }
  return items;
}

/**
 * A reader's reply as the answer ({items, terms}): the first JSON object in it, code fences and prose
 * around it tolerated. A reply cut off partway (max_tokens), or whose JSON breaks partway, keeps the
 * items complete before the break (`salvaged`: how many; null when the reply was whole). Before 3.3
 * such a reply failed the page. Throws when nothing in it can be read.
 * @returns {{items: Array, terms: Array, salvaged: number|null}}
 */
export function parseAnswer(text) {
  if (!text || !String(text).trim()) throw new Error("Empty model response");
  text = String(text);
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{"), end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const o = JSON.parse(candidate.slice(start, end + 1));
      return { items: Array.isArray(o?.items) ? o.items : [], terms: Array.isArray(o?.terms) ? o.terms : [], salvaged: null };
    } catch { /* broken partway: the complete items below */ }
  }
  const at = text.search(/"items"\s*:\s*\[/);
  if (at < 0) throw new Error("No JSON object in model response");
  const items = [];
  let i = text.indexOf("[", at) + 1;
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (text[i] !== "{") break;
    const j = objectEnd(text, i);
    if (j < 0) break;
    try { items.push(JSON.parse(text.slice(i, j + 1))); } catch { break; }
    i = j + 1;
  }
  if (!items.length) throw new Error("No complete item in the model's answer");
  return { items, terms: [], salvaged: items.length };
}

/** Where the JSON object opening at `i` closes (strings and escapes skipped), -1 if it doesn't. */
function objectEnd(t, i) {
  let depth = 0, str = false, esc = false;
  for (let k = i; k < t.length; k++) {
    const c = t[k];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return k;
  }
  return -1;
}

/** A line's words for comparing two lines: letters and digits, lower case, no accents. */
export const wordsOf = (s) => String(s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") || "";

/**
 * The ways a reader may write a box. The contract asks for [x, y, w, h] in pixels of the image it
 * saw; others: Gemini's documented boxes are [y_min, x_min, y_max, x_max] on a 0–1000 grid, and a
 * reader may give fractions of the image, or corners instead of a size. A way is its scale (pixels,
 * fractions, a 0–1000 grid), its order (x first or y first) and its form (a size or corners).
 */
export const BOX_WAYS = ["px", "frac", "grid"].flatMap((scale) => ["xy", "yx"].flatMap((order) => ["size", "corners"].map((form) => `${scale}-${order}-${form}`)));
export const CONTRACT_WAY = "px-xy-size";

/** A box written `way`, as the contract's [x, y, w, h] in pixels of a cw × ch image (null if unreadable). */
export function boxInWay(box, way, cw, ch) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const v = box.map(Number);
  if (!v.every(Number.isFinite)) return null;
  const [scale, order, form] = way.split("-");
  let [a, b, c, d] = order === "yx" ? [v[1], v[0], v[3], v[2]] : v; // as x, y, then w, h or x1, y1
  const sx = scale === "frac" ? cw : scale === "grid" ? cw / 1000 : 1, sy = scale === "frac" ? ch : scale === "grid" ? ch / 1000 : 1;
  a *= sx; b *= sy; c *= sx; d *= sy;
  if (form === "corners") { c -= a; d -= b; }
  return [a, b, c, d];
}

/**
 * The way the answer's boxes are written, judged by what the analysis found in the image: each way
 * is tried on every box, and a box counts once where it holds found lettering (a text line half
 * inside it, or its centre on a line), and once more where its centre lies in the region the line's
 * mark names. Regions stand in for lines only when no line was found: a region can be a whole
 * bubble or a block of free text, where a box written any way lands by chance. The contract's way
 * stands unless another counts clearly more (by at least two boxes and a quarter of them): a box or
 * two off their lettering is a reader's ordinary error, not another way of writing.
 * @param {Array} rawItems the answer's items (boxes as the reader wrote them)
 * @param {{cw:number, ch:number}} s the image the reader saw
 * @param {{regions: Array<{id:number, box:{x:number,y:number,w:number,h:number}}>, lines: Array<{x:number,y:number,w:number,h:number}>}} found
 *   what the analysis found, in pixels of that image
 * @returns {{way: string, counts: Object<string, number>, boxes: number}}
 */
export function boxWay(rawItems, s, found) {
  const items = (Array.isArray(rawItems) ? rawItems : []).filter((it) => it && Array.isArray(it.box));
  const regions = found?.regions || [], lines = found?.lines?.length ? found.lines : regions.map((r) => r.box);
  const counts = {};
  if (!items.length || !lines.length) return { way: CONTRACT_WAY, counts, boxes: items.length };
  const inside = (r, x, y, g = 0) => x >= r.x - g && y >= r.y - g && x <= r.x + r.w + g && y <= r.y + r.h + g;
  const over = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (const way of BOX_WAYS) {
    let n = 0;
    for (const it of items) {
      const b = boxInWay(it.box, way, s.cw, s.ch);
      if (!b || !(b[2] > 0) || !(b[3] > 0)) continue;
      const x = b[0] + b[2] / 2, y = b[1] + b[3] / 2, r = { x: b[0], y: b[1], w: b[2], h: b[3] };
      if (x < 0 || y < 0 || x > s.cw || y > s.ch) continue;
      if (lines.some((l) => over(l, r) >= 0.5 * l.w * l.h || inside(l, x, y, Math.min(l.w, l.h) / 2))) n++;
      const tag = Number(it.tag), marked = Number.isInteger(tag) ? regions.find((q) => q.id === tag) : null;
      if (marked && inside(marked.box, x, y)) n++;
    }
    counts[way] = n;
  }
  let way = CONTRACT_WAY;
  for (const w of BOX_WAYS) if (counts[w] > counts[way]) way = w;
  if (way !== CONTRACT_WAY && counts[way] < counts[CONTRACT_WAY] + Math.max(2, Math.ceil(0.25 * items.length))) way = CONTRACT_WAY;
  return { way, counts, boxes: items.length };
}

/**
 * Every answer, whoever sent it, checked and repaired here, then made page fractions (normalizeItems).
 * Each repair is listed in `problems` (the debug report shows them):
 *   - the answer's items are not a list: none
 *   - boxes written another way (boxWay): read that way
 *   - the same line twice (its words and translation, in the same place; with no box, under the same mark): once
 *   - a line labelled a sound effect whose mark and box both put it in a speech bubble: dialogue. The
 *     prompt asks for sound effects drawn as part of the artwork; lettering in a bubble someone says,
 *     and labelled "sfx" it was left as drawn (2.14.1: a line a character says, lost)
 * @param {*} rawItems the answer's items
 * @param {object} s the slice (sliceGeometry, with cw, ch, tagFrom, tagTo)
 * @param {{regions: Array<{id:number, kind:string, box:object}>, lines: Array}|null} found what the analysis found in the
 *   slice (pixels of cw × ch): its regions (bubbles and free text) and text lines
 * @param {Array|null} [dropped] see normalizeItems
 * @returns {{items: Array, problems: Array<{what: string, [k: string]: *}>, from: number[]}} from: the
 *   index in the answer of each item kept
 */
export function checkAnswer(rawItems, s, width, height, found, dropped = null) {
  const problems = [];
  if (!Array.isArray(rawItems)) { problems.push({ what: "items not a list" }); return { items: [], problems, from: [] }; }
  const at = rawItems.map((it, i) => (it && typeof it === "object" ? i : -1)).filter((i) => i >= 0);
  let raw = at.map((i) => rawItems[i]);
  if (raw.length < rawItems.length) problems.push({ what: "items not objects", n: rawItems.length - raw.length });
  const { way, counts } = boxWay(raw, s, found);
  if (way !== CONTRACT_WAY) {
    raw = raw.map((it) => ({ ...it, box: boxInWay(it.box, way, s.cw, s.ch) }));
    problems.push({ what: "boxes written another way", way, counts });
  }
  raw = raw.map((it) => {
    if (it.kind !== "sfx" || !it.text) return it;
    const tag = Number(it.tag), r = Number.isInteger(tag) ? (found?.regions || []).find((q) => q.id === tag) : null, b = boxInWay(it.box, CONTRACT_WAY, s.cw, s.ch);
    if (!r || r.kind !== "bubble" || !b) return it;
    const x = b[0] + b[2] / 2, y = b[1] + b[3] / 2;
    if (x < r.box.x || y < r.box.y || x > r.box.x + r.box.w || y > r.box.y + r.box.h) return it;
    problems.push({ what: "a line in a bubble labelled a sound effect", source: String(it.source || "").slice(0, 60) });
    return { ...it, kind: "bubble" };
  });
  const kept = [], from = [];
  for (const [k, one] of raw.entries()) for (const it of normalizeItems([one], s, width, height, dropped)) {
    const w = wordsOf(it.source) || wordsOf(it.text);
    const twin = w && kept.find((k) => (wordsOf(k.source) || wordsOf(k.text)) === w && wordsOf(k.text) === wordsOf(it.text) && (it.box && k.box ? iou(it.box, k.box) > 0.5 : it.tag != null && k.tag === it.tag));
    if (twin) { problems.push({ what: "the same line twice", source: String(it.source).slice(0, 60) }); continue; }
    kept.push(it); from.push(at[k]);
  }
  return { items: kept, problems, from };
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const i = ix * iy; return i / Math.max(1e-12, a[2] * a[3] + b[2] * b[3] - i);
}

/** How a W×H page is cut for the model: one slice, or rows of a long strip. */
export function sliceGeometry(W, H, settings) {
  const isStrip = H > 2.2 * W && H > settings.sliceHeight;
  const out = [];
  if (isStrip) {
    const scale = Math.min(1, settings.stripWidth / W);
    const sliceOrigH = Math.round(settings.sliceHeight / scale);
    for (let y = 0; y < H; y += sliceOrigH) out.push({ x: 0, y, w: W, h: Math.min(sliceOrigH, H - y), scale });
  } else {
    out.push({ x: 0, y: 0, w: W, h: H, scale: Math.min(1, settings.maxLongEdge / Math.max(W, H)) });
  }
  return out;
}
