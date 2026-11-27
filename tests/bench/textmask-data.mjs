// Training crops for the learned text mask (4.0 step 2, 3.6): generated pages (bench/synth.mjs), each
// lettering pixel known, cut into crops as the engine cuts them (engine/textmask.js textCrops).
//   node bench/textmask-data.mjs <out dir> [--train 1200] [--val 120] [--max N]
// Writes <out>/{train,val}/images/*.jpg, <out>/{train,val}/masks/*.png (255 = text) and
// <out>/manifest.json. --max N: stop after N new pages; run again to go on (the generator holds
// about 75 MB a page until its process ends: run it in chunks, until it prints "done").
//
// Generated pages only: Manga109-s and the owner's reports are test sets, never training data.
// Page seeds: training from 1,000,000, the check during training from 2,000,000; the bench's pages
// (0–149 looked at, 100,000+ held out) are never used. A page mixes the bench's kinds by its seed.
// Pages with a sound effect are skipped: the generator draws it into the art, so it would be
// labelled "not text", where the mask's authors label all lettering text.
// The label is the authors' (comic-localizer-text-masking, render.py): each glyph with its
// outline, and about 3 px around it (here: the lettering's footprint, grown by 2 px).
// The crops, per line on the page: one round its lettering (a region's crop: the line's box padded
// by half a letter, as textCrops pads), and one round a box placed the way Claude's are (moved and
// resized by up to 15%, one in ten by up to 40%, as synth-run.mjs simulates), padded the same; and
// per page, crops of art with no lettering in them, sized like lines (hatching, tone, strokes: what
// the mask must not take for lettering).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createCanvas } from "canvas";
const here = path.dirname(new URL(import.meta.url).pathname);
const { makePage, rng } = await import("./synth.mjs");

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const nTrain = +opt("--train", 1200), nVal = +opt("--val", 120), most = +opt("--max", 0);
const out = argv[0];
if (!out) { console.error("usage: node bench/textmask-data.mjs <out dir> [--train N] [--val N] [--max N]"); process.exit(2); }
const SPLITS = { train: { first: 1_000_000, count: nTrain }, val: { first: 2_000_000, count: nVal } };
for (const s of Object.values(SPLITS)) if (s.first < 1_000_000) throw new Error("training seeds start at 1,000,000: below are the bench's pages");
const kindsOf = (seed) => { const r = rng(seed * 31 + 7); return { printed: r() < 0.5, readers: r() < 0.5, webtoon: r() < 0.5, cutLettering: r() < 0.25 }; };

/** The page's lettering: every line's footprint (glyphs and outline), and the marks left as drawn, grown by 2 px. */
function letteringOf(pg) {
  const { W, H } = pg, m = new Uint8Array(W * H);
  for (const b of pg.blocks) for (const q of b.foot) m[q] = 1;
  const inp = pg.input.data, tr = pg.truth.data;
  for (const k of pg.kept) {
    const x0 = Math.max(0, Math.floor(k.box.x - 4)), y0 = Math.max(0, Math.floor(k.box.y - 4)), x1 = Math.min(W, Math.ceil(k.box.x + k.box.w + 4)), y1 = Math.min(H, Math.ceil(k.box.y + k.box.h + 4));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const q = (y * W + x) * 4; if (Math.abs(inp[q] - tr[q]) + Math.abs(inp[q + 1] - tr[q + 1]) + Math.abs(inp[q + 2] - tr[q + 2]) > 30) m[y * W + x] = 1; }
  }
  const g = new Uint8Array(W * H), R = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m[y * W + x]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= R * R) g[yy * W + xx] = 1; }
  }
  return g;
}

function save(dir, name, pg, lettering, c) {
  const { W } = pg, x = Math.round(c.x), y = Math.round(c.y), w = Math.round(c.w), h = Math.round(c.h);
  const img = createCanvas(w, h), ix = img.getContext("2d"), d = ix.createImageData(w, h);
  const msk = createCanvas(w, h), mx = msk.getContext("2d"), md = mx.createImageData(w, h);
  let text = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const q = (y + yy) * W + x + xx, o = (yy * w + xx) * 4;
    d.data[o] = pg.input.data[q * 4]; d.data[o + 1] = pg.input.data[q * 4 + 1]; d.data[o + 2] = pg.input.data[q * 4 + 2]; d.data[o + 3] = 255;
    const v = lettering[q] ? 255 : 0; if (v) text++;
    md.data[o] = md.data[o + 1] = md.data[o + 2] = v; md.data[o + 3] = 255;
  }
  ix.putImageData(d, 0, 0); mx.putImageData(md, 0, 0);
  fs.writeFileSync(path.join(dir, "images", name + ".jpg"), img.toBuffer("image/jpeg", { quality: 0.95 }));
  fs.writeFileSync(path.join(dir, "masks", name + ".png"), msk.toBuffer("image/png"));
  return text / (w * h);
}

const clip = (c, W, H) => { const x = Math.max(0, c.x), y = Math.max(0, c.y); return { x, y, w: Math.min(W, c.x + c.w) - x, h: Math.min(H, c.y + c.h) - y }; };
const padded = (b, letter) => { const p = Math.max(4, Math.round(0.5 * Math.max(letter || 0, 8))); return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p }; };
const commit = (() => { try { return execSync("git rev-parse HEAD", { cwd: here }).toString().trim(); } catch { return null; } })();
let stopped = false, made = 0;
for (const [split, { first, count }] of Object.entries(SPLITS)) {
  const dir = path.join(out, split);
  fs.mkdirSync(path.join(dir, "images"), { recursive: true }); fs.mkdirSync(path.join(dir, "masks"), { recursive: true }); fs.mkdirSync(path.join(dir, "done"), { recursive: true });
  for (let seed = first; seed < first + count; seed++) {
    const doneFile = path.join(dir, "done", `s${seed}`);
    if (fs.existsSync(doneFile)) continue; // (a run stopped half way goes on)
    if (most && made >= most) { stopped = true; break; }
    const kinds = kindsOf(seed), pg = makePage(seed, kinds), { W, H } = pg, r = rng(seed * 92821 + 5);
    let n = 0;
    if (!pg.sfx.length) {
      const lettering = letteringOf(pg);
      pg.blocks.forEach((b, i) => {
        // round its lettering, as a region's crop
        const j0 = (v) => (r() * 2 - 1) * 0.05 * v;
        const own = clip(padded({ x: b.box.x + j0(b.box.w), y: b.box.y + j0(b.box.h), w: b.box.w * (1 + j0(1)), h: b.box.h * (1 + j0(1)) }, b.letter), W, H);
        if (own.w >= 8 && own.h >= 8) { save(dir, `s${seed}-${i}-line`, pg, lettering, own); n++; }
        // round a box placed the way Claude's are
        const big = r() < 0.1 ? 0.4 : 0.15, j = (v) => (r() * 2 - 1) * big * v;
        const claude = clip(padded({ x: b.box.x + j(b.box.w), y: b.box.y + j(b.box.h), w: b.box.w * (1 + j(1)), h: b.box.h * (1 + j(1)) }, b.letter), W, H);
        if (claude.w >= 8 && claude.h >= 8) { save(dir, `s${seed}-${i}-box`, pg, lettering, claude); n++; }
      });
      // art with no lettering in it, sized like lines
      for (let k = 0, tries = 0; k < 3 && tries < 40; tries++) {
        const w = Math.round(60 + r() * 240), h = Math.round(30 + r() * 170), x = Math.round(r() * (W - w)), y = Math.round(r() * (H - h));
        let t = 0; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) t += lettering[yy * W + xx];
        if (t) continue;
        save(dir, `s${seed}-art${k}`, pg, lettering, { x, y, w, h }); k++; n++;
      }
    }
    fs.writeFileSync(doneFile, `${n}\n`); made++;
  }
  if (stopped) break;
}
if (stopped) { console.log(`${made} pages; run again to go on`); process.exit(0); }
const count = (split) => fs.readdirSync(path.join(out, split, "masks")).length;
const pages = (split) => fs.readdirSync(path.join(out, split, "done")).length;
const set = { train: { pages: pages("train"), crops: count("train") }, val: { pages: pages("val"), crops: count("val") } };
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ generator: "tests/bench/textmask-data.mjs", commit, splits: SPLITS, label: "each line's footprint (glyphs and outline) and the marks left as drawn, grown by 2 px", crops: "per line: round its lettering (box ±5%, padded by half a letter) and round a Claude-like box (±15%, one in ten ±40%), padded the same; per page: up to 3 crops of art with no lettering", skipped: "pages with a sound effect (drawn into the art)", set }, null, 2) + "\n");
console.log("done", JSON.stringify(set));
