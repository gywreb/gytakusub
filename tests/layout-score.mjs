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
import { createCanvas, loadImage } from "canvas";
import { cv, detector } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const zips = args.filter((a) => a.endsWith(".zip"));
if (!zips.length) { console.error("usage: node layout-score.mjs <report.zip> [...] [--verbose]"); process.exit(2); }

const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const tot = { pages: 0, placements: 0, bubble: 0, anchored: 0, roomy: 0, fill: 0, covers: 0, loose: 0, tiny: 0, centreOut: 0, multi: 0, multiDistinct: 0, ms: 0 };
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
console.log(`  analysis ${tot.pages ? Math.round(tot.ms / tot.pages) : 0} ms/page`);
