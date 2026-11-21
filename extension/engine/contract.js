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
    if (LEFT_AS_DRAWN.has(it.kind) && it.text) dropped?.push({ kind: it.kind, source: String(it.source || ""), text: String(it.text) });
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
