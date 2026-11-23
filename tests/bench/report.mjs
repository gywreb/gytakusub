// Writes the measured numbers into README.md and docs/QUALITY.md, between their markers, from the
// bench runs of one build (the engine as it is in this working copy):
//   node bench/report.mjs --real 'runs/m109-*.jsonl' --generated 'runs/syn-*.jsonl' [--dry]
// (globs, quoted: the script expands them). --dry prints the blocks instead of writing them.
// The runs come from bench/manga109.mjs (real pages, Manga109-s) and bench/synth-run.mjs (generated
// pages); docs/QUALITY.md says how to make them.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const glob = (pattern) => {
  if (!pattern) return [];
  const dir = path.dirname(pattern), re = new RegExp("^" + path.basename(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f));
};
// rows, the last one per page (a run restarted half way may have counted a page twice)
const load = (pattern, key) => {
  const rows = new Map();
  for (const f of glob(pattern)) for (const l of fs.readFileSync(f, "utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l); rows.set(r[key], r); }
  return [...rows.values()];
};
const real = load(opt("--real"), "page"), generated = load(opt("--generated"), "seed");
if (!real.length || !generated.length) { console.error("need both runs: --real and --generated"); process.exit(1); }

const sum = (rs, f) => rs.reduce((n, r) => n + (r[f] || 0), 0);
const pct = (a, b, d = 1) => (b ? (100 * a / b).toFixed(d) + "%" : "—");
const held = real.filter((r) => r.split === "held"), look = real.filter((r) => r.split === "look");
const n = (v) => v.toLocaleString("en-US");

const readme = [
  "| Measure | Result |",
  "|---|---|",
  `| Lines found on the page before Claude answers | ${pct(sum(held, "found"), sum(held, "told"))} |`,
  `| Lettering the independent detector still sees after erasing | ${pct(sum(held, "left"), sum(held, "seen"))} |`,
  `| Lines set under 0.7 of the original lettering's size | ${pct(sum(held, "smallL"), sum(held, "measured"))} |`,
  `| Pixels changed away from any text (art damage) | ${(sum(held, "damage") / held.length / 10).toFixed(2)}% |`,
  "",
  `Real pages from the held-out books: ${n(held.length)} pages, ${n(sum(held, "told"))} lines.`,
].join("\n");

const realRow = (name, rs) => `| ${name} | ${n(rs.length)} | ${n(sum(rs, "told"))} | ${pct(sum(rs, "found"), sum(rs, "told"))} | ${pct(sum(rs, "left"), sum(rs, "seen"))} | ${pct(sum(rs, "smallL"), sum(rs, "measured"))} | ${(sum(rs, "damage") / rs.length / 10).toFixed(2)}% | ${pct(sum(rs, "sfxChanged"), sum(rs, "sfxArea"), 2)} |`;
const SCRIPTS = { ja: "Japanese", zh: "Chinese", ko: "Korean", en: "English", es: "Spanish", pt: "Portuguese", vi: "Vietnamese" };
const genRow = (name, rs) => `| ${name} | ${n(rs.length)} | ${n(sum(rs, "lines"))} | ${pct(sum(rs, "found"), sum(rs, "lines"))} | ${pct(sum(rs, "stays"), sum(rs, "lines"))} | ${pct(sum(rs, "small"), sum(rs, "lines"))} | ${pct(sum(rs, "letterFar"), sum(rs, "lines"))} | ${pct(sum(rs, "overflow"), sum(rs, "bubbleLines"))} | ${pct(sum(rs, "touch"), sum(rs, "bubbleLines"))} | ${(sum(rs, "damage") / rs.length / 10).toFixed(3)}% |`;
const quality = [
  "### Real pages (Manga109-s)",
  "",
  "| Books | Pages | Lines | Found before Claude answers | Lettering still seen | Set under 0.7 of its size | Art damage | Sound effects changed |",
  "|---|---|---|---|---|---|---|---|",
  realRow("held out", held),
  realRow("looked at", look),
  "",
  "### Generated pages",
  "",
  "| Script | Pages | Lines | Found before Claude answers | Lettering left untouched | Set under 0.7 of its size | Size measured outside 0.6–1.6× | Text past its bubble | Touching its outline | Art damage |",
  "|---|---|---|---|---|---|---|---|---|---|",
  genRow("all", generated),
  ...Object.entries(SCRIPTS).map(([k, name]) => genRow(name, generated.filter((r) => r.script === k))),
  "",
  "### Where text size is lost",
  "",
  "What holds each line set under 0.7 of its size small: the same line fitted again in a room a quarter wider, and a quarter taller (`bench/limits.mjs`).",
  "",
  "| Pages | Lines set small | Width (a long word across a narrow room) | Height | Either | Not the room |",
  "|---|---|---|---|---|---|",
  ...[["Real, held out", held, "smallL", "measured"], ["Real, looked at", look, "smallL", "measured"], ["Generated", generated, "small", "lines"]].map(([name, rs, k, of]) =>
    `| ${name} | ${pct(sum(rs, k), sum(rs, of))} | ${pct(sum(rs, "smallWidth"), sum(rs, k))} | ${pct(sum(rs, "smallHeight"), sum(rs, k))} | ${pct(sum(rs, "smallBoth"), sum(rs, k))} | ${pct(sum(rs, "smallNeither"), sum(rs, k))} |`),
  "",
  "On generated pages, where every letter size and bubble is known exactly:",
  "",
  `- **The size estimate:** with the true letter size, ${pct(sum(generated, "smallLetter"), sum(generated, "lines"))} of lines are set small, against ${pct(sum(generated, "small"), sum(generated, "lines"))}.`,
  `- **The translation's length:** of the lines set small that are alone in their bubble, ${pct(sum(generated, "smallGeometry"), sum(generated, "smallGeometry") + sum(generated, "smallAvoidable"))} could not be set at 0.7 of their size in that bubble however they were laid out, with no margin from the outline. The rest (${n(sum(generated, "smallAvoidable"))} lines) could have been${generated.some((r) => "smallAvoidableClear" in r) ? `; ${n(sum(generated, "smallAvoidableClear"))} of them (${pct(sum(generated, "smallAvoidableClear"), sum(generated, "lines"))} of all lines) keeping their letters clear of the outline, as the engine does since 2.15. The others fit only by touching it` : ""}.`,
  `- Not judged: ${n(sum(generated, "smallShared"))} small lines that share their bubble with another line, and ${n(sum(generated, "smallFree"))} over the art.`,
].join("\n");

const put = (file, tag, block) => {
  const p = path.join(root, file), s = fs.readFileSync(p, "utf8");
  const re = new RegExp(`(<!-- ${tag}:start[^>]*-->)[\\s\\S]*?(<!-- ${tag}:end -->)`);
  if (!re.test(s)) { console.warn(`${file}: no <!-- ${tag}:start --> … <!-- ${tag}:end --> markers, left as it is`); return false; }
  fs.writeFileSync(p, s.replace(re, `$1\n${block}\n$2`));
  return true;
};
if (argv.includes("--dry")) { console.log(readme + "\n\n" + quality); process.exit(0); }
const wrote = [put("README.md", "quality", readme) && "README.md", put("docs/QUALITY.md", "results", quality) && "docs/QUALITY.md"].filter(Boolean);
console.log(`${wrote.join(" and ") || "nothing written"}: ${held.length} held-out real pages, ${generated.length} generated pages`);
