// Simulated readers (3.3, ADR 0025): Claude's answer for a generated page as a reader that errs
// would give it, in the answer's own form (boxes in pixels of the image the reader saw, marks as
// the stamps' numbers), so it goes through the answer contract (engine/contract.js) like a real one.
//   strong: Haiku's error rates, measured on the owner's debug reports (3,505 lines on 826 pages;
//           the witness for lines missed and boxes on no lettering)
//   weak:   three times those, and the errors other readers make that Haiku's answers didn't show.
//           These numbers are mine, until 5.0's reading check measures real models.
// The exact reader is the bench's own (synth-run.mjs without --reader): every line, marked as its
// region, its box moved a little.
import { rng } from "./synth.mjs";

export const READERS = {
  strong: {
    miss: 0.032,      // a line left out (text in a bubble the witness sees that no line names: 3.2% at most)
    wrongMark: 0.013, // the mark of another region (a mark its own box overrules: 1.3%)
    noMark: 0.054,    // no mark for a line in a stamped region (5.4%)
    boxOff: 0.019,    // the box on no lettering (neither the box nor its region holds any: 1.9%)
  },
  weak: {
    miss: 0.096, wrongMark: 0.039, noMark: 0.162, boxOff: 0.057,
    asSfx: 0.03,      // dialogue labelled a sound effect (then left as drawn)
    merge: 0.05,      // two lines of one region given as one
    split: 0.05,      // one line given as two
    twice: 0.02,      // the same line twice
    invent: 0.02,     // a line for a region with no lettering in it
    convention: 0.5,  // of answers: every box in another convention (a 0–1000 grid as [y0, x0, y1, x1], page fractions, corners)
    cut: 0.05,        // of answers: cut off (max_tokens), and with it unreadable
  },
};

const CONVENTIONS = ["grid1000yx", "fractions", "corners"];

/**
 * The reader's answer to a page whose exact items are `items` (boxes as page fractions, marks as
 * region ids), with `profile`'s errors drawn from a stream of its own (`seed`).
 * @returns {{items: object[], carry: number[][], convention: string|null, cut: number|null}} raw items
 *   (the answer's JSON items) and, for each, the indices of the page's lines it carries; cut: where
 *   the answer's text stops, as a share of its length (null: whole)
 */
export function readAnswer(items, regions, profile, seed, W, H) {
  const r = rng(seed), p = (k) => r() < (profile[k] || 0);
  // cut off: the answer's text stops at a point drawn here (the caller cuts the JSON there)
  const cut = p("cut") ? 0.2 + 0.75 * r() : null;
  const centre = (q) => [q.box.x + q.box.w / 2, q.box.y + q.box.h / 2];
  const byId = new Map(regions.map((q) => [q.id, q]));
  const named = new Set(items.map((it) => it.tag).filter((t) => t != null));
  const out = [], errs = items.map(() => []); // errs[i]: what the reader did wrong with line i
  for (const [i, it] of items.entries()) {
    if (p("miss")) { errs[i].push("miss"); continue; }
    let tag = it.tag, box = it.box ? it.box.slice() : null, kind = it.kind;
    if (p("asSfx")) { kind = "sfx"; errs[i].push("asSfx"); }
    if (tag != null && p("wrongMark")) {
      // a stamp read as its neighbour's: the region nearest the marked one
      const [cx, cy] = centre(byId.get(tag)); let best = null, d = Infinity;
      for (const q of regions) { if (q.id === tag) continue; const [x, y] = centre(q), e = (x - cx) ** 2 + (y - cy) ** 2; if (e < d) { d = e; best = q; } }
      if (best) { tag = best.id; errs[i].push("wrongMark"); }
    }
    if (tag != null && p("noMark")) { tag = null; errs[i].push("noMark"); }
    if (box && p("boxOff")) {
      // moved off its lettering by two to three of its sizes, kept on the page
      const a = r() * 2 * Math.PI, k = 2 + r();
      box[0] = Math.max(0, Math.min(1 - box[2], box[0] + Math.cos(a) * k * box[2]));
      box[1] = Math.max(0, Math.min(1 - box[3], box[1] + Math.sin(a) * k * box[3]));
      errs[i].push("boxOff");
    }
    const one = { tag, box, kind, size: it.size, source: it.source, text: it.text };
    const words = String(it.text).split(" ");
    if (box && words.length >= 2 && p("split")) {
      const h = words.length >> 1, half = [box[0], box[1], box[2] / 2, box[3]];
      out.push({ item: { ...one, box: half, text: words.slice(0, h).join(" ") }, carry: [i] });
      out.push({ item: { ...one, box: [box[0] + box[2] / 2, box[1], box[2] / 2, box[3]], text: words.slice(h).join(" ") }, carry: [i] });
      errs[i].push("split");
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && tag != null && prev.item.tag === tag && prev.item.box && box && p("merge")) {
      const b = prev.item.box, x0 = Math.min(b[0], box[0]), y0 = Math.min(b[1], box[1]);
      prev.item = { ...prev.item, text: `${prev.item.text} ${one.text}`, source: `${prev.item.source} ${one.source}`, box: [x0, y0, Math.max(b[0] + b[2], box[0] + box[2]) - x0, Math.max(b[1] + b[3], box[1] + box[3]) - y0] };
      prev.carry.push(i); errs[i].push("merge");
      continue;
    }
    out.push({ item: one, carry: [i] });
    if (p("twice")) { out.push({ item: { ...one }, carry: [i] }); errs[i].push("twice"); }
  }
  // a line for a stamped region no line is in (art the analysis took for lettering)
  for (const q of regions) {
    if (named.has(q.id) || !p("invent")) continue;
    out.push({ item: { tag: q.id, box: [q.box.x / W, q.box.y / H, q.box.w / W, q.box.h / H], kind: "bubble", size: "normal", source: "…", text: "Nothing here." }, carry: [] });
  }
  // the answer's boxes: pixels of the image, [x, y, w, h], or another convention for every box
  const convention = p("convention") ? CONVENTIONS[Math.floor(r() * CONVENTIONS.length)] : null;
  const toAnswer = (b) => {
    if (!b) return null;
    const [x, y, w, h] = b;
    if (convention === "grid1000yx") return [y, x, y + h, x + w].map((v) => Math.round(v * 1000));
    if (convention === "fractions") return [x, y, w, h].map((v) => +v.toFixed(4));
    if (convention === "corners") return [x * W, y * H, (x + w) * W, (y + h) * H].map(Math.round);
    return [x * W, y * H, w * W, h * H].map(Math.round);
  };
  return { items: out.map((o) => ({ ...o.item, box: toAnswer(o.item.box) })), carry: out.map((o) => o.carry), convention, cut, errs };
}
