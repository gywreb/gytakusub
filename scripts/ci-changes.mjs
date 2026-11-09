#!/usr/bin/env node
// Which test suites a pull request needs, from its changed files on stdin: one per line, either a
// file name or a JSON object {filename, patch} as GitHub's pull request files API gives them.
// Prints GitHub Actions outputs: "extension=true|false" and "web=true|false".
// - Documentation-only changes need neither.
// - Files only the web app and the fetcher use need the web suite (fetcher tests + the web app in a browser).
// - Everything else needs both: the engine, models and fonts in extension/ are shared with the web app,
//   and an unknown file errs on the side of running everything.
// Pushes to main and releases always run both (see .github/workflows/test.yml).
const DOCS = [/\.md$/i, /^docs\//, /^store\//, /^LICENSE$/, /^\.github\/pull_request_template\.md$/];
const WEB_ONLY = [
  /^web\//, /^fetcher\//, /^tests\/browser\/web\.mjs$/, /^tests\/fetcher\.test\.mjs$/, /^tests\/fixtures\/fetcher\//,
  /^scripts\/check-guide\.mjs$/, /^\.github\/workflows\/(pages|guide-check)\.yml$/,
];
// rules/release tooling that no test exercises: checked by its own workflow, not the suites
const TOOLING = [/^scripts\/(check-version|check-screenshots|release)\.mjs$/, /^scripts\/release\.sh$/, /^\.github\/workflows\/(pr-checks|release)\.yml$/];

// Every pull request raises the version (CONTRIBUTING.md), so a manifest change that touches only
// "version" is not a reason to run the extension suite; any other manifest change is.
const versionOnly = (patch) => !!patch && patch.split("\n").filter((l) => /^[+-]/.test(l)).every((l) => /^[+-]\s*"version":/.test(l));

const entries = (await new Promise((resolve) => { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => resolve(s)); }))
  .split("\n").map((l) => l.trim()).filter(Boolean)
  .map((l) => (l.startsWith("{") ? JSON.parse(l) : { filename: l }));
const files = entries.map((e) => e.filename);
const code = entries
  .filter((e) => !(e.filename === "extension/manifest.json" && versionOnly(e.patch)))
  .map((e) => e.filename)
  .filter((f) => !DOCS.some((re) => re.test(f)) && !TOOLING.some((re) => re.test(f)));
const web = code.length > 0;
const extension = code.some((f) => !WEB_ONLY.some((re) => re.test(f)));
console.log(`extension=${extension}`);
console.log(`web=${web}`);
console.error(`${files.length} changed; extension suite: ${extension ? "yes" : "no"}, web suite: ${web ? "yes" : "no"}`);
