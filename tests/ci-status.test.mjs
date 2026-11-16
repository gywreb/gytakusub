// scripts/ci-status.mjs: reading the repo from the remote, and the "test" check of a commit
// as GitHub's check-runs API returns it (a fake API here).
import assert from "node:assert/strict";
import { repoFromRemote, testsFor } from "../scripts/ci-status.mjs";

let checks = 0;
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };

eq(repoFromRemote("https://github.com/gywreb/gytakusub.git"), "gywreb/gytakusub");
eq(repoFromRemote("https://github.com/gywreb/gytakusub"), "gywreb/gytakusub");
eq(repoFromRemote("git@github.com:gywreb/gytakusub.git\n"), "gywreb/gytakusub");
eq(repoFromRemote("https://gitlab.com/x/y.git"), null);

const api = (runs, status = 200) => async (url, init) => {
  assert.equal(url, "https://api.github.com/repos/gywreb/gytakusub/commits/abc123/check-runs?per_page=100");
  assert.ok(init.headers["User-Agent"]);
  return { ok: status === 200, status, json: async () => ({ check_runs: runs }) };
};
const run = (name, status, conclusion, started_at = "2026-11-16T08:49:00Z") => ({ name, status, conclusion, started_at, html_url: `https://github.com/run/${name}` });
const at = (runs, status) => testsFor("gywreb/gytakusub", "abc123", { fetchFn: api(runs, status), token: "" });

eq((await at([run("changes", "completed", "success"), run("test", "completed", "success")])).state, "passed");
eq((await at([run("test", "in_progress", null)])).state, "running");
eq((await at([run("test", "queued", null)])).state, "running");
const failed = await at([run("test", "completed", "failure")]);
eq([failed.state, failed.detail], ["failed", "failure"]);
eq((await at([run("extension", "completed", "success")])).state, "missing");
// the gate job is created after the suites finish: until then it is "running", not missing
eq((await at([run("web", "completed", "success"), run("extension", "in_progress", null)])).state, "running");
// a re-run replaces the earlier result
eq((await at([run("test", "completed", "failure", "2026-11-16T08:49:00Z"), run("test", "completed", "success", "2026-11-16T09:30:00Z")])).state, "passed");
await assert.rejects(at([], 403), /403.*rate limit/); checks++;

console.log(`ci-status: ${checks} checks passed`);
