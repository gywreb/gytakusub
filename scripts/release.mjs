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
if (out("git status --porcelain")) { console.error("Working tree not clean — commit or stash first."); process.exit(1); }
if (out("git rev-parse --abbrev-ref HEAD") !== "main") { console.error("Switch to main first."); process.exit(1); }

// 1. bump
const mp = "extension/manifest.json";
const m = JSON.parse(fs.readFileSync(mp, "utf8"));
console.log(`version ${m.version} → ${v}`);
m.version = v;
fs.writeFileSync(mp, JSON.stringify(m, null, 2) + "\n");

// 2. sync shared files (extension/ is canonical)
for (const f of ["bubble.js", "typeset.js", "prompt.js"]) fs.copyFileSync(`extension/${f}`, `web/${f}`);
for (const f of fs.readdirSync("extension/icons")) if (/^icon\d+\.png$/.test(f)) fs.copyFileSync(`extension/icons/${f}`, `web/icons/${f}`);

// 3. checks + tests
for (const dir of ["extension", "web"]) for (const f of fs.readdirSync(dir)) if (f.endsWith(".js")) run(`node --check "${dir}/${f}"`);
if (!fs.existsSync("tests/node_modules")) run("npm install --no-audit --no-fund", { cwd: "tests" });
run("npm test", { cwd: "tests" });

// 4. commit, tag, push
run("git add -A");
run(`git commit -m "Release v${v}"`);
run(`git tag v${v}`);
run(`git push origin main v${v}`);
console.log(`\nPushed v${v} — watch https://github.com/gywreb/gytakusub/actions`);
