// Did GitHub's tests pass for this commit? Used by release.mjs: CI is the test gate, because
// the full suite needs tools that CI installs and a computer usually doesn't have (Python with
// numpy, onnx and Pillow for the stand-in segmentation model, a software GPU, downloaded models).
// Reads the public check runs of the commit (no login for a public repo; GITHUB_TOKEN or
// GH_TOKEN is used when set). No dependencies.

/** "owner/repo" from a git remote URL (https or ssh), or null. */
export function repoFromRemote(url) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The result of the "test" check (the gate job in .github/workflows/test.yml) on `sha`.
 * @returns {Promise<{state: "passed"|"running"|"failed"|"missing", url: string, detail?: string}>}
 */
export async function testsFor(repo, sha, { fetchFn = fetch, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, check = "test" } = {}) {
  const url = `https://github.com/${repo}/commit/${sha}/checks`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "gytakusub-release-script", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchFn(`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the commit's checks${res.status === 403 ? " (rate limit: wait an hour or set GH_TOKEN)" : ""}`);
  const all = (await res.json()).check_runs || [];
  const runs = all.filter((r) => r.name === check);
  // the gate job starts only after the others: while they run, it isn't there yet
  if (!runs.length) return { state: all.some((r) => r.status !== "completed") ? "running" : "missing", url };
  // the newest run counts (a re-run replaces an earlier result)
  const run = runs.sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")))[0];
  if (run.status !== "completed") return { state: "running", url: run.html_url || url };
  if (run.conclusion === "success") return { state: "passed", url: run.html_url || url };
  return { state: "failed", url: run.html_url || url, detail: run.conclusion };
}
