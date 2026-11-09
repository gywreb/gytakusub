#!/usr/bin/env node
// Release what is on main (cross-platform): checks, tests, then tags the version that main's
// pull requests already set and pushes the tag. CI does the rest (zip, GitHub Release, and the
// Chrome Web Store upload when its secrets exist).
// Versions are not bumped here: every pull request carries its own (scripts/check-version.mjs).
// Usage:  node scripts/release.mjs            releases the version in extension/manifest.json
//         node scripts/release.mjs 2.2.0      the same, after checking that it is that version
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });
const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const stop = (msg) => { console.error(msg); process.exit(1); };

const major = Number(process.versions.node.split(".")[0]);
if (major < 18) stop(`Node ${process.versions.node} is too old; install Node 22 LTS from https://nodejs.org`);
const v = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8")).version;
if (process.argv[2] && process.argv[2] !== v) stop(`main is at ${v}, not ${process.argv[2]}. Versions are bumped in pull requests, not here.`);
if (out("git status --porcelain")) stop("Working tree not clean — commit or stash first.");
if (out("git rev-parse --abbrev-ref HEAD") !== "main") stop("Switch to main first.");
run("git fetch --quiet origin main --tags");
if (out("git rev-parse HEAD") !== out("git rev-parse origin/main")) stop("Your main differs from GitHub's: git pull first.");
if (out(`git tag --list v${v}`)) stop(`v${v} is already tagged. Merge a pull request with a new version first.`);

// 1. sync shared files (extension/ is canonical); a tracked file changing here means main is out of sync
run("node scripts/sync-shared.mjs");
if (out("git status --porcelain")) stop("The web app's copies of shared files differ from extension/. Fix that in a pull request first:\n" + out("git status --short"));

// 2. checks + tests
const check = (file) => {
  try { execSync("node --input-type=module --check", { input: fs.readFileSync(file), stdio: ["pipe", "inherit", "inherit"] }); }
  catch { stop(`Syntax error in ${file}`); }
};
for (const dir of ["extension", "web"]) for (const f of fs.readdirSync(dir)) if (f.endsWith(".js")) check(`${dir}/${f}`);
run(`node scripts/check-version.mjs --release ${v}`);
if (!fs.existsSync("tests/node_modules")) run("npm install --no-audit --no-fund", { cwd: "tests" });
run("npm test", { cwd: "tests" });

// 3. tag and push
run(`git tag v${v}`);
run(`git push origin v${v}`);
console.log(`\nPushed v${v} — watch https://github.com/gywreb/gytakusub/actions`);
