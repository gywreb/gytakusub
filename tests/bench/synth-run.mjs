// The engine on generated pages (bench/synth.mjs), scored against their exact answers.
//   node bench/synth-run.mjs <out.jsonl> <first seed> <count> [--dump dir] [--printed] [--fill aot]
// --printed: pages with lettering printed on objects and slanted free text too (synth.mjs opts.printed)
// --reader strong|weak: Claude's answer as a reader that errs gives it (bench/reader.mjs), through the
// answer contract (engine/contract.js) as a real answer goes; without it, every line, boxes moved a little
// --readers, --webtoon: the bubble shapes the owner's chapters showed, and what a webtoon episode
// showed: dark bubbles with coloured lettering, a bubble cut by the image's edge (synth.mjs opts)
// --cut-lettering: bubbles the image's edge cuts at their lettering (synth.mjs opts.cutLettering)
// Seeds 0–9999 may be looked at when something fails; seeds from 100000 on are only ever counted.
// Per line to translate:
//   found     its centre lies in a region the engine found before any second look
//   left      over a quarter of its glyph pixels still differ from the page without it, after erasing
//   restore   mean difference from the page without it, over its whole footprint (glyphs and halo)
//   letter    the engine's letter size against the true one (far: under 0.6× or over 1.6×)
//   small     the translation drawn under 0.7 of the true size (as the 0.7 rule of the 2.14 goal)
//   overflow  over 3% of a bubble line's translation drawn outside its bubble
//   touch     a bubble line's letters within a tenth of a letter (2 px at least) of its bubble's edge
//   big       the translation drawn over 1/0.7 (1.43) of the original lettering's size
//   delivered its lettering not left as drawn, and a translation of it inside its own bubble (the
//             centre of its text's box on the bubble's inside), or for free text, over its own lettering
// Where the size is lost (the same text and fitter each time):
//   smallLetter  small again with the true letter size in the engine's room: what the analysis's
//                size estimate costs is small − smallLetter
//   smallGeometry, smallAvoidable: a small line alone in its bubble that could not be set at 0.7
//                of its size in that bubble at all, however laid out (the translation is too long
//                for it), or could; smallShared: in a bubble with other lines; smallFree: in none
//   smallAvoidableClear: avoidable even keeping its letters clear of the outline (not touching it)
//   smallWidth, smallHeight, smallBoth, smallNeither: what holds each small line's text small
//                (bench/limits.mjs): a narrow room, a low one, either, or not the room
// Per page: damage (pixels changed away from every line to translate), outline (bubble outline
// pixels erased), kept (sound effects and lines left as drawn, changed).
import "./tune-env.mjs"; // first: GYT_TUNE must be set before the engine loads
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "canvas";
process.chdir(path.dirname(new URL(import.meta.url).pathname) + "/..");
const { cv, detector, analyzePage, textMasksFor } = await import("../cv-node.mjs");
const { lookAgain } = await import("../../extension/engine/page.js");
const { layout, tells, roomShape } = await import("../../extension/engine/layout.js");
const { erase, fillTexture } = await import("../../extension/engine/erase.js");
const { loadLettering } = await import("../lettering-setup.mjs");
const GyText = loadLettering();
const { makePage, englishFor, rng } = await import("./synth.mjs");
const { readAnswer, READERS } = await import("./reader.mjs");
const contract = await import("../../extension/engine/contract.js"); // (an engine before 3.3 has no checkAnswer)
const { sizeLabel } = await import("./labels.mjs");
const { sizeLimits, limitCounts, fitsInside, erodeGrid } = await import("./limits.mjs");

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const whyFile = opt("--why"); // (--why file: each avoidable line refitted with one cause removed at a time, as JSON lines)
const dump = opt("--dump"), printedPages = argv.includes("--printed"), readerPages = argv.includes("--readers"), webtoonPages = argv.includes("--webtoon"), cutPages = argv.includes("--cut-lettering");
if (printedPages) argv.splice(argv.indexOf("--printed"), 1);
if (readerPages) argv.splice(argv.indexOf("--readers"), 1);
if (webtoonPages) argv.splice(argv.indexOf("--webtoon"), 1);
if (cutPages) argv.splice(argv.indexOf("--cut-lettering"), 1);
// the eraser takes the learned text mask in place of its rules where they are weak (engine/textmask.js),
// as the product does from 3.4; --rules: the rules alone (the setting off). (--textmask, the flag
// before 3.4, is still taken: on.)
const learnedMask = !argv.includes("--rules");
for (const f of ["--rules", "--textmask"]) if (argv.includes(f)) argv.splice(argv.indexOf(f), 1);
const most = Number(opt("--max") || 0); let ran = 0; // (--max N: stop after N pages; rerun to go on)
const readerName = opt("--reader"), reader = readerName ? READERS[readerName] : null;
if (readerName && !reader) throw new Error(`--reader ${readerName}: ${Object.keys(READERS).join(" or ")}`);
const fillWith = opt("--fill");
// --fill aot: textured areas filled by the learned model the extension runs on the CPU (AOT), as a
// user without a graphics card gets; by default Telea, which is faster and much worse over art
const inpainter = fillWith === "aot" ? await (async () => {
  const { getOrt, createSession, run } = await import("../../extension/engine/ort.js");
  const { session } = await createSession(new Uint8Array(fs.readFileSync(new URL("../../extension/vendor/inpaint.onnx", import.meta.url))), { gpu: false });
  return { ort: getOrt(), session, run };
})() : null;
if (fillWith && fillWith !== "aot") throw new Error(`--fill ${fillWith}: only "aot" (or nothing, for Telea)`);
const [outFile, first, count] = argv;
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).seed) : []);
if (dump) fs.mkdirSync(dump, { recursive: true });
const inBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const lum = (d, q) => (d[q * 4] + d[q * 4 + 1] + d[q * 4 + 2]) / 3;

for (let seed = +first; seed < +first + +count; seed++) {
  if (done.has(seed)) continue;
  const pg = makePage(seed, { printed: printedPages, readers: readerPages, webtoon: webtoonPages, cutLettering: cutPages }), { W, H } = pg, r = rng(seed + 99);
  const labelRnd = rng(seed * 7919 + 17); // Claude's size labels: a stream of their own (bench/labels.mjs)
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
    return { tag: reg ? reg.id : null, box: [bx.x / W, bx.y / H, bx.w / W, bx.h / H].map((v) => Math.max(0, Math.min(1, v))), text: englishFor(b, r), source: b.text, size: sizeLabel(b.letter / median, labelRnd), kind: b.kind === "free" ? "sign" : b.kind, index: i };
  });
  // the answer: the exact one, or a reader's through the contract; carry[k]: the page's lines answer item k carries
  let answer = items, carry = items.map((it, i) => [i]), answerFacts = null, readerErrs = null, readerCut = null;
  if (reader) {
    const ids = an.regions.map((q) => q.id), slice = { x: 0, y: 0, w: W, h: H, cw: W, ch: H, tagFrom: ids.length ? Math.min(...ids) : 1, tagTo: ids.length ? Math.max(...ids) : 0 };
    const raw = readAnswer(items, an.regions, reader, seed * 104729 + 11, W, H);
    readerErrs = raw.errs; readerCut = raw.cut;
    if (raw.cut != null) {
      // cut off: its text ends partway; before 3.3 such an answer was unreadable and the page failed
      const text = JSON.stringify({ items: raw.items, terms: [] }), part = text.slice(0, Math.floor(raw.cut * text.length));
      let kept = [];
      try { kept = contract.parseAnswer ? contract.parseAnswer(part).items : []; } catch { kept = []; }
      raw.items = kept; raw.carry = raw.carry.slice(0, kept.length);
    }
    answer = []; carry = [];
    let problems = [];
    if (contract.checkAnswer) {
      const c = contract.checkAnswer(raw.items, slice, W, H, { regions: an.regions, lines: an.lines || [] });
      answer = c.items.map((it, k) => ({ ...it, index: k })); carry = c.from.map((k) => raw.carry[k]); problems = c.problems;
    } else raw.items.forEach((it, k) => { const n = contract.normalizeItems([it], slice, W, H); if (n.length) { answer.push({ ...n[0], index: answer.length }); carry.push(raw.carry[k]); } });
    answerFacts = { convention: raw.convention, cut: raw.cut, answered: raw.items.length, kept: answer.length, ...(problems.length ? { repaired: problems.map((p) => p.what + (p.way ? ` ${p.way}` : "")) } : {}) };
  }
  await lookAgain(cv, pixels, an, answer, detector);
  const { placements, regionIds } = layout(an, answer);
  // placements by the page's line (the first an answer item carries), its answer item kept
  for (const p of placements) { p.answer = p.item; if (p.item != null) p.item = carry[p.item][0] ?? null; }
  const tMask = Date.now(), textMasks = learnedMask ? await textMasksFor(pixels, an, regionIds) : null, maskMs = Date.now() - tMask;
  const res = erase(cv, pixels, an, regionIds, { keepMask: true, outline: 0.3, textMasks });
  const clean = await fillTexture(cv, inpainter, res.image, res);
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
    return { left: b.core.length ? off / b.core.length > 0.25 : false, stays: lit ? same / lit > 0.25 : false, restore: b.foot.length ? sum / b.foot.length : 0, lit, same };
  });
  // damage away from every block (footprint grown by 3 px), outline erased, kept changed
  const near = new Uint8Array(W * H);
  for (const b of pg.blocks) for (const q of b.foot) { const x = q % W, y = (q / W) | 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) near[yy * W + xx] = 1; } }
  let damage = 0; for (let q = 0; q < W * H; q++) if (!near[q] && Math.abs(lum(o, q) - lum(inp, q)) > 40) damage++;
  let outline = 0; for (const bb of pg.bubbles) for (let q = 0; q < W * H; q++) if (bb.outline[q] && !near[q] && lum(tr, q) < 100 && lum(o, q) > lum(tr, q) + 80) outline++;
  // letter sizes, drawn sizes, overflow
  const tc = createCanvas(W, H), tctx = tc.getContext("2d"); tctx.putImageData(clean, 0, 0);
  const sizes = [], fits = []; GyText.draw(tctx, placements, { sizes, fits });
  const per = pg.blocks.map(() => ({}));
  // the same lines fitted again (one font for the page, as drawn): with the true letter size in
  // the engine's room, and for a line alone in its bubble, also in the room the layout's method
  // finds in the true bubble
  const scratch = createCanvas(W, H).getContext("2d"), pageTexts = placements.map((p) => p.text);
  const fitted = (ps) => { const out = []; GyText.draw(scratch, ps, { sizes: out, pageTexts }); return out; };
  const exactLetter = fitted(placements.map((p) => (p.item == null ? p : { ...p, letter: pg.blocks[p.item].letter })));
  const toldIn = new Map(); // truth bubble → how many of its lines are translated
  for (const [i, b] of pg.blocks.entries()) if (b.bubble && tells(items[i])) toldIn.set(b.bubble, (toldIn.get(b.bubble) || 0) + 1);
  const family = GyText.lettering(pageTexts).family;
  const boundCtx = createCanvas(8, 8).getContext("2d");
  /** a line alone in its bubble: could it be set at 0.7 of its size there at all (bench/limits.mjs)? */
  // (clear: its letters kept clear of the outline, as far as `touch` below asks: a line that fits at
  // 0.7 only by touching its outline isn't one the engine should have set larger, since 2.15 keeps
  // a margin; the bound with no margin at all is kept as `smallAvoidable`)
  const couldFit = (k, clear = false) => {
    const p = placements[k], b = pg.blocks[p.item];
    let m = pg.bubbles[b.bubble - 1].inside;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let q = 0; q < W * H; q++) if (m[q]) { const x = q % W, y = (q / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    let ox = 0, oy = 0, mw = W;
    if (clear) { // the interior less a band as wide as the touching distance
      const gw = x1 - x0 + 1, gh = y1 - y0 + 1, g = new Uint8Array(gw * gh);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) g[y * gw + x] = m[(y0 + y) * W + x0 + x];
      m = erodeGrid(g, gw, gh, Math.max(2, Math.round(0.1 * b.letter))); ox = x0; oy = y0; mw = gw;
    }
    const inside = (x, y) => { const X = (x | 0) - ox, Y = (y | 0) - oy; return X >= 0 && Y >= 0 && X < mw && (Y * mw + X) < m.length && m[Y * mw + X] === 1; };
    return fitsInside(GyText, boundCtx, family, p.text, inside, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, Math.ceil(0.7 * 1.45 * b.letter));
  };
  for (const [k, p] of placements.entries()) {
    if (p.item == null) continue;
    const b = pg.blocks[p.item], e = per[p.item];
    e.letter = p.letter / b.letter; e.drawn = sizes[k] / 1.45 / b.letter;
    e.drawnLetter = exactLetter[k] / 1.45 / b.letter;
    // why a small line is small: the translation can't fit its bubble at 0.7 even ideally
    // (geometry), or it could (avoidable); in a bubble with other lines, or in none, not known
    if (e.drawn < 0.7) e.why = !b.bubble ? "free" : toldIn.get(b.bubble) !== 1 ? "shared" : couldFit(k) ? "avoidable" : "geometry";
    if (e.why === "avoidable") e.clear = couldFit(k, true);
    if (b.bubble) { // the translation alone: its ink outside the bubble's inside (and the erased lettering)
      const c = createCanvas(W, H), x = c.getContext("2d"); GyText.draw(x, [p]);
      const d = x.getImageData(0, 0, W, H).data, inside = pg.bubbles[b.bubble - 1].inside;
      const footSet = new Set(b.foot);
      let all = 0, outside = 0;
      const R = p.rect, x0 = Math.max(0, Math.floor(R.x - 40)), y0 = Math.max(0, Math.floor(R.y - 40)), x1 = Math.min(W, Math.ceil(R.x + R.w + 40)), y1 = Math.min(H, Math.ceil(R.y + R.h + 40));
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const q = yy * W + xx; if (d[q * 4 + 3] > 100) { all++; if (!inside[q] && !footSet.has(q)) outside++; } }
      e.overflow = all ? outside / all : 0;
      // touching: any of its letters within a tenth of a letter (2 px at least) of the bubble's edge,
      // where a letterer always leaves a margin (2.15: lines set larger came to touch caption borders)
      const r = Math.max(2, Math.round(0.1 * b.letter));
      e.touch = false;
      for (let yy = y0; yy < y1 && !e.touch; yy++) for (let xx = x0; xx < x1 && !e.touch; xx++) {
        const q = yy * W + xx;
        if (d[q * 4 + 3] <= 100 || footSet.has(q)) continue;
        for (let dy = -r; dy <= r && !e.touch; dy++) for (let dx = -r; dx <= r; dx++) {
          const X = xx + dx, Y = yy + dy;
          if (dx * dx + dy * dy <= r * r && (X < 0 || Y < 0 || X >= W || Y >= H || !inside[Y * W + X]) && !footSet.has(Y * W + X)) { e.touch = true; break; }
        }
      }
    }
  }
  if (whyFile) {
    // each avoidable line fitted again with one cause taken away: the true letter size; no margin;
    // the true interior as the room (same method, same margin); the true interior around its own
    // centre line; the true interior with no margin
    for (const [k, p] of placements.entries()) {
      if (p.item == null || per[p.item].why !== "avoidable") continue;
      const b = pg.blocks[p.item], m = pg.bubbles[b.bubble - 1].inside, ins = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[(y | 0) * W + (x | 0)] === 1;
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (let q = 0; q < W * H; q++) if (m[q]) { const x = q % W, y = (q / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const bb = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, edge = p.shape?.edge ?? 0;
      const mid = { ...p.rect, x: x0 + (x1 - x0) / 2 - p.rect.w / 2 };
      const v = {
        letter: { ...p, letter: b.letter },
        margin: p.shape ? { ...p, shape: { ...p.shape, half: p.shape.half.map((h) => (h ? h + edge : 0)), edge: 0 } } : p,
        trueRoom: { ...p, shape: roomShape(ins, bb, p.rect, [], [], edge) },
        trueAxis: { ...p, shape: roomShape(ins, bb, mid, [], [], edge) },
        trueNoMargin: { ...p, shape: roomShape(ins, bb, mid, [], [], 0) },
      };
      const names = Object.keys(v), got = fitted(names.map((n) => v[n]));
      const rec = { seed, item: p.item, shape: b.shape, script: b.script, est: +(p.letter / b.letter).toFixed(2), drawn: +per[p.item].drawn.toFixed(3), clear: !!per[p.item].clear, hadShape: !!p.shape, edge, fit: fits[k]?.fit, alt: !!fits[k]?.alt, text: p.text };
      names.forEach((n, j) => { rec[n] = +(got[j] / 1.45 / b.letter).toFixed(3); });
      fs.appendFileSync(whyFile, JSON.stringify(rec) + "\n");
    }
  }
  if (whyFile) for (const [k, p] of placements.entries()) {
    if (p.item == null || !per[p.item].touch) continue;
    const b = pg.blocks[p.item];
    fs.appendFileSync(whyFile, JSON.stringify({ seed, item: p.item, touch: true, shape: b.shape, letter: +(p.letter / b.letter).toFixed(2), drawn: +per[p.item].drawn.toFixed(3), hadShape: !!p.shape, ...fits[k], text: p.text }) + "\n");
  }
  const told = pg.blocks.map((b, i) => tells(items[i]));
  // delivered: not left as drawn, and an answer item carrying the line placed where the line is
  const placedRight = (p, b) => {
    const cx = Math.round(p.rect.x + p.rect.w / 2), cy = Math.round(p.rect.y + p.rect.h / 2);
    if (b.bubble) return cx >= 0 && cy >= 0 && cx < W && cy < H && pg.bubbles[b.bubble - 1].inside[cy * W + cx] === 1;
    const g = b.letter; return cx >= b.box.x - g && cx <= b.box.x + b.box.w + g && cy >= b.box.y - g && cy <= b.box.y + b.box.h + g;
  };
  const delivered = pg.blocks.map((b, i) => told[i] && !rows[i].stays && placements.some((p) => p.answer != null && carry[p.answer].includes(i) && placedRight(p, b)));
  const limits = sizeLimits(GyText, placements, sizes, [...placements.keys()].filter((k) => placements[k].item != null && told[placements[k].item] && per[placements[k].item].drawn < 0.7), W, H);
  const n = told.filter(Boolean).length;
  const row = {
    seed, script: pg.script, printed: printedPages, readers: readerPages, webtoon: webtoonPages, cutLettering: cutPages, textMask: learnedMask, colour: pg.colour, ms, maskMs, lines: n,
    found: found.filter((f, i) => f && told[i]).length,
    placed: pg.blocks.filter((b, i) => told[i] && per[i].letter != null).length,
    left: rows.filter((x, i) => told[i] && x.left).length, stays: rows.filter((x, i) => told[i] && x.stays).length,
    delivered: delivered.filter(Boolean).length, ...(readerName ? { reader: readerName, ...answerFacts } : {}),
    // by kind of lettering: in bubbles (and captions), free over the art, printed on objects, slanted free
    ...Object.fromEntries(["bubble", "free", "printed", "slanted"].flatMap((g) => {
      const of = (b) => (g === "printed" ? b.printed : g === "slanted" ? b.shape === "slanted" : g === "free" ? b.kind === "free" && b.shape !== "slanted" : !!b.bubble);
      const ids = pg.blocks.map((b, i) => (told[i] && of(b) ? i : -1)).filter((i) => i >= 0);
      return [[`${g}Lines`, ids.length], [`${g}Stays`, ids.filter((i) => rows[i].stays).length]];
    })),
    // in dark bubbles (--webtoon): what the learned text mask (3.2) is for, and the comic detector (3.3)
    darkLines: pg.blocks.filter((b, i) => told[i] && b.bubble && b.shape === "dark").length, darkStays: pg.blocks.filter((b, i) => told[i] && b.bubble && b.shape === "dark" && rows[i].stays).length,
    // in bubbles the image's edge cuts at their lettering (--cut-lettering), and of those the dark ones
    cutLines: pg.blocks.filter((b, i) => told[i] && b.shape === "cutLettering").length, cutStays: pg.blocks.filter((b, i) => told[i] && b.shape === "cutLettering" && rows[i].stays).length,
    cutLeft: pg.blocks.filter((b, i) => told[i] && b.shape === "cutLettering" && rows[i].left).length,
    // (and in pixels: of the glyphs' pixels that stood out from the art, those still as drawn; a line
    // whose row at the cut is left stays under a quarter of its pixels)
    cutLitPx: pg.blocks.reduce((s, b, i) => s + (told[i] && b.shape === "cutLettering" ? rows[i].lit : 0), 0), cutSamePx: pg.blocks.reduce((s, b, i) => s + (told[i] && b.shape === "cutLettering" ? rows[i].same : 0), 0),
    litPx: rows.reduce((s, x, i) => s + (told[i] ? x.lit : 0), 0), samePx: rows.reduce((s, x, i) => s + (told[i] ? x.same : 0), 0),
    cutDarkLines: pg.blocks.filter((b, i) => told[i] && b.shape === "cutLettering" && b.dark).length, cutDarkStays: pg.blocks.filter((b, i) => told[i] && b.shape === "cutLettering" && b.dark && rows[i].stays).length,
    restore: +(rows.reduce((s, x, i) => s + (told[i] ? x.restore : 0), 0) / Math.max(1, n)).toFixed(2),
    letterFar: per.filter((e, i) => told[i] && e.letter != null && (e.letter < 0.6 || e.letter > 1.6)).length,
    small: per.filter((e, i) => told[i] && e.drawn != null && e.drawn < 0.7).length,
    big: per.filter((e, i) => told[i] && e.drawn != null && e.drawn > 1 / 0.7).length,
    smallLetter: per.filter((e, i) => told[i] && e.drawnLetter != null && e.drawnLetter < 0.7).length,
    ...Object.fromEntries(["geometry", "avoidable", "shared", "free"].map((w) => [`small${w[0].toUpperCase()}${w.slice(1)}`, per.filter((e, i) => told[i] && e.why === w).length])),
    smallAvoidableClear: per.filter((e, i) => told[i] && e.why === "avoidable" && e.clear).length,
    ...limitCounts(limits),
    overflow: per.filter((e) => e.overflow > 0.03).length, touch: per.filter((e) => e.touch).length, bubbleLines: pg.blocks.filter((b, i) => told[i] && b.bubble).length,
    // by the shape of the bubble (or caption box) a line is in: [lines, past its bubble, set under 0.7, over 1/0.7]
    shapes: pg.blocks.reduce((o, b, i) => {
      if (!told[i] || !b.bubble || per[i].drawn == null) return o;
      const c = (o[b.shape] ||= [0, 0, 0, 0]);
      c[0]++; if (per[i].overflow > 0.03) c[1]++; if (per[i].drawn < 0.7) c[2]++; if (per[i].drawn > 1 / 0.7) c[3]++;
      return o;
    }, {}),
    damage: +(1000 * damage / (W * H)).toFixed(2), outline,
  };
  if (dump && seed < 100000) {
    fs.writeFileSync(path.join(dump, `s${seed}.json`), JSON.stringify({ row, blocks: pg.blocks.map((b, i) => ({ kind: b.kind, script: b.script, vertical: b.vertical, letter: +b.letter.toFixed(1), box: b.box, bubble: b.bubble, shape: b.shape, two: b.two, found: found[i], delivered: delivered[i], ...(readerErrs ? { errs: readerErrs[i], cut: readerCut } : {}), ...rows[i], ...per[i], text: items[i].text })), regions: an.regions.map((q) => ({ id: q.id, kind: q.kind, box: q.box, letter: q.letter })) }));
    const s = createCanvas(W * 2 + 10, H), sx = s.getContext("2d"); sx.fillStyle = "#888"; sx.fillRect(0, 0, s.width, H);
    const ic = createCanvas(W, H); ic.getContext("2d").putImageData(pg.input, 0, 0); sx.drawImage(ic, 0, 0); sx.drawImage(tc, W + 10, 0);
    fs.writeFileSync(path.join(dump, `s${seed}.png`), s.toBuffer("image/png"));
  }
  fs.appendFileSync(outFile, JSON.stringify(row) + "\n"); // (after the dump: a page counted has its dump)
  an.dispose();
  if (most && ++ran >= most) process.exit(0);
}
