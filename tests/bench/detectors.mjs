// Detectors trained on comics against today's (3.3, ADR 0024). Measures what a candidate model
// finds, not what the engine makes of it (bench/synth-run.mjs does that).
//   node bench/detectors.mjs lines <ctd.onnx> generated <first> <count> [--webtoon|--readers] <out.jsonl>
//   node bench/detectors.mjs lines <ctd.onnx> report <report dir> <out.jsonl>
//   node bench/detectors.mjs bubbles generated <first> <count> [--webtoon|--readers] <out.jsonl>
//   node bench/detectors.mjs summary <out.jsonl>...
// lines: comic-text-detector's line map (mayocream/comic-text-detector-onnx, its `det` output)
//   against today's line finding (the text detector and its second looks), and both together. On
//   generated pages a block is found when half its glyph pixels lie in found lines; on a debug
//   report (the owner's, never in the repo) an item Claude translated is found when a found line
//   lies half inside its box grown by 6 px.
// bubbles: the bubble model (vendor/segment.onnx, or the candidate GYT_SEGMENT names, with
//   GYT_SEGMENT_CONFIG; a box detector too) on generated pages: a drawn bubble is found when one
//   of the model's bubbles covers half its inside (its mask; its box when it has no mask); a model
//   bubble is false when under a fifth of its box lies on any drawn bubble's inside.
// Seeds 0–9999 may be looked at; from 100000 on, only counted.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, ImageData } from "canvas";
process.chdir(path.dirname(new URL(import.meta.url).pathname) + "/..");
const { cv, detector, segmenter } = await import("../cv-node.mjs");
const { detectText, detectInEmptyBubbles, detectInDarkShapes } = await import("../../extension/engine/detect.js");
const { segment } = await import("../../extension/engine/segment.js");
const { tells } = await import("../../extension/engine/layout.js");
const { createSession, getOrt, run } = await import("../../extension/engine/ort.js");
const { makePage } = await import("./synth.mjs");

const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(k); if (i < 0) return false; argv.splice(i, 1); return true; };
const pageOpts = { webtoon: flag("--webtoon"), readers: flag("--readers") };
const what = argv.shift();
const ortWasm = fs.readFileSync("../extension/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm").buffer;

/** Today's lines: the text detector, then its looks in dark shapes and in the bubble model's empty bubbles. */
async function todayLines(img) {
  let lines = await detectText(cv, detector, img);
  lines = await detectInDarkShapes(cv, detector, img, lines);
  const seg = segmenter ? await segment(segmenter, img) : null;
  return seg ? detectInEmptyBubbles(cv, detector, img, lines, seg.instances, segmenter.bubbleClasses) : lines;
}

/** comic-text-detector: the page fitted into 1024 (top left, RGB 0..1), its line map read as DB boxes. */
function textDetector(file) {
  const S = 1024, ort = getOrt({ wasmBinary: ortWasm }), ready = createSession(new Uint8Array(fs.readFileSync(file)), { wasmBinary: ortWasm });
  return async (img) => {
    const { session } = await ready, W = img.width, H = img.height, sc = S / Math.max(W, H), w = Math.round(W * sc), h = Math.round(H * sc);
    const src = cv.matFromImageData(img), rgb = new cv.Mat(), rs = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB); cv.resize(rgb, rs, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    const data = new Float32Array(3 * S * S), d = rs.data, plane = S * S;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = (y * w + x) * 3, q = y * S + x; data[q] = d[p] / 255; data[plane + q] = d[p + 1] / 255; data[2 * plane + q] = d[p + 2] / 255; }
    src.delete(); rgb.delete(); rs.delete();
    const t0 = Date.now(), out = await run(session, { images: new ort.Tensor("float32", data, [1, 3, S, S]) }), ms = Date.now() - t0;
    // DB post-processing as the model's own code: threshold 0.3, mean score 0.6, unclip 1.5
    const m = new cv.Mat(S, S, cv.CV_32F); m.data32F.set(out.det.data.subarray(0, S * S));
    const bin = new cv.Mat(), b8 = new cv.Mat(), L = new cv.Mat(), st = new cv.Mat(), ce = new cv.Mat();
    cv.threshold(m, bin, 0.3, 255, cv.THRESH_BINARY); bin.convertTo(b8, cv.CV_8U);
    const n = cv.connectedComponentsWithStats(b8, L, st, ce, 8, cv.CV_32S), Sx = st.data32S, P = m.data32F, LL = L.data32S, lines = [];
    for (let i = 1; i < n; i++) {
      const x = Sx[i * 5], y = Sx[i * 5 + 1], bw = Sx[i * 5 + 2], bh = Sx[i * 5 + 3], a = Sx[i * 5 + 4];
      if (a < 12 || bw < 3 || bh < 3 || x >= w || y >= h) continue;
      let sum = 0; for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) { const p = yy * S + xx; if (LL[p] === i) sum += P[p]; }
      if (sum / a < 0.6) continue;
      const dist = Math.max(1, (a * 1.5) / (2 * (bw + bh))), X = Math.max(0, (x - dist) / sc), Y = Math.max(0, (y - dist) / sc);
      lines.push({ x: X, y: Y, w: Math.min(W, (x + bw + dist) / sc) - X, h: Math.min(H, (y + bh + dist) / sc) - Y });
    }
    [m, bin, b8, L, st, ce].forEach((o) => o.delete());
    return { lines, ms };
  };
}

const kindOf = (b) => (b.shape === "dark" || (b.shape === "cutLettering" && b.dark) ? "dark" : b.bubble ? "bubble" : b.kind === "sign" ? "sign" : "free");
const done = (out, key) => new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)[key]) : []);

if (what === "lines") {
  const comicLines = textDetector(argv.shift()), source = argv.shift();
  if (source === "generated") {
    const [first, count, out] = [+argv[0], +argv[1], argv[2]], seen = done(out, "seed");
    const found = (b, lines, W) => { let hit = 0; for (const q of b.core) { const x = q % W, y = (q / W) | 0; if (lines.some((l) => x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h)) hit++; } return hit >= 0.5 * b.core.length; };
    for (let seed = first; seed < first + count; seed++) {
      if (seen.has(seed)) continue;
      const pg = makePage(seed, pageOpts), img = new ImageData(new Uint8ClampedArray(pg.input.data), pg.W, pg.H);
      const today = await todayLines(img), { lines: comic, ms } = await comicLines(img);
      const blocks = pg.blocks.filter((b) => b.core.length).map((b) => ({ kind: kindOf(b), today: found(b, today, pg.W), comic: found(b, comic, pg.W), both: found(b, today.concat(comic), pg.W) }));
      fs.appendFileSync(out, JSON.stringify({ seed, ms, blocks }) + "\n");
    }
  } else if (source === "report") {
    const [dir, out] = argv, seen = done(out, "page");
    const grow = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
    const cover = (a, b) => { const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); return (w * h) / Math.max(1, a.w * a.h); };
    const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
    for (const { id } of summary.pages) {
      if (seen.has(id) || !fs.existsSync(path.join(dir, `page-${id}.json`))) continue;
      const rep = JSON.parse(fs.readFileSync(path.join(dir, `page-${id}.json`), "utf8")), orig = fs.readdirSync(dir).find((f) => f.startsWith(`page-${id}.original.`));
      const told = (rep.items || []).filter((it) => it.box && tells(it));
      if (!told.length || !orig || !rep.work) continue;
      const { W, H } = rep.work, c = createCanvas(W, H), x = c.getContext("2d"); x.drawImage(await loadImage(path.join(dir, orig)), 0, 0, W, H);
      const img = x.getImageData(0, 0, W, H), today = await todayLines(img), { lines: comic, ms } = await comicLines(img);
      const items = told.map((it) => { const b = grow({ x: it.box[0] * W, y: it.box[1] * H, w: it.box[2] * W, h: it.box[3] * H }, 6), f = (L) => L.some((l) => cover(l, b) >= 0.5); return { kind: it.kind, today: f(today), comic: f(comic), both: f(today.concat(comic)) }; });
      fs.appendFileSync(out, JSON.stringify({ page: id, ms, blocks: items }) + "\n");
    }
  }
} else if (what === "bubbles") {
  argv.shift(); // "generated"
  const [first, count, out] = [+argv[0], +argv[1], argv[2]], seen = done(out, "seed");
  for (let seed = first; seed < first + count; seed++) {
    if (seen.has(seed)) continue;
    const pg = makePage(seed, pageOpts), W = pg.W, H = pg.H, img = new ImageData(new Uint8ClampedArray(pg.input.data), W, H);
    const t0 = Date.now(), seg = await segment(segmenter, img), ms = Date.now() - t0;
    const inst = seg.instances.filter((s) => segmenter.bubbleClasses.has(s.cls));
    const on = new Uint8Array(W * H); for (const b of pg.bubbles) if (b.inside) for (let q = 0; q < W * H; q++) if (b.inside[q]) on[q] = 1;
    const covers = (s, b, n) => { let k = 0; const { x, y, w, h } = s.box; for (let Y = Math.max(0, y); Y < Math.min(H, y + h); Y++) for (let X = Math.max(0, x); X < Math.min(W, x + w); X++) if (b.inside[Y * W + X] && (!s.mask || s.mask[(Y - y) * w + (X - x)])) k++; return k >= 0.5 * n; };
    const bubbles = pg.bubbles.filter((b) => b.inside).map((b) => {
      let n = 0; for (let q = 0; q < W * H; q++) n += b.inside[q];
      const dark = b.shape === "dark" || !!pg.blocks.find((x) => x.bubble === b.id)?.dark;
      return { kind: dark ? "dark" : "light", cut: b.shape === "cut", found: inst.some((s) => covers(s, b, n)) };
    });
    const falseN = inst.filter((s) => { const { x, y, w, h } = s.box; let k = 0; for (let Y = Math.max(0, y); Y < Math.min(H, y + h); Y++) for (let X = Math.max(0, x); X < Math.min(W, x + w); X++) k += on[Y * W + X]; return k < 0.2 * w * h; }).length;
    fs.appendFileSync(out, JSON.stringify({ seed, ms, bubbles, model: inst.length, false: falseN }) + "\n");
  }
} else if (what === "summary") {
  for (const f of argv) {
    const rows = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)), ms = rows.map((r) => r.ms).sort((a, b) => a - b)[rows.length >> 1];
    const by = new Map(), add = (k, v) => { const o = by.get(k) || by.set(k, {}).get(k); for (const [a, b] of Object.entries(v)) o[a] = (o[a] || 0) + b; };
    for (const r of rows) {
      for (const b of r.blocks || []) for (const k of ["all", b.kind]) add(k, { n: 1, today: +b.today, comic: +b.comic, both: +b.both, onlyComic: +(b.comic && !b.today), onlyToday: +(b.today && !b.comic) });
      for (const b of r.bubbles || []) add(`${b.kind}${b.cut ? " cut" : ""}`, { n: 1, found: +b.found });
      if (r.bubbles) add("model", { n: r.model, false: r.false });
    }
    console.log(`${f}: ${rows.length} pages, model ms median ${ms}`);
    const pc = (a, n) => `${a}/${n} (${((100 * a) / Math.max(1, n)).toFixed(1)}%)`;
    for (const [k, o] of by) console.log(`  ${k.padEnd(12)} ` + (o.found != null ? `found ${pc(o.found, o.n)}` : o.false != null ? `bubbles ${o.n}, false ${o.false}` : `today ${pc(o.today, o.n)}  comic ${pc(o.comic, o.n)}  both ${pc(o.both, o.n)}  only comic ${o.onlyComic}  only today ${o.onlyToday}`));
  }
} else {
  console.error("usage: see the head of bench/detectors.mjs"); process.exit(2);
}
