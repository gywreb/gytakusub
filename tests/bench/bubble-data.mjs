// Training pages for a bubble model of our own (4.0 step 3, ADR 0028): generated pages (bench/synth.mjs)
// with every bubble's shape known exactly, in Ultralytics' YOLO segmentation format.
//   node bench/bubble-data.mjs <out dir> [--train 3000] [--val 300] [--size 512] [--max N]
// --max N: stop after N new pages; run again to go on. The generator holds about 75 MB a page until
// its process ends (as for synth-run.mjs, which the bench runs 20 pages a process), so run it in
// chunks: until it prints "done".
// Writes <out>/images/{train,val}/*.jpg, <out>/labels/{train,val}/*.txt, <out>/data.yaml and
// <out>/manifest.json.
//
// Generated pages only: Manga109-s and the owner's reports are test sets, never training data.
// Seeds: training from 1,000,000, its own check during training (Ultralytics' "val") from
// 2,000,000. The bench's pages (0–149 looked at, 100,000–100,149 held out) are never used.
// Each page mixes the bench's kinds at random (fixed by its seed): lettering printed on things,
// the owner's bubble shapes, a webtoon's dark bubbles, lettering at the image's cut. Pages keep
// their lettering, as the model sees them in use.
// The label of a bubble is its inside and its outline as one shape: today's model (kitsumed's)
// draws its masks closer to that than to the inside alone (IoU 0.85 against 0.82 on looked-at
// pages, 3.6). Images are saved with their long side at --size (the engine's input, 512):
// Ultralytics brings every image to that size before augmenting, so more pixels add nothing.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createCanvas } from "canvas";
const here = path.dirname(new URL(import.meta.url).pathname);
globalThis.__dirname ??= here;
globalThis.require ??= createRequire(import.meta.url);
const { getCV } = await import("../../extension/engine/cv.js");
const { makePage, rng } = await import("./synth.mjs");
const cv = await getCV({ wasmBinary: fs.readFileSync(path.join(here, "../../extension/vendor/opencv_js.wasm")) });
process.removeAllListeners("unhandledRejection");
process.removeAllListeners("uncaughtException");

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const nTrain = +opt("--train", 3000), nVal = +opt("--val", 300), size = +opt("--size", 512), most = +opt("--max", 0);
const out = argv[0];
if (!out) { console.error("usage: node bench/bubble-data.mjs <out dir> [--train N] [--val N] [--size px]"); process.exit(2); }
const SPLITS = { train: { first: 1_000_000, count: nTrain }, val: { first: 2_000_000, count: nVal } };
for (const s of Object.values(SPLITS)) if (s.first < 1_000_000) throw new Error("training seeds start at 1,000,000: below are the bench's pages");

/** The page's kinds, from its seed. */
const kindsOf = (seed) => { const r = rng(seed * 31 + 7); return { printed: r() < 0.5, readers: r() < 0.5, webtoon: r() < 0.5, cutLettering: r() < 0.25 }; };

/** A bubble's shape (inside ∪ outline) as polygons in pixels: the largest piece, and any other piece
 *  over a tenth of the shape (a bubble a panel's edge cuts in two shows as two). */
function polygons(b, W, H) {
  const m = cv.Mat.zeros(H, W, cv.CV_8UC1), d = m.data;
  for (let q = 0; q < W * H; q++) if (b.inside[q] || b.outline?.[q]) d[q] = 255;
  // (the generator cuts the inside a half pixel short of the outline: closed, they are one shape)
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.morphologyEx(m, m, cv.MORPH_CLOSE, k); k.delete();
  const contours = new cv.MatVector(), hier = new cv.Mat();
  cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
  const pieces = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i), area = cv.contourArea(c), ap = new cv.Mat();
    cv.approxPolyDP(c, ap, 1.0, true);
    const pts = []; for (let k = 0; k < ap.rows; k++) pts.push([ap.data32S[2 * k], ap.data32S[2 * k + 1]]);
    if (pts.length >= 3) pieces.push({ area, pts });
    c.delete(); ap.delete();
  }
  m.delete(); contours.delete(); hier.delete();
  pieces.sort((a, b2) => b2.area - a.area);
  const total = pieces.reduce((n, p) => n + p.area, 0);
  return pieces.filter((p, i) => i === 0 || p.area >= 0.1 * total);
}

const commit = (() => { try { return execSync("git rev-parse HEAD", { cwd: here }).toString().trim(); } catch { return null; } })();
const stats = { pages: 0, bubbles: 0, dark: 0, split: 0, kinds: { printed: 0, readers: 0, webtoon: 0, cutLettering: 0 } };
let stopped = false;
for (const [split, { first, count }] of Object.entries(SPLITS)) {
  const imgDir = path.join(out, "images", split), lblDir = path.join(out, "labels", split);
  fs.mkdirSync(imgDir, { recursive: true }); fs.mkdirSync(lblDir, { recursive: true });
  for (let seed = first; seed < first + count; seed++) {
    const name = `s${seed}`;
    if (fs.existsSync(path.join(lblDir, name + ".txt"))) continue; // (a run stopped half way goes on)
    if (most && stats.pages >= most) { stopped = true; break; }
    const kinds = kindsOf(seed), pg = makePage(seed, kinds), { W, H } = pg;
    const lines = [];
    for (const b of pg.bubbles.filter((q) => q.inside)) {
      const polys = polygons(b, W, H);
      if (polys.length > 1) stats.split++;
      for (const p of polys) lines.push("0 " + p.pts.map(([x, y]) => `${(x / W).toFixed(5)} ${(y / H).toFixed(5)}`).join(" "));
      stats.bubbles++;
      if (b.shape === "dark" || pg.blocks.some((x) => x.bubble === b.id && x.dark)) stats.dark++;
    }
    const k = size / Math.max(W, H), w = Math.round(W * k), h = Math.round(H * k);
    const full = createCanvas(W, H); full.getContext("2d").putImageData(pg.input, 0, 0);
    const small = createCanvas(w, h), sx = small.getContext("2d"); sx.imageSmoothingQuality = "high"; sx.drawImage(full, 0, 0, w, h);
    fs.writeFileSync(path.join(imgDir, name + ".jpg"), small.toBuffer("image/jpeg", { quality: 0.95 }));
    fs.writeFileSync(path.join(lblDir, name + ".txt"), lines.join("\n") + (lines.length ? "\n" : "")); // (written last: a page with its label is done)
    stats.pages++; for (const [kk, v] of Object.entries(kinds)) if (v) stats.kinds[kk]++;
    if (stats.pages % 100 === 0) console.log(`${split} ${seed - first + 1}/${count}`);
  }
}
if (stopped) { console.log(`${stats.pages} pages; run again to go on`); process.exit(0); }
fs.writeFileSync(path.join(out, "data.yaml"), "# written by tests/bench/bubble-data.mjs (scripts/train-bubbles.py writes its own, with the folder's full path)\ntrain: images/train\nval: images/val\nnames:\n  0: speech bubble\n");
// the whole set, as the chunks left it
const whole = {};
for (const [split, { first, count }] of Object.entries(SPLITS)) {
  const w = (whole[split] = { pages: 0, shapes: 0, kinds: { printed: 0, readers: 0, webtoon: 0, cutLettering: 0 } });
  for (let seed = first; seed < first + count; seed++) {
    const f = path.join(out, "labels", split, `s${seed}.txt`); if (!fs.existsSync(f)) continue;
    w.pages++; w.shapes += fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length;
    for (const [kk, v] of Object.entries(kindsOf(seed))) if (v) w.kinds[kk]++;
  }
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ generator: "tests/bench/bubble-data.mjs", commit, splits: SPLITS, size, label: "inside ∪ outline, polygons (approxPolyDP 1 px)", set: whole }, null, 2) + "\n");
console.log("done", JSON.stringify(whole));
