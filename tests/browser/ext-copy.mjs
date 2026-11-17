// A test copy of the extension, for the browser tests. The product code stays untouched:
// - site access is asked at first use (optional_host_permissions), and a headless browser
//   has no one to click its prompt, so the copy asks for it at install instead;
// - with `apiUrl`, Claude requests go to the mock API.
// Seed the agreement with `agree(serviceWorker)` once the worker runs (welcome.html gives it).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function extensionCopy(src, { apiUrl = null, grantAccess = true } = {}) {
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
  return dir;
}

/** What "I agree" on the setup page stores (access.js). */
export const agree = (sw) => sw.evaluate(() => chrome.storage.local.set({ consent: { version: 1, at: new Date().toISOString() } }));
