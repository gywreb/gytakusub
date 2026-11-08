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
import { cv, detector, analyzePage } from "./cv-node.mjs";

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
const WASTE_KINDS = {};
let T = { items: 0, covered: 0, asBubble: 0, dialogue: 0, asBubbleChars: 0, dialogueChars: 0, regions: 0, waste: 0, pages: 0, ms: 0 };
console.log("report/page                 items covered asBubble regions waste  ms");
for (const zip of args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-score-"));
  execFileSync("unzip", ["-oq", zip, "-d", tmp]);
  const summary = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8"));
  const label = path.basename(zip).replace(/^.*?gytakusub-report-/, "").replace(/-\d{4}-.*$/, "");
  let S = { items: 0, covered: 0, asBubble: 0, dialogue: 0, asBubbleChars: 0, dialogueChars: 0, regions: 0, waste: 0, pages: 0, ms: 0 };
  for (const pg of summary.pages) {
    const rep = JSON.parse(fs.readFileSync(path.join(tmp, `page-${pg.id}.json`), "utf8"));
    const orig = fs.readdirSync(tmp).find((f) => f.startsWith(`page-${pg.id}.original.`));
    if (!orig) continue;
    const img = await loadImage(path.join(tmp, orig));
    const { W, H } = rep.work;
    const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
    const t0 = Date.now();
    rejections = [];
    const an = await analyzePage(ctx.getImageData(0, 0, W, H));
    const ms = Date.now() - t0;
    // where the model saw text: the stamped region it named (as the report recorded
    // it) when it gave one, else the centre of its own box
    const spots = [];
    for (const it of rep.items) {
      if (!it.text) continue;
      const reg = it.tag != null ? rep.regions.find((r) => r.id === it.tag) : null;
      const dialogue = it.kind === "bubble"; // the model's own kind: speech/thought bubble vs narration/sign
      // where the text is: the stamped region the model named (as the report recorded
      // it) and/or the centre of the model's own box — either may be wrong, so an
      // item counts as found if any of its witnesses lands in a detected region
      const pts = [];
      if (reg) pts.push({ x: reg.box.x + reg.box.w / 2, y: reg.box.y + reg.box.h / 2 });
      if (it.box) pts.push({ x: (it.box[0] + it.box[2] / 2) * W, y: (it.box[1] + it.box[3] / 2) * H });
      if (pts.length) spots.push({ pts, x: pts[0].x, y: pts[0].y, text: it.text, dialogue });
    }
    const used = new Set();
    let covered = 0, asBubble = 0, dialogue = 0, asBubbleChars = 0, dialogueChars = 0;
    for (const sp of spots) {
      if (sp.dialogue) { dialogue++; dialogueChars += sp.text.length; }
      let r = null; for (const pt of sp.pts) { r = an.regions.find((q) => inside(q, pt.x, pt.y) && q.kind === "bubble") || an.regions.find((q) => inside(q, pt.x, pt.y)); if (r?.kind === "bubble") break; }
      if (r) {
        covered++; used.add(r.id);
        if (sp.dialogue && r.kind === "bubble") { asBubble++; asBubbleChars += sp.text.length; }
        else if (sp.dialogue) {
          const around = rejections.filter((j) => j.kind === "region" && inside(j, sp.x, sp.y)).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
          const why = "NOT-AS-BUBBLE " + (around.length ? around[0].why : "no bubble candidate");
          missReasons.set(why, (missReasons.get(why) || 0) + 1);
          if (showMisses) console.log(`   ${why} ${label}/${pg.id} ${JSON.stringify(sp.text).slice(0, 40)} ${around.length ? JSON.stringify(around[0].extra, (k, v) => (typeof v === "number" ? +v.toFixed(2) : v)).slice(0, 100) : ""}`);
        }
        continue;
      }
      // explain the miss: the smallest rejected region (or block) around the spot
      const around = rejections.filter((j) => inside(j, sp.x, sp.y)).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
      const why = around.length ? `${around[0].kind}: ${around[0].why}` : "no candidate at all";
      missReasons.set(why, (missReasons.get(why) || 0) + 1);
      if (showMisses) console.log(`   MISS ${label}/${pg.id} ${JSON.stringify(sp.text).slice(0, 40)} ← ${why} ${around.length ? JSON.stringify(around[0].extra, (k, v) => (typeof v === "number" ? +v.toFixed(2) : v)).slice(0, 120) : ""}`);
    }
    const wasted = an.regions.filter((r) => !used.has(r.id)), waste = wasted.length;
    // what the unused regions are: a segmented bubble with lettering inside (the model
    // answered nothing for it in this run — often because it was never stamped then),
    // a segmented bubble with no lettering (the segmenter's false positive, or text the
    // detector missed), a rule-based bubble, or a loose text block
    for (const r of wasted) { const k = r.kind !== "bubble" ? "block" : r.ref.segmented ? (r.ref.blocks.length ? "segmented+text" : "segmented-empty") : "rule-bubble"; WASTE_KINDS[k] = (WASTE_KINDS[k] || 0) + 1; }
    S.items += spots.length; S.covered += covered; S.asBubble += asBubble; S.dialogue += dialogue; S.asBubbleChars += asBubbleChars; S.dialogueChars += dialogueChars; S.regions += an.regions.length; S.waste += waste; S.pages++; S.ms += ms;
    console.log(`${(label + "/" + pg.id).padEnd(28)}${String(spots.length).padStart(5)}${String(covered).padStart(8)}${(asBubble + "/" + dialogue).padStart(9)}${String(an.regions.length).padStart(8)}${String(waste).padStart(6)}${String(ms).padStart(5)}`);
    an.dispose();
  }
  console.log(`${("= " + label).padEnd(28)}${String(S.items).padStart(5)}${String(S.covered).padStart(8)} (${(100 * S.covered / Math.max(1, S.items)).toFixed(0)}%)  bubbles ${S.asBubble}/${S.dialogue} (${(100 * S.asBubble / Math.max(1, S.dialogue)).toFixed(0)}%, by text ${(100 * S.asBubbleChars / Math.max(1, S.dialogueChars)).toFixed(0)}%)  waste ${(S.waste / Math.max(1, S.pages)).toFixed(1)}/page`);
  for (const k of Object.keys(T)) T[k] += S[k];
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log("\nmisses by nearest rejection:"); for (const [k, v] of [...missReasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`waste by kind: ${JSON.stringify(WASTE_KINDS)}`);
console.log(`\nTOTAL: coverage ${T.covered}/${T.items} = ${(100 * T.covered / Math.max(1, T.items)).toFixed(1)}%   dialogue recognised as a bubble ${T.asBubble}/${T.dialogue} = ${(100 * T.asBubble / Math.max(1, T.dialogue)).toFixed(1)}% (by text ${(100 * T.asBubbleChars / Math.max(1, T.dialogueChars)).toFixed(1)}%)   waste ${T.waste} regions over ${T.pages} pages = ${(T.waste / Math.max(1, T.pages)).toFixed(2)}/page   ${(T.ms / Math.max(1, T.pages)).toFixed(0)} ms/page`);
