#!/usr/bin/env node
// The project's rule: every pull request carries a version.
// - extension/manifest.json's "version" is higher than on the base branch
//   (patch for fixes, minor for new features, major for breaking changes);
// - CHANGELOG.md has a dated section for it: "## [X.Y.Z] — YYYY-MM-DD";
// - nothing is left under "## [Unreleased]" (each change belongs to a version).
// The fetcher's VERSION (fetcher/worker.js) is separate: it is the protocol version the web app
// requires, and raising it makes every user update their fetcher, so it changes only with the fetcher.
// Run from the repository root; it checks the files there.
// Usage:  node scripts/check-version.mjs origin/main      (CI, on pull requests)
//         node scripts/check-version.mjs --release 2.2.0  (release.mjs: the changelog has that version)
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const errors = [];
const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(v || "") || []).slice(1).map(Number);
const newer = (a, b) => { const [x, y] = [parse(a), parse(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const version = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8")).version;
const changelog = fs.readFileSync("CHANGELOG.md", "utf8");

if (parse(version).length !== 3) errors.push(`extension/manifest.json has version "${version}"; it must be X.Y.Z.`);
const esc = version.replace(/\./g, "\\.");
if (!new RegExp(`^## \\[${esc}\\] — \\d{4}-\\d{2}-\\d{2}`, "m").test(changelog)) {
  errors.push(`CHANGELOG.md has no section for ${version}. Add "## [${version}] — YYYY-MM-DD" with what this pull request changes.`);
}
const unreleased = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[)/m.exec(changelog);
if (unreleased && unreleased[1].trim()) errors.push(`CHANGELOG.md has entries under "## [Unreleased]". Move them into the ${version} section.`);

if (process.argv[2] === "--release") {
  if (process.argv[3] && process.argv[3] !== version) errors.push(`extension/manifest.json is at ${version}, not ${process.argv[3]}.`);
} else {
  const base = process.argv[2];
  if (!base) { console.error("usage: node scripts/check-version.mjs <base-ref> | --release X.Y.Z"); process.exit(2); }
  const baseVersion = JSON.parse(execFileSync("git", ["show", `${base}:extension/manifest.json`], { encoding: "utf8" })).version;
  if (!newer(version, baseVersion)) {
    errors.push(`This pull request doesn't raise the version: ${base} is at ${baseVersion}, this branch at ${version}. ` +
      `Every pull request carries a version: bump extension/manifest.json above ${baseVersion} (patch for fixes, minor for features, major for breaking changes) and add its CHANGELOG.md section. ` +
      `If another pull request took that version first, take the next one.`);
  }
  if (!errors.length) console.log(`version ${baseVersion} → ${version}`);
}

if (errors.length) {
  for (const e of errors) console.error(process.env.GITHUB_ACTIONS ? `::error::${e}` : `✗ ${e}`);
  process.exit(1);
}
console.log(`ok: version ${version} with its changelog section`);
