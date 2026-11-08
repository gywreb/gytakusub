// Scores the detector on real pages from "Export debug report" zips, with no
// hand labelling: the model's items in each report say where text really is.
//   coverage — share of the model's items whose box centre (or stamped region)
//              lies inside a region the detector finds now
//   waste    — regions the detector finds that contain no item at all
//   split    — bubbles whose text the detector returned as several regions
// Every engine change must raise coverage without raising waste, across all
// reports (tune on some, validate on the rest).
//   node score-reports.mjs [--engine <dir>] <report.zip>...
// --engine points at another checkout's extension/engine (to score a baseline).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createCanvas, loadImage } from "canvas";
import { cv } from "./cv-node.mjs";

const args = process.argv.slice(2);
let engineDir = path.resolve("../extension/engine");
const ei = args.indexOf("--engine"); if (ei >= 0) { engineDir = path.resolve(args[ei + 1]); args.splice(ei, 2); }
const { analyze } = await import(pathToFileURL(path.join(engineDir, "analyze.js")).href);
const showMisses = args.includes("--misses"); if (showMisses) args.splice(args.indexOf("--misses"), 1);
// collect rejections so a miss can be explained by the rule that caused it
let rejections = [];
globalThis.GYT_TRACE = (kind, box, why, extra) => { rejections.push({ kind, box, why, extra }); };
const missReasons = new Map();
if (!args.length) { console.error("usage: node score-reports.mjs [--engine dir] <report.zip>..."); process.exit(2); }

const inside = (r, cx, cy) => cx >= r.box.x && cy >= r.box.y && cx <= r.box.x + r.box.w && cy <= r.box.y + r.box.h;
let T = { items: 0, covered: 0, asBubble: 0, dialogue: 0, regions: 0, waste: 0, pages: 0, ms: 0 };
console.log("report/page                 items covered asBubble regions waste  ms");
for (const zip of args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-score-"));
  execFileSync("unzip", ["-oq", zip, "-d", tmp]);
  const summary = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8"));
  const label = path.basename(zip).replace(/^.*?gytakusub-report-/, "").replace(/-\d{4}-.*$/, "");
  let S = { items: 0, covered: 0, asBubble: 0, dialogue: 0, regions: 0, waste: 0, pages: 0, ms: 0 };
  for (const pg of summary.pages) {
    const rep = JSON.parse(fs.readFileSync(path.join(tmp, `page-${pg.id}.json`), "utf8"));
    const orig = fs.readdirSync(tmp).find((f) => f.startsWith(`page-${pg.id}.original.`));
    if (!orig) continue;
    const img = await loadImage(path.join(tmp, orig));
    const { W, H } = rep.work;
    const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
    const t0 = Date.now();
    rejections = [];
    const an = analyze(cv, ctx.getImageData(0, 0, W, H));
    const ms = Date.now() - t0;
    // where the model saw text: the stamped region it named (as the report recorded
    // it) when it gave one, else the centre of its own box
    const spots = [];
    for (const it of rep.items) {
      if (!it.text) continue;
      const reg = it.tag != null ? rep.regions.find((r) => r.id === it.tag) : null;
      const dialogue = it.kind === "bubble"; // the model's own kind: speech/thought bubble vs narration/sign
      if (reg) spots.push({ x: reg.box.x + reg.box.w / 2, y: reg.box.y + reg.box.h / 2, text: it.text, dialogue });
      else if (it.box) spots.push({ x: (it.box[0] + it.box[2] / 2) * W, y: (it.box[1] + it.box[3] / 2) * H, text: it.text, dialogue });
    }
    const used = new Set();
    let covered = 0, asBubble = 0, dialogue = 0;
    for (const sp of spots) {
      if (sp.dialogue) dialogue++;
      const r = an.regions.find((r) => inside(r, sp.x, sp.y));
      if (r) { covered++; used.add(r.id); if (sp.dialogue && r.kind === "bubble") asBubble++; continue; }
      // explain the miss: the smallest rejected region (or block) around the spot
      const around = rejections.filter((j) => inside(j, sp.x, sp.y)).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
      const why = around.length ? `${around[0].kind}: ${around[0].why}` : "no candidate at all";
      missReasons.set(why, (missReasons.get(why) || 0) + 1);
      if (showMisses) console.log(`   MISS ${label}/${pg.id} ${JSON.stringify(sp.text).slice(0, 40)} ← ${why} ${around.length ? JSON.stringify(around[0].extra, (k, v) => (typeof v === "number" ? +v.toFixed(2) : v)).slice(0, 120) : ""}`);
    }
    const waste = an.regions.filter((r) => !used.has(r.id)).length;
    S.items += spots.length; S.covered += covered; S.asBubble += asBubble; S.dialogue += dialogue; S.regions += an.regions.length; S.waste += waste; S.pages++; S.ms += ms;
    console.log(`${(label + "/" + pg.id).padEnd(28)}${String(spots.length).padStart(5)}${String(covered).padStart(8)}${(asBubble + "/" + dialogue).padStart(9)}${String(an.regions.length).padStart(8)}${String(waste).padStart(6)}${String(ms).padStart(5)}`);
    an.dispose();
  }
  console.log(`${("= " + label).padEnd(28)}${String(S.items).padStart(5)}${String(S.covered).padStart(8)} (${(100 * S.covered / Math.max(1, S.items)).toFixed(0)}%)  bubbles ${S.asBubble}/${S.dialogue} (${(100 * S.asBubble / Math.max(1, S.dialogue)).toFixed(0)}%)  waste ${(S.waste / Math.max(1, S.pages)).toFixed(1)}/page`);
  for (const k of Object.keys(T)) T[k] += S[k];
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\nmisses by nearest rejection:"); for (const [k, v] of [...missReasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`\nTOTAL: coverage ${T.covered}/${T.items} = ${(100 * T.covered / Math.max(1, T.items)).toFixed(1)}%   dialogue recognised as a bubble ${T.asBubble}/${T.dialogue} = ${(100 * T.asBubble / Math.max(1, T.dialogue)).toFixed(1)}%   waste ${T.waste} regions over ${T.pages} pages = ${(T.waste / Math.max(1, T.pages)).toFixed(2)}/page   ${(T.ms / Math.max(1, T.pages)).toFixed(0)} ms/page`);
