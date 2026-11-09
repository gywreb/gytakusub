#!/usr/bin/env node
// Cut a release (cross-platform): bump manifest version, sync shared files,
// run checks + tests, commit, tag, push. CI does the rest (zip, GitHub Release,
// Chrome Web Store upload).
// Usage:  node scripts/release.mjs 1.0.1
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || "")) { console.error("usage: node scripts/release.mjs X.Y.Z"); process.exit(2); }
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) { console.error(`Node ${process.versions.node} is too old; install Node 22 LTS from https://nodejs.org`); process.exit(1); }
if (out("git status --porcelain")) { console.error("Working tree not clean — commit or stash first."); process.exit(1); }
if (out("git rev-parse --abbrev-ref HEAD") !== "main") { console.error("Switch to main first."); process.exit(1); }

// 1. sync shared files (extension/ is canonical)
for (const f of ["prompt.js", "text.js"]) fs.copyFileSync(`extension/${f}`, `web/${f}`);
for (const d of ["engine", "vendor"]) { fs.rmSync(`web/${d}`, { recursive: true, force: true }); fs.cpSync(`extension/${d}`, `web/${d}`, { recursive: true }); }
for (const f of fs.readdirSync("extension/icons")) if (/^icon\d+\.png$/.test(f)) fs.copyFileSync(`extension/icons/${f}`, `web/icons/${f}`);
fs.mkdirSync("web/fonts", { recursive: true });
for (const f of fs.readdirSync("extension/fonts")) fs.copyFileSync(`extension/fonts/${f}`, `web/fonts/${f}`);

// 2. checks + tests
const check = (file) => {
  try { execSync("node --input-type=module --check", { input: fs.readFileSync(file), stdio: ["pipe", "inherit", "inherit"] }); }
  catch { console.error(`Syntax error in ${file}`); process.exit(1); }
};
for (const dir of ["extension", "web"]) for (const f of fs.readdirSync(dir)) if (f.endsWith(".js")) check(`${dir}/${f}`);
if (!fs.existsSync("tests/node_modules")) run("npm install --no-audit --no-fund", { cwd: "tests" });
run("npm test", { cwd: "tests" });

// 4. bump the version (only now, after everything passed)
const mp = "extension/manifest.json";
const m = JSON.parse(fs.readFileSync(mp, "utf8"));
console.log(`version ${m.version} → ${v}`);
m.version = v;
fs.writeFileSync(mp, JSON.stringify(m, null, 2) + "\n");


// 5. commit (nothing to commit when the version was bumped in a pull request), tag, push
run("git add -A");
if (out("git status --porcelain")) run(`git commit -m "Release v${v}"`);
run(`git tag v${v}`);
run(`git push origin main v${v}`);
console.log(`\nPushed v${v} — watch https://github.com/gywreb/gytakusub/actions`);
