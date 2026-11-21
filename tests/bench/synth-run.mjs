// The engine on generated pages (bench/synth.mjs), scored against their exact answers.
//   node bench/synth-run.mjs <out.jsonl> <first seed> <count> [--dump dir]
// Seeds 0–9999 may be looked at when something fails; seeds from 100000 on are only ever counted.
// Per line to translate:
//   found     its centre lies in a region the engine found before any second look
//   left      over a quarter of its glyph pixels still differ from the page without it, after erasing
//   restore   mean difference from the page without it, over its whole footprint (glyphs and halo)
//   letter    the engine's letter size against the true one (far: under 0.6× or over 1.6×)
//   small     the translation drawn under 0.7 of the true size (as the 0.7 rule of the 2.14 goal)
//   overflow  over 3% of a bubble line's translation drawn outside its bubble
// Per page: damage (pixels changed away from every line to translate), outline (bubble outline
// pixels erased), kept (sound effects and lines left as drawn, changed).
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "canvas";
process.chdir(path.dirname(new URL(import.meta.url).pathname) + "/..");
const { cv, detector, analyzePage } = await import("../cv-node.mjs");
const { lookAgain } = await import("../../extension/engine/page.js");
const { layout, tells } = await import("../../extension/engine/layout.js");
const { erase, fillTexture } = await import("../../extension/engine/erase.js");
const { loadLettering } = await import("../lettering-setup.mjs");
const GyText = loadLettering();
const { makePage, englishFor, rng } = await import("./synth.mjs");

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const dump = opt("--dump");
const most = Number(opt("--max") || 0); let ran = 0; // (--max N: stop after N pages; rerun to go on)
const [outFile, first, count] = argv;
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).seed) : []);
if (dump) fs.mkdirSync(dump, { recursive: true });
const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const lum = (d, q) => (d[q * 4] + d[q * 4 + 1] + d[q * 4 + 2]) / 3;

for (let seed = +first; seed < +first + +count; seed++) {
  if (done.has(seed)) continue;
  const pg = makePage(seed), { W, H } = pg, r = rng(seed + 99);
  const pixels = new ImageData(new Uint8ClampedArray(pg.input.data), W, H);
  const t0 = Date.now();
  const an = await analyzePage(pixels);
  const regionAt = (b) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; let best = null; for (const q of an.regions) if (inBox(q.box, cx, cy) && (!best || q.box.w * q.box.h < best.box.w * best.box.h)) best = q; return best; };
  const found = pg.blocks.map((b) => !!regionAt(b.box));
  const sizes0 = pg.blocks.map((b) => b.letter).sort((a, b) => a - b), median = sizes0[sizes0.length >> 1] || 1;
  const items = pg.blocks.map((b, i) => {
    const big = r() < 0.1 ? 0.4 : 0.15, j = (v) => (r() * 2 - 1) * big * v;
    const bx = { x: b.box.x + j(b.box.w), y: b.box.y + j(b.box.h), w: b.box.w * (1 + j(1)), h: b.box.h * (1 + j(1)) };
    const reg = regionAt(b.box);
    return { tag: reg ? reg.id : null, box: [bx.x / W, bx.y / H, bx.w / W, bx.h / H].map((v) => Math.max(0, Math.min(1, v))), text: englishFor(b, r), size: b.letter > 1.6 * median ? "large" : b.letter < 0.65 * median ? "small" : "normal", kind: b.kind === "free" ? "sign" : b.kind, index: i };
  });
  await lookAgain(cv, pixels, an, items, detector);
  const { placements, regionIds } = layout(an, items);
  const res = erase(cv, pixels, an, regionIds, { keepMask: true, outline: 0.3 });
  const clean = await fillTexture(cv, null, res.image, res);
  res.mask.delete(); res.surface.delete();
  const ms = Date.now() - t0;
  const o = clean.data, tr = pg.truth.data, inp = pg.input.data;
  // per block: left, restore
  // left: over a quarter of the glyphs' pixels still far from the page under them (the lettering
  // left, or a fill that came out far from the art: a high-contrast pattern filled by Telea);
  // stays: over a quarter of the pixels where the lettering stood out from the art still as the
  // lettering drew them, untouched by the eraser (the lettering itself left)
  const rows = pg.blocks.map((b, i) => {
    let off = 0, lit = 0, same = 0;
    for (const q of b.core) {
      if (Math.abs(lum(o, q) - lum(tr, q)) > 60) off++;
      if (Math.abs(lum(inp, q) - lum(tr, q)) > 60) { lit++; if (Math.abs(lum(o, q) - lum(inp, q)) < 30) same++; }
    }
    let sum = 0; for (const q of b.foot) sum += Math.abs(lum(o, q) - lum(tr, q));
    return { left: b.core.length ? off / b.core.length > 0.25 : false, stays: lit ? same / lit > 0.25 : false, restore: b.foot.length ? sum / b.foot.length : 0 };
  });
  // damage away from every block (footprint grown by 3 px), outline erased, kept changed
  const near = new Uint8Array(W * H);
  for (const b of pg.blocks) for (const q of b.foot) { const x = q % W, y = (q / W) | 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) near[yy * W + xx] = 1; } }
  let damage = 0; for (let q = 0; q < W * H; q++) if (!near[q] && Math.abs(lum(o, q) - lum(inp, q)) > 40) damage++;
  let outline = 0; for (const bb of pg.bubbles) for (let q = 0; q < W * H; q++) if (bb.outline[q] && !near[q] && lum(tr, q) < 100 && lum(o, q) > lum(tr, q) + 80) outline++;
  // letter sizes, drawn sizes, overflow
  const tc = createCanvas(W, H), tctx = tc.getContext("2d"); tctx.putImageData(clean, 0, 0);
  const sizes = []; GyText.draw(tctx, placements, { sizes });
  const per = pg.blocks.map(() => ({}));
  for (const [k, p] of placements.entries()) {
    if (p.item == null) continue;
    const b = pg.blocks[p.item], e = per[p.item];
    e.letter = p.letter / b.letter; e.drawn = sizes[k] / 1.45 / b.letter;
    if (b.bubble) { // the translation alone: its ink outside the bubble's inside (and the erased lettering)
      const c = createCanvas(W, H), x = c.getContext("2d"); GyText.draw(x, [p]);
      const d = x.getImageData(0, 0, W, H).data, inside = pg.bubbles[b.bubble - 1].inside;
      const footSet = new Set(b.foot);
      let all = 0, outside = 0;
      const R = p.rect, x0 = Math.max(0, Math.floor(R.x - 40)), y0 = Math.max(0, Math.floor(R.y - 40)), x1 = Math.min(W, Math.ceil(R.x + R.w + 40)), y1 = Math.min(H, Math.ceil(R.y + R.h + 40));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const q = yy * W + xx; if (d[q * 4 + 3] > 100) { all++; if (!inside[q] && !footSet.has(q)) outside++; } }
      e.overflow = all ? outside / all : 0;
    }
  }
  const told = pg.blocks.map((b, i) => tells(items[i]));
  const n = told.filter(Boolean).length;
  const row = {
    seed, script: pg.script, colour: pg.colour, ms, lines: n,
    found: found.filter((f, i) => f && told[i]).length,
    placed: pg.blocks.filter((b, i) => told[i] && per[i].letter != null).length,
    left: rows.filter((x, i) => told[i] && x.left).length, stays: rows.filter((x, i) => told[i] && x.stays).length,
    restore: +(rows.reduce((s, x, i) => s + (told[i] ? x.restore : 0), 0) / Math.max(1, n)).toFixed(2),
    letterFar: per.filter((e, i) => told[i] && e.letter != null && (e.letter < 0.6 || e.letter > 1.6)).length,
    small: per.filter((e, i) => told[i] && e.drawn != null && e.drawn < 0.7).length,
    overflow: per.filter((e) => e.overflow > 0.03).length, bubbleLines: pg.blocks.filter((b, i) => told[i] && b.bubble).length,
    damage: +(1000 * damage / (W * H)).toFixed(2), outline,
  };
  if (dump && seed < 100000) {
    fs.writeFileSync(path.join(dump, `s${seed}.json`), JSON.stringify({ row, blocks: pg.blocks.map((b, i) => ({ kind: b.kind, script: b.script, vertical: b.vertical, letter: +b.letter.toFixed(1), box: b.box, bubble: b.bubble, shape: b.shape, two: b.two, found: found[i], ...rows[i], ...per[i], text: items[i].text })), regions: an.regions.map((q) => ({ id: q.id, kind: q.kind, box: q.box, letter: q.letter })) }));
    const s = createCanvas(W * 2 + 10, H), sx = s.getContext("2d"); sx.fillStyle = "#888"; sx.fillRect(0, 0, s.width, H);
    const ic = createCanvas(W, H); ic.getContext("2d").putImageData(pg.input, 0, 0); sx.drawImage(ic, 0, 0); sx.drawImage(tc, W + 10, 0);
    fs.writeFileSync(path.join(dump, `s${seed}.png`), s.toBuffer("image/png"));
  }
  fs.appendFileSync(outFile, JSON.stringify(row) + "\n"); // (after the dump: a page counted has its dump)
  an.dispose();
  if (most && ++ran >= most) process.exit(0);
}
