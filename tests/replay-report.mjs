// Replays a user's "Export debug report" zip through the engine, offline:
// for every page, re-analyses the original image, lays out the model's items
// from the report, draws the result with debug boxes, and prints what changed
// against the report (regions, placements). Lets a reported page become a
// local reproduction (and, if useful, a fixture under fixtures/real/).
//   node replay-report.mjs <report.zip> [outdir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createCanvas, loadImage, registerFont } from "canvas";
import { cv, detector } from "./cv-node.mjs";
import { analyze } from "../extension/engine/analyze.js";
import { layout } from "../extension/engine/layout.js";
import { erase } from "../extension/engine/erase.js";

const [,, zipPath, outArg] = process.argv;
if (!zipPath) { console.error("usage: node replay-report.mjs <report.zip> [outdir]"); process.exit(2); }
const out = outArg || path.join(path.dirname(zipPath), path.basename(zipPath, ".zip"));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-report-"));
execFileSync("unzip", ["-oq", zipPath, "-d", tmp]);
registerFont("../extension/fonts/ComicNeue-Bold.ttf", { family: "Gytakusub Comic", weight: "bold" });
new Function(fs.readFileSync("../extension/vendor/hyphen-en.js", "utf8"))();
new Function(fs.readFileSync("../extension/text.js", "utf8"))();
const GyText = globalThis.GyText;

const summary = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8"));
console.log(`report from Gytakusub ${summary.gytakusub}, ${summary.when}, ${summary.page}: ${summary.pages.length} page(s)`);
// Chrome and node-canvas scale images slightly differently, so compare with a tolerance.
const boxDelta = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
const compare = (now, then, key) => {
  if (now.length !== then.length) return `DIFFERENT (${now.length} vs ${then.length})`;
  let d = 0; for (let i = 0; i < now.length; i++) d = Math.max(d, boxDelta(key(now[i]), key(then[i])));
  return d <= 3 ? `same (max Δ ${d.toFixed(1)}px)` : `DIFFERENT (max Δ ${d.toFixed(1)}px)`;
};


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

for (const pg of summary.pages) {
  const rep = JSON.parse(fs.readFileSync(path.join(tmp, `page-${pg.id}.json`), "utf8"));
  const orig = fs.readdirSync(tmp).find((f) => f.startsWith(`page-${pg.id}.original.`));
  if (!orig) { console.log(`page ${pg.id}: no original image in the report (${rep.originalError || "unknown reason"}); skipping`); continue; }
  const img = await loadImage(path.join(tmp, orig));
  const { W, H } = rep.work;
  const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
  const pixels = ctx.getImageData(0, 0, W, H);
  const t0 = Date.now();
  const an = analyze(cv, pixels, { detector });
  // regions: same numbering as the report (single slice; strips were numbered page-wide the same way)
  const regionsNow = an.regions.map((r) => ({ id: r.id, kind: r.kind, letter: r.letter, box: r.box }));
  const regionsThen = rep.regions.map((r) => ({ id: r.id, kind: r.kind, letter: r.letter, box: r.box }));
  const items = rep.items.map((it) => ({ tag: rematch(an, rep, it), box: it.box, text: it.text, size: it.size, kind: it.kind }));
  const { placements, regionIds } = layout(an, items);
  const clean = erase(cv, pixels, an, regionIds).image;
  const o = createCanvas(W, H), octx = o.getContext("2d"); octx.putImageData(clean, 0, 0);
  octx.lineWidth = 2; octx.font = `bold ${Math.round(W / 70)}px sans-serif`;
  for (const r of an.regions) { octx.strokeStyle = r.kind === "bubble" ? "rgba(220,38,38,.9)" : "rgba(37,99,235,.9)"; octx.strokeRect(r.box.x, r.box.y, r.box.w, r.box.h); octx.fillStyle = octx.strokeStyle; octx.fillText("#" + r.id, r.box.x + 2, r.box.y - 3); }
  for (const p of placements) { octx.strokeStyle = "rgba(22,163,74,.9)"; octx.strokeRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h); }
  GyText.draw(octx, placements, { fontFamily: rep.settings?.fontFamily, uppercase: rep.settings?.uppercase });
  fs.writeFileSync(path.join(out, `page-${pg.id}.replay.png`), o.toBuffer("image/png"));
  fs.copyFileSync(path.join(tmp, orig), path.join(out, orig));
  const ms = Date.now() - t0;
  console.log(`page ${pg.id}: ${W}x${H} ${ms}ms — regions ${compare(regionsNow, regionsThen, (r) => r.box)}; placements ${compare(placements, rep.placements, (p) => p.rect)}`);
  for (const it of items) {
    const p = placements.find((q) => q.text === it.text);
    const untagged = it.tag == null, region = it.tag != null ? regionsNow.find((r) => r.id === it.tag) : null;
    console.log(`   ${untagged ? "   —" : "#" + String(it.tag).padStart(2)} ${region ? region.kind.padEnd(6) : "(box) "} ${p ? JSON.stringify({ x: Math.round(p.rect.x), y: Math.round(p.rect.y), w: Math.round(p.rect.w), h: Math.round(p.rect.h) }) : "NOT PLACED"} ${JSON.stringify(it.text).slice(0, 60)}`);
  }
  an.dispose();
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`renders in ${out}/`);
