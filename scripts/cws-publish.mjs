#!/usr/bin/env node
// Upload the extension zip to the Chrome Web Store and submit it for review, with the
// Chrome Web Store API V2 (Google planned to support the old v1.1 API only until 15 October 2026).
// No dependencies.
//
// Usage: node scripts/cws-publish.mjs <zip> [--no-publish]
// Env:
//   CWS_PUBLISHER_ID     Developer Dashboard → Publisher → Settings
//   CWS_EXTENSION_ID     the item's ID (anmnhodgeaojlhlinobnaakmgkdaoekk)
//   CWS_ACCESS_TOKEN     a Google access token with the chromewebstore scope. The release
//                        workflow gets one without any stored key (Workload Identity Federation,
//                        store/RELEASE-CHECKLIST.md § Automating updates). Or instead:
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN   to make one (scripts/cws-token.mjs)
//
// Requests and fields follow the API's discovery document (chromewebstore v2):
//   upload   POST /upload/v2/publishers/P/items/I:upload  → UploadItemPackageResponse { uploadState, crxVersion }
//   status   GET  /v2/publishers/P/items/I:fetchStatus    → { lastAsyncUploadState, … }
//   publish  POST /v2/publishers/P/items/I:publish        → PublishItemResponse { state, warningInfo }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const API = "https://chromewebstore.googleapis.com";
const UPLOAD_DONE = "SUCCEEDED", UPLOAD_PENDING = ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"];
// the submission was accepted: waiting for review, or (when review is skipped) already out
const SUBMITTED = ["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"];

/** Google's error body as one line, e.g. "400 FAILED_PRECONDITION: Item is in review". */
async function apiError(res, what) {
  let detail = "";
  try { const j = await res.json(); detail = [j?.error?.status, j?.error?.message].filter(Boolean).join(": "); } catch { /* not JSON */ }
  return new Error(`${what} failed: HTTP ${res.status}${detail ? ` ${detail}` : ""}`);
}

/** Exchanges a refresh token for an access token (the fallback when CI has no keyless sign-in). */
export async function accessTokenFromRefresh({ clientId, clientSecret, refreshToken }, fetchFn = fetch) {
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    // invalid_grant: revoked, unused for 6 months, or issued while the Google app was in "Testing" (7-day expiry)
    throw new Error(`token exchange failed: ${j.error || res.status}${j.error_description ? ` (${j.error_description})` : ""}`);
  }
  return j.access_token;
}

/**
 * Uploads the package, waits for the store to process it, checks its version, then submits it.
 * @param {{zip: Uint8Array, version: string, publisherId: string, itemId: string, token: string,
 *   publish?: boolean, fetchFn?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: (s: string) => void,
 *   pollMs?: number, maxPolls?: number}} o
 * @returns {Promise<{crxVersion: string, state: string|null}>}
 */
export async function publishPackage(o) {
  const { zip, version, publisherId, itemId, token, publish = true, fetchFn = fetch, log = console.log } = o;
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 5000, maxPolls = o.maxPolls ?? 60; // up to 5 minutes of processing
  const item = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}`;
  const auth = { Authorization: `Bearer ${token}` };

  // 1. upload
  const up = await fetchFn(`${API}/upload/v2/${item}:upload`, { method: "POST", headers: { ...auth, "Content-Type": "application/zip" }, body: zip });
  if (!up.ok) throw await apiError(up, "Upload");
  const upJ = await up.json();
  let state = upJ.uploadState, crxVersion = upJ.crxVersion;
  log(`upload: ${state}${crxVersion ? ` (version ${crxVersion})` : ""}`);

  // 2. a large package is processed after the request returns: ask until it is done
  for (let n = 0; UPLOAD_PENDING.includes(state); n++) {
    if (n >= maxPolls) throw new Error(`The store was still processing the upload after ${Math.round(maxPolls * pollMs / 1000)} s. Check the Developer Dashboard.`);
    await sleep(pollMs);
    const st = await fetchFn(`${API}/v2/${item}:fetchStatus`, { headers: auth });
    if (!st.ok) throw await apiError(st, "Status check");
    state = (await st.json()).lastAsyncUploadState;
  }
  if (state !== UPLOAD_DONE) throw new Error(`The store did not accept the package (upload state ${state || "missing"}). The Developer Dashboard shows why.`);
  // the version is in the answer only when the upload finished at once (not after processing)
  if (crxVersion && crxVersion !== version) throw new Error(`The store holds version ${crxVersion}, but this release is ${version}.`);
  if (!crxVersion) log(`(the store did not report the version; this release is ${version})`);

  if (!publish) { log("uploaded only (--no-publish); submit it in the Developer Dashboard"); return { crxVersion: crxVersion || version, state: null }; }

  // 3. submit for review; it goes live when approved, with the visibility set in the dashboard
  const pub = await fetchFn(`${API}/v2/${item}:publish`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ publishType: "DEFAULT_PUBLISH" }) });
  if (!pub.ok) throw await apiError(pub, "Submitting for review");
  const pubJ = await pub.json();
  for (const w of pubJ.warningInfo?.warnings || []) log(`warning: ${w.reason || ""} ${w.description || ""}`.trim());
  if (!SUBMITTED.includes(pubJ.state)) throw new Error(`The store did not take the submission (state ${pubJ.state || "missing"}). The Developer Dashboard shows why.`);
  log(`submitted: ${pubJ.state}`);
  return { crxVersion: crxVersion || version, state: pubJ.state };
}

// ---------- command line ----------

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [zipPath, ...flags] = process.argv.slice(2);
  const env = process.env;
  const stop = (msg, code = 1) => { console.error(msg); process.exit(code); };
  if (!zipPath) stop("usage: cws-publish.mjs <zip> [--no-publish]", 2);
  const missing = ["CWS_PUBLISHER_ID", "CWS_EXTENSION_ID"].filter((k) => !env[k]);
  if (!env.CWS_ACCESS_TOKEN && !(env.CWS_CLIENT_ID && env.CWS_CLIENT_SECRET && env.CWS_REFRESH_TOKEN)) missing.push("CWS_ACCESS_TOKEN (or CWS_CLIENT_ID + CWS_CLIENT_SECRET + CWS_REFRESH_TOKEN)");
  if (missing.length) stop(`missing: ${missing.join(", ")}. See store/RELEASE-CHECKLIST.md § Automating updates.`, 2);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const version = JSON.parse(fs.readFileSync(path.join(root, "extension", "manifest.json"), "utf8")).version;
  try {
    const token = env.CWS_ACCESS_TOKEN || await accessTokenFromRefresh({ clientId: env.CWS_CLIENT_ID, clientSecret: env.CWS_CLIENT_SECRET, refreshToken: env.CWS_REFRESH_TOKEN });
    await publishPackage({ zip: fs.readFileSync(zipPath), version, publisherId: env.CWS_PUBLISHER_ID, itemId: env.CWS_EXTENSION_ID, token, publish: !flags.includes("--no-publish") });
  } catch (e) {
    stop(`::error::${e.message}`);
  }
}
