// Checks that what the chapter-link setup guide relies on outside this repository
// is unchanged: Cloudflare's docs pages (their dateModified), the Deploy to
// Cloudflare link, and MangaDex's chapter API. Prints a Markdown report; exits 1
// when something changed or broke, so the weekly workflow opens an issue.
//   node scripts/check-guide.mjs [fetcher/guide-sources.json]
import fs from "node:fs";

const file = process.argv[2] || new URL("../fetcher/guide-sources.json", import.meta.url);
const src = JSON.parse(fs.readFileSync(file, "utf8"));
const UA = "gytakusub-guide-check (+https://github.com/gywreb/gytakusub)";
const problems = [], fine = [];

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  return { status: res.status, text: await res.text() };
}

for (const p of src.pages) {
  try {
    const { status, text } = await get(p.url);
    const seen = /"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] || /\*\*Last updated:?\*\*\s*([^\n]+)/i.exec(text)?.[1];
    if (status !== 200) problems.push(`- **${p.url}** answered HTTP ${status} (the guide uses it for: ${p.uses}). The page may have moved; find its new address in Cloudflare's docs.`);
    else if (!seen) problems.push(`- **${p.url}**: no modification date found on the page any more; review it by hand (used for: ${p.uses}).`);
    else if (seen !== p.dateModified) problems.push(`- **${p.url}** changed: dateModified ${p.dateModified} → ${seen}. Compare it with the guide (used for: ${p.uses}).`);
    else fine.push(`- ${p.url}: unchanged since ${p.dateModified}`);
  } catch (e) { problems.push(`- **${p.url}**: could not be fetched (${e.message}).`); }
}

for (const p of src.probes) {
  try {
    const { status, text } = await get(p.url);
    let ok = status === 200;
    if (ok && p.expect === "mangadex-at-home") {
      try { const j = JSON.parse(text); ok = typeof j.baseUrl === "string" && Array.isArray(j.chapter?.data) && j.chapter.data.length > 0; } catch { ok = false; }
    }
    if (ok) fine.push(`- ${p.url}: OK`);
    else problems.push(`- **${p.url}** did not answer as expected (HTTP ${status}; check: ${p.expect}). Used for: ${p.uses}.`);
  } catch (e) { problems.push(`- **${p.url}**: could not be fetched (${e.message}). Used for: ${p.uses}.`); }
}

const report = [
  problems.length ? `## Chapter-link setup guide: ${problems.length} thing(s) to review` : "## Chapter-link setup guide: nothing changed",
  "",
  `The guide was last checked on ${src.checked} (\`fetcher/guide-sources.json\`).`,
  "",
  ...(problems.length ? ["### Changed or broken", ...problems, "", "Review the steps in `web/index.html` (`#fetcherWizard`) and `fetcher/README.md` against these pages, then update the dates and `checked` in `fetcher/guide-sources.json`.", ""] : []),
  "### Unchanged",
  ...(fine.length ? fine : ["- (none)"]),
].join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
process.exitCode = problems.length ? 1 : 0;
