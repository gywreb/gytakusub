// The engine on real pages marked by researchers (Manga109-s), not on the owner's chapters.
//   node bench/manga109.mjs <dir> <out.jsonl> [--pick pick.tsv] [--half look|held] [--dump dir] [--fill aot]
// <dir> holds images/<book>/<NNN>.jpg, annotations/<book>.xml and annotations_COO/<book>.xml.
// Manga109-s may not be redistributed: its pages stay on the machine running this, never in the
// repo. Each image is a spread; each half is one page, as a reader shows it. For each page:
//   1. the engine analyses it (analysis regions: what Claude's numbered marks would be);
//   2. every line the researchers marked is translated: Claude's answer is simulated from their box
//      (moved and resized a little, as Claude's boxes are), tagged with the region holding it;
//   3. the page is erased and lettered as in the extension (Telea where the GPU fill would run);
//   4. it is scored against things the engine's rules can't bend:
//      found     the marked line lies in a region the engine found before any second look
//      left      the independent witness (bench/witness.mjs) still sees text there after erasing
//      damage    pixels changed away from every marked line (art, sound effects, outlines)
//      letter    the engine's letter size against one estimated from the box and its characters
//      small     the translation drawn under 0.7 of that estimated size (smallL: of the engine's own)
//      big       drawn over 1/0.7 (1.43) of that estimated size
//      smallWidth/Height/Both/Neither  what holds each smallL line small (bench/limits.mjs)
//      overArt   lines with over 3% of their ink on the page's dark pixels away from every marked
//                line: the bubble's outline or the art past it (perLine: each line's size and share)
// The books are split by a hash into "look" (failures there may be examined) and "held" (only
// ever counted), so a change can't pass by fitting what was looked at.
import "./tune-env.mjs"; // first: GYT_TUNE must be set before the engine loads
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, ImageData } from "canvas";
import { cv, detector, analyzePage } from "../cv-node.mjs";
import { lookAgain } from "../../extension/engine/page.js";
import { layout, tells } from "../../extension/engine/layout.js";
import { erase, fillTexture } from "../../extension/engine/erase.js";
import { loadLettering } from "../lettering-setup.mjs";
import { witness } from "./witness.mjs";
import { sizeLimits, limitCounts } from "./limits.mjs";
import { sizeLabel } from "./labels.mjs";

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const pickFile = opt("--pick"), half = opt("--half"), dump = opt("--dump"), limit = Number(opt("--limit") || 0), most = Number(opt("--max") || 0);
const fillWith = opt("--fill");
// --fill aot: textured areas filled by the learned model the extension runs on the CPU (AOT), as a
// user without a graphics card gets; by default Telea, which is faster and much worse over art
const inpainter = fillWith === "aot" ? await (async () => {
  const { getOrt, createSession, run } = await import("../../extension/engine/ort.js");
  const { session } = await createSession(new Uint8Array(fs.readFileSync(new URL("../../extension/vendor/inpaint.onnx", import.meta.url))), { gpu: false });
  return { ort: getOrt(), session, run };
})() : null;
if (fillWith && fillWith !== "aot") throw new Error(`--fill ${fillWith}: only "aot" (or nothing, for Telea)`);
let ran = 0; // (--max N: stop after N pages, for a loop that restarts it: node's memory only grows)
const [dir, outFile] = argv;
process.chdir(path.dirname(new URL(import.meta.url).pathname) + "/..");
const GyText = loadLettering();

// ---- annotations ----
const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
function pagesOf(xml, tag) {
  const pages = new Map();
  for (const m of xml.matchAll(/<page\b([^>]*?)(\/>|>([\s\S]*?)<\/page>)/g)) {
    const a = attrs(m[1]), items = [];
    for (const t of (m[3] || "").matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "g"))) {
      const b = attrs(t[1]);
      let box;
      if (b.xmin != null) box = { x: +b.xmin, y: +b.ymin, w: +b.xmax - +b.xmin, h: +b.ymax - +b.ymin };
      else { // onomatopoeia: a polygon x0 y0 x1 y1 …
        const xs = Object.keys(b).filter((k) => /^x\d+$/.test(k)).map((k) => +b[k]), ys = Object.keys(b).filter((k) => /^y\d+$/.test(k)).map((k) => +b[k]);
        box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      }
      items.push({ box, text: t[2].replace(/&[a-z]+;/g, "").trim() });
    }
    pages.set(+a.index, { W: +a.width, H: +a.height, items });
  }
  return pages;
}
const books = new Map();
const bookOf = (b) => {
  if (!books.has(b)) {
    const read = (k) => { const f = path.join(dir, k, b + ".xml"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; };
    books.set(b, { text: pagesOf(read("annotations"), "text"), sfx: pagesOf(read("annotations_COO"), "onomatopoeia") });
  }
  return books.get(b);
};

// ---- a deterministic stand-in for Claude ----
const rngOf = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; };
const WORDS = "you what is this the a to I it me that we are not no do have be so just know can get here there now go come all well right then why how really sorry wait yes okay look think want going something nothing never always again still too".split(" ");
const marksOnly = (s) => !/[\p{L}\p{N}]/u.test(s);
function english(src, r) {
  if (marksOnly(src)) return src.replace(/[…‥]/g, "...").replace(/[！]/g, "!").replace(/[？]/g, "?").replace(/\s/g, "") || "...";
  const n = [...src.replace(/\s/g, "")].length, want = Math.max(4, Math.round(n * 2.3));
  let s = "";
  while (s.length < want) s += (s ? " " : "") + WORDS[Math.floor(r() * WORDS.length)];
  return s.charAt(0).toUpperCase() + s.slice(1) + (r() < 0.3 ? "!" : r() < 0.5 ? "?" : ".");
}
const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const cover = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? (w * h) / Math.max(1, a.w * a.h) : 0; };
const grow = (b, k) => ({ x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k });

// ---- pages ----
let picks = pickFile ? fs.readFileSync(pickFile, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")) : null;
if (!picks) picks = fs.readdirSync(path.join(dir, "images")).flatMap((b) => fs.readdirSync(path.join(dir, "images", b)).map((f) => ["", b, f]));
if (half) picks = picks.filter((p) => p[0] === half);
if (limit) picks = picks.slice(0, limit);
// (appended line by line: a run stopped half way keeps what it did, and resumes after it)
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).page) : []);
if (dump) fs.mkdirSync(dump, { recursive: true });

for (const [split, book, file] of picks) {
  const idx = parseInt(path.basename(file), 10), b = bookOf(book);
  const ann = b.text.get(idx), son = b.sfx.get(idx);
  if (!ann) continue;
  const img = await loadImage(path.join(dir, "images", book, path.basename(file)));
  for (const side of [0, 1]) { // left page, right page
    const W = Math.round(img.width / 2), H = img.height, x0 = side * W;
    const mine = (it) => { const cx = it.box.x + it.box.w / 2; return cx >= x0 && cx < x0 + W; };
    const lines = ann.items.filter(mine).map((t) => ({ ...t, box: { ...t.box, x: t.box.x - x0 } }));
    const sfx = (son?.items || []).filter(mine).map((t) => ({ ...t, box: { ...t.box, x: t.box.x - x0 } }));
    const id = `${book}/${idx}${side ? "R" : "L"}`, r = rngOf(id);
    if (!lines.length || done.has(id)) continue;
    const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.drawImage(img, x0, 0, W, H, 0, 0, W, H);
    const pixels = ctx.getImageData(0, 0, W, H), before = new Uint8ClampedArray(pixels.data);
    const t0 = Date.now();
    const an = await analyzePage(pixels);
    const regionAt = (bx) => { const cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2; let best = null; for (const q of an.regions) if (inBox(q.box, cx, cy) && (!best || q.box.w * q.box.h < best.box.w * best.box.h)) best = q; return best; };
    const found = lines.map((l) => !!regionAt(l.box));
    // Claude's answer: one item per marked line, its box off by up to 15% of its size (a tenth of
    // them by up to 40%), tagged with the region holding the line's centre when there is one
    // Claude's size label, as Claude gives it for the line's size against the page's (bench/labels.mjs)
    const cellOf = (l) => { const n = [...l.text.replace(/\s/g, "")].length; return n ? 0.8 * Math.sqrt((l.box.w * l.box.h) / n) : 0; };
    const cells = lines.map(cellOf).filter(Boolean).sort((a, b) => a - b), pageCell = cells[cells.length >> 1] || 1, labelRnd = rngOf(id + "#size");
    const items = lines.map((l, i) => {
      const big = r() < 0.1 ? 0.4 : 0.15, j = (v) => (r() * 2 - 1) * big * v;
      const bx = { x: l.box.x + j(l.box.w), y: l.box.y + j(l.box.h), w: l.box.w * (1 + j(1)), h: l.box.h * (1 + j(1)) };
      const reg = regionAt(l.box);
      return { tag: reg ? reg.id : null, box: [bx.x / W, bx.y / H, bx.w / W, bx.h / H].map((v) => Math.max(0, Math.min(1, v))), text: english(l.text, r), size: sizeLabel((cellOf(l) || pageCell) / pageCell, labelRnd), kind: reg?.kind === "bubble" ? "bubble" : "narration", index: i };
    });
    await lookAgain(cv, pixels, an, items, detector);
    const { placements, regionIds } = layout(an, items);
    const res = erase(cv, pixels, an, regionIds, { keepMask: true, outline: 0.3 });
    const clean = await fillTexture(cv, inpainter, res.image, res);
    res.mask.delete(); res.surface.delete();
    const ms = Date.now() - t0;

    // left: witness text inside a marked line on the page, still seen after erasing
    const told = lines.map((l, i) => tells(items[i]));
    const was = await witness(new ImageData(before, W, H)), now = await witness(clean);
    let seen = 0, left = 0;
    const leftLines = new Set();
    for (const t of was.text) {
      const k = lines.findIndex((l, i) => told[i] && cover(t, grow(l.box, 6)) >= 0.5);
      if (k < 0) continue;
      seen++;
      if (now.text.some((q) => cover(t, q) >= 0.5 || cover(q, t) >= 0.5)) { left++; leftLines.add(k); }
    }
    // damage: pixels changed away from every marked line (dilated by 6 px)
    const keep = new Uint8Array(W * H);
    for (const l of lines) { const g = grow(l.box, 6); for (let y = Math.max(0, g.y | 0); y < Math.min(H, g.y + g.h); y++) keep.fill(1, y * W + Math.max(0, g.x | 0), y * W + Math.min(W, Math.ceil(g.x + g.w))); }
    let changed = 0, changedSfx = 0, sfxArea = 0;
    const sfxMask = new Uint8Array(W * H);
    for (const s of sfx) for (let y = Math.max(0, s.box.y | 0); y < Math.min(H, s.box.y + s.box.h); y++) for (let x = Math.max(0, s.box.x | 0); x < Math.min(W, s.box.x + s.box.w); x++) if (!keep[y * W + x]) sfxMask[y * W + x] = 1;
    const d = clean.data;
    for (let p = 0; p < W * H; p++) {
      if (sfxMask[p]) sfxArea++;
      if (keep[p]) continue;
      const a = (before[p * 4] + before[p * 4 + 1] + before[p * 4 + 2]) / 3, b2 = (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3;
      if (Math.abs(a - b2) > 40) { changed++; if (sfxMask[p]) changedSfx++; }
    }
    // letter size: the engine's against one from the line's box and its characters (a glyph's
    // cell is about box area / characters; its ink about 0.8 of the cell's side), and the size
    // the translation was drawn at against that
    const tc = createCanvas(W, H), tctx = tc.getContext("2d"); tctx.putImageData(clean, 0, 0);
    const sizes = [];
    GyText.draw(tctx, placements, { sizes });
    const letters = [];
    placements.forEach((p, k) => {
      if (p.item == null || !told[p.item]) return;
      const l = lines[p.item], n = [...l.text.replace(/\s/g, "")].length;
      if (!n) return;
      const est = 0.8 * Math.sqrt((l.box.w * l.box.h) / n);
      letters.push({ item: p.item, est: +est.toFixed(1), letter: +p.letter.toFixed(1), drawn: +(sizes[k] / 1.45).toFixed(1) });
    });
    // over the art: each translated line drawn alone; its ink on pixels dark in the original page
    // and away from every marked line (grown by 6 px). In a bubble that is its outline, or the art
    // past it. (3.0: the bench has no outline, so before 2.15 a line run over the outline into the
    // art counted as full size; this says which.)
    const lineArt = new Map();
    {
      // (the page's lines drawn all together, and again without this one: the difference is its
      // ink at the size the page gave it)
      const ac = createCanvas(W, H), ax = ac.getContext("2d"); GyText.draw(ax, placements, {});
      const sc = createCanvas(W, H), sx = sc.getContext("2d");
      placements.forEach((p, k) => {
        if (p.item == null || !told[p.item]) return;
        // drawn alone when that gives it the page's size (a build that sets each line on its own,
        // or one without `skip`), else the page without it
        const one = []; sx.clearRect(0, 0, W, H); GyText.draw(sx, [p], { sizes: one, pageTexts: placements.map((q) => q.text) });
        const alone = Math.abs(one[0] - sizes[k]) < 1e-6;
        if (!alone) { sx.clearRect(0, 0, W, H); GyText.draw(sx, placements, { skip: p }); }
        const R = p.rect, xa = Math.max(0, Math.floor(R.x - 60)), ya = Math.max(0, Math.floor(R.y - 60)), xb = Math.min(W, Math.ceil(R.x + R.w + 60)), yb = Math.min(H, Math.ceil(R.y + R.h + 60));
        if (!(xb > xa && yb > ya)) return;
        const da = ax.getImageData(xa, ya, xb - xa, yb - ya).data, dd = sx.getImageData(xa, ya, xb - xa, yb - ya).data;
        let all = 0, over = 0;
        for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
          const q = ((y - ya) * (xb - xa) + (x - xa)) * 4;
          if (alone ? dd[q + 3] <= 100 : da[q + 3] <= 100 || dd[q + 3] > 100) continue;
          all++;
          const o = y * W + x;
          if (!keep[o] && (before[o * 4] + before[o * 4 + 1] + before[o * 4 + 2]) / 3 < 100) over++;
        }
        lineArt.set(p.item, all ? over / all : 0);
      });
    }
    const limits = sizeLimits(GyText, placements, sizes, [...placements.keys()].filter((k) => { const p = placements[k]; return p.item != null && told[p.item] && sizes[k] / 1.45 < 0.7 * p.letter; }), W, H);
    const row = {
      split, page: id, ms, lines: lines.length, told: told.filter(Boolean).length, found: found.filter((f, i) => f && told[i]).length,
      placed: new Set(placements.filter((p) => p.item != null).map((p) => p.item)).size,
      seen, left, damage: +(1000 * changed / (W * H)).toFixed(2), sfxArea, sfxChanged: changedSfx,
      letterFar: letters.filter((x) => x.letter > 2 * x.est || x.letter < 0.5 * x.est).length, small: letters.filter((x) => x.drawn < 0.7 * x.est).length, big: letters.filter((x) => x.drawn > x.est / 0.7).length, smallL: letters.filter((x) => x.drawn < 0.7 * x.letter).length, measured: letters.length, ...limitCounts(limits),
      overArt: [...lineArt.values()].filter((v) => v > 0.03).length,
      // per line: [drawn / its lettering's size, share of its ink over the art]
      perLine: Object.fromEntries(letters.map((x) => [x.item, [+(x.drawn / x.letter).toFixed(3), +(lineArt.get(x.item) || 0).toFixed(3)]])),
      regions: an.regions.length, waste: an.regions.filter((q) => !lines.some((l) => cover(l.box, q.box) > 0 || cover(q.box, l.box) > 0) && !sfx.some((s) => cover(q.box, s.box) > 0.3)).length,
    };
    if (dump && split === "look") {
      fs.writeFileSync(path.join(dump, id.replace("/", "_") + ".json"), JSON.stringify({ row, lines: lines.map((l, i) => ({ box: l.box, text: l.text, found: found[i], left: leftLines.has(i) })), letters, placements: placements.map((p) => ({ rect: p.rect, letter: p.letter, item: p.item })), regions: an.regions.map((q) => ({ id: q.id, kind: q.kind, box: q.box, letter: q.letter })) }));
      fs.writeFileSync(path.join(dump, id.replace("/", "_") + ".png"), tc.toBuffer("image/png"));
    }
    fs.appendFileSync(outFile, JSON.stringify(row) + "\n"); // (after the dump: a page counted has its dump)
    an.dispose();
    if (most && ++ran >= most) process.exit(0);
  }
}
