// A test copy of the extension, for the browser tests. The product code stays untouched:
// - site access is asked at first use (optional_host_permissions), and a headless browser
//   has no one to click its prompt, so the copy asks for it at install instead;
// - with `apiUrl`, Claude requests go to the mock API;
// - with `autoBudget`, auto-translate pauses after that many pages (content.js AUTO_BUDGET).
// Seed the agreement with `agree(serviceWorker)` once the worker runs (welcome.html gives it).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function extensionCopy(src, { apiUrl = null, grantAccess = true, autoBudget = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-ext-"));
  fs.cpSync(src, dir, { recursive: true });
  if (grantAccess) {
    const mf = path.join(dir, "manifest.json"), m = JSON.parse(fs.readFileSync(mf, "utf8"));
    m.host_permissions = m.optional_host_permissions;
    delete m.optional_host_permissions;
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  }
  if (apiUrl) {
    const pj = path.join(dir, "prompt.js");
    fs.writeFileSync(pj, fs.readFileSync(pj, "utf8").replace(/export const API_URL = "[^"]+"/, `export const API_URL = "${apiUrl}"`));
  }
  if (autoBudget != null) { // a small auto-translate budget, to reach it in a short test
    const cj = path.join(dir, "content.js"), code = fs.readFileSync(cj, "utf8");
    if (!/const AUTO_BUDGET = \d+/.test(code)) throw new Error("content.js: AUTO_BUDGET not found");
    fs.writeFileSync(cj, code.replace(/const AUTO_BUDGET = \d+/, `const AUTO_BUDGET = ${autoBudget}`));
  }
  return dir;
}

/**
 * What "I agree" on the setup page stores (access.js), and that setup page closed: it opens on
 * install, as the active tab, and a test page behind it would be hidden (document.hidden), which
 * changes what counts as on screen.
 */
export const agree = (sw) => sw.evaluate(async () => {
  await chrome.storage.local.set({ consent: { version: 1, at: new Date().toISOString() } });
  const url = chrome.runtime.getURL("welcome.html");
  for (let i = 0; i < 30; i++) {
    const tabs = (await chrome.runtime.getContexts({ contextTypes: ["TAB"] })).filter((c) => c.documentUrl?.startsWith(url));
    if (tabs.length) { await chrome.tabs.remove(tabs.map((c) => c.tabId)); return; }
    await new Promise((r) => setTimeout(r, 100));
  }
});
