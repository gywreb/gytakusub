// Scores the layout (where translations land) over the pages in exported debug
// reports, offline: each page is re-analysed, the report's items are laid out
// again, and the placements are measured against the lettering the detector
// found. Compare the numbers before and after a layout or analysis change.
//   node layout-score.mjs <report.zip> [more.zip ...] [--verbose]
//
// Per bubble placement:
//   anchored   the rect overlaps the lettering it replaces (its own text block)
//   roomy      the rect is at least as large as that lettering's box
//   fill       rect area / bubble interior area (how much of the bubble the text may use)
//   covers     the rect overlaps lettering that was NOT erased (another region's text)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage, registerFont } from "canvas";
import { cv, detector } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const zips = args.filter((a) => a.endsWith(".zip"));
if (!zips.length) { console.error("usage: node layout-score.mjs <report.zip> [...] [--verbose]"); process.exit(2); }

// the page-side text fitter, to measure what size the text really ends up at
registerFont("../extension/fonts/ComicNeue-Bold.ttf", { family: "Gytakusub Comic", weight: "bold" });
new Function(fs.readFileSync("../extension/vendor/hyphen-en.js", "utf8"))();
new Function(fs.readFileSync("../extension/text.js", "utf8"))();
const GyText = globalThis.GyText;
const fitCanvas = createCanvas(10, 10), fitCtx = fitCanvas.getContext("2d");
const SIZE_MUL = { small: 0.8, normal: 1, large: 1.3 };
/** Rendered font size relative to the original letter height (1 = same size as the original lettering), plus how the fit ended. */
function rendered(p) {
  const target = p.letter * 1.45 * (SIZE_MUL[p.size] || 1), inBubble = p.tag != null && !p.halo;
  const setFont = (size) => { fitCtx.font = `bold ${size}px "Gytakusub Comic"`; }, measure = (t) => fitCtx.measureText(t).width;
  const fit = GyText.fitText(p.text, p.rect, setFont, measure, { maxSize: inBubble ? target * 1.3 : target, minSize: Math.max(7, target * 0.35) });
  return { ratio: fit.size / (p.letter * 1.45), forced: !!fit.forced, overflow: !!fit.overflow, hyphens: fit.hyphens || 0 };
}

const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const tot = { pages: 0, placements: 0, bubble: 0, anchored: 0, roomy: 0, fill: 0, covers: 0, loose: 0, tiny: 0, centreOut: 0, multi: 0, multiDistinct: 0, ms: 0, ratios: [], small: 0, forced: 0, overflow: 0, hyphens: 0 };
const seen = new Set();


/**
 * The report's tags number the regions the user's build found. If detection has
 * changed since, a tagged item is re-matched to the smallest region now holding
 * the centre of the stamped region it named; an untagged item stays untagged
 * (the layout places it by its box, as the extension does).
 */
function rematch(an, rep, it) {
  if (it.tag == null) return null;
  const then = rep.regions.find((r) => r.id === it.tag);
  if (!then) return null;
  const cx = then.box.x + then.box.w / 2, cy = then.box.y + then.box.h / 2;
  let best = null;
  for (const r of an.regions) if (cx >= r.box.x && cy >= r.box.y && cx <= r.box.x + r.box.w && cy <= r.box.y + r.box.h && (!best || r.box.w * r.box.h < best.box.w * best.box.h)) best = r;
  return best ? best.id : null;
}

for (const zipPath of zips) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-score-"));
  execFileSync("unzip", ["-oq", zipPath, "-d", tmp]);
  const summary = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8"));
  for (const pg of summary.pages) {
    const rep = JSON.parse(fs.readFileSync(path.join(tmp, `page-${pg.id}.json`), "utf8"));
    const orig = fs.readdirSync(tmp).find((f) => f.startsWith(`page-${pg.id}.original.`));
    if (!orig || !rep.items.length) continue;
    const key = rep.image + "|" + rep.items.map((i) => i.text).join("|");
    if (seen.has(key)) continue; // the same page exported twice
    seen.add(key);
    const img = await loadImage(path.join(tmp, orig));
    const { W, H } = rep.work;
    const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
    const t0 = Date.now();
    const an = analyze(cv, ctx.getImageData(0, 0, W, H), { detector });
    tot.ms += Date.now() - t0;
    // re-match the report's tags to the regions found now (as replay-report.mjs does)
    const items = rep.items.map((it, index) => ({ tag: rematch(an, rep, it), box: it.box, text: it.text, size: it.size, kind: it.kind, index }));
    const { placements, regionIds } = layout(an, items);
    const erased = new Set(); for (const id of regionIds) { const r = an.regions.find((q) => q.id === id); const bl = r.kind === "bubble" ? r.ref.blocks : [r.ref]; for (const b of bl) erased.add(b); }
    const unerased = an.blocks.filter((b) => !erased.has(b));
    tot.pages++;
    const byRegion = new Map();
    for (const p of placements) {
      tot.placements++;
      const r0 = rendered(p);
      tot.ratios.push(r0.ratio); if (r0.ratio < 0.7) tot.small++; if (r0.forced) tot.forced++; if (r0.overflow) tot.overflow++; tot.hyphens += r0.hyphens;
      if (verbose && (r0.ratio < 0.7 || r0.forced)) console.log(`  ${path.basename(zipPath)} page ${pg.id} ${r0.forced ? "FORCED-BREAK" : "SMALL " + r0.ratio.toFixed(2)} rect=${JSON.stringify({ x: Math.round(p.rect.x), y: Math.round(p.rect.y), w: Math.round(p.rect.w), h: Math.round(p.rect.h) })} letter=${p.letter.toFixed(1)} "${p.text.slice(0, 40)}"`);
      if (p.covers = unerased.some((b) => inter(p.rect, b.gbox) > 0.2 * b.gbox.w * b.gbox.h)) tot.covers++;
      if (p.tag == null || p.halo) { tot.loose++; continue; }
      const r = an.regions.find((q) => q.id === p.tag);
      if (r.kind !== "bubble") continue;
      tot.bubble++;
      (byRegion.get(r.id) || byRegion.set(r.id, []).get(r.id)).push(p);
      const inside = an.insideOf(r.id);
      if (!inside(p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2)) tot.centreOut++;
      if (Math.min(p.rect.w, p.rect.h) < 3 * r.letter) tot.tiny++;
      tot.fill += (p.rect.w * p.rect.h) / Math.max(1, r.ref.area);
      const own = r.ref.blocks.filter((b) => inter(p.rect, b.gbox) > 0.5 * b.gbox.w * b.gbox.h);
      if (own.length) tot.anchored++;
      if (own.length && own.some((b) => p.rect.w * p.rect.h >= b.gbox.w * b.gbox.h)) tot.roomy++;
      p.own = own;
      if (verbose && (!own.length || p.covers)) console.log(`  ${path.basename(zipPath)} page ${pg.id} #${r.id} ${!own.length ? "UNANCHORED" : ""} ${p.covers ? "COVERS-UNERASED" : ""} rect=${JSON.stringify(p.rect)} "${p.text.slice(0, 40)}"`);
    }
    for (const [, ps] of byRegion) if (ps.length > 1) { tot.multi += ps.length; const d = new Set(); for (const p of ps) for (const b of p.own) d.add(b); tot.multiDistinct += Math.min(ps.length, d.size); }
    an.dispose();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "n/a");
console.log(`pages ${tot.pages}, placements ${tot.placements} (loose/halo ${tot.loose}), in bubbles ${tot.bubble}`);
console.log(`  anchored to own lettering: ${pct(tot.anchored, tot.bubble)}   roomy (≥ lettering box): ${pct(tot.roomy, tot.bubble)}   mean fill of bubble: ${pct(tot.fill, tot.bubble)}`);
console.log(`  rect centre outside shape: ${tot.centreOut}   narrow (< 3 letters): ${tot.tiny}   covers un-erased lettering: ${tot.covers}`);
console.log(`  shared bubbles: ${tot.multi} placements, each over its own line: ${pct(tot.multiDistinct, tot.multi)}`);
const sorted = tot.ratios.slice().sort((a, b) => a - b), q = (f) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))].toFixed(2) : "n/a");
console.log(`  rendered size / original letter: median ${q(0.5)}, 10th percentile ${q(0.1)}, below 0.7: ${tot.small} (${pct(tot.small, tot.placements)})`);
console.log(`  fits: letter-broken ${tot.forced}, whole-word overflow ${tot.overflow}, hyphenated lines ${tot.hyphens}`);
console.log(`  analysis ${tot.pages ? Math.round(tot.ms / tot.pages) : 0} ms/page`);
