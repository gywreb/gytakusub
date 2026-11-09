#!/usr/bin/env node
// The project's rule: a pull request that changes what people see carries screenshots.
// Reads the changed file names (one per line on stdin) and the pull request's description
// (PR_BODY env var); fails when a UI file changed and the description has no image.
// Usage (CI):  gh api …/pulls/N/files --jq '.[].filename' | PR_BODY="…" node scripts/check-screenshots.mjs

// What counts as UI: the pages, styles and scripts that draw the web app, the extension's
// popup, Options page and in-page overlay, and the icons and fonts.
const UI = [
  /^web\/[^/]+\.(html|css)$/, /^web\/app\.js$/, /^web\/manifest\.webmanifest$/, /^web\/icons\//,
  /^extension\/[^/]+\.(html|css)$/, /^extension\/(popup|options|content)\.js$/, /^extension\/(icons|fonts)\//,
];
// An image in the description: Markdown ![…](…), an <img> tag, or a link to an image or a GitHub attachment.
const IMAGE = /!\[[^\]]*\]\([^)]+\)|<img\s[^>]*src=|https:\/\/github\.com\/user-attachments\/assets\/|https?:\/\/\S+\.(png|jpe?g|gif|webp)\b/i;

const files = (await new Promise((resolve) => { let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => resolve(s)); }))
  .split("\n").map((f) => f.trim()).filter(Boolean);
const ui = files.filter((f) => UI.some((re) => re.test(f)));
if (!ui.length) { console.log(`ok: no UI files changed (${files.length} files)`); process.exit(0); }
if (IMAGE.test(process.env.PR_BODY || "")) { console.log(`ok: UI changed (${ui.join(", ")}) and the description has screenshots`); process.exit(0); }
const msg = `This pull request changes UI (${ui.join(", ")}) but its description has no screenshots. ` +
  `Add them under "Screenshots" (before and after; phone and desktop, dark and light where the change shows there) and this check re-runs when the description is saved.`;
console.error(process.env.GITHUB_ACTIONS ? `::error::${msg}` : `✗ ${msg}`);
process.exit(1);
