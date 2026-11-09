#!/usr/bin/env node
// Upload a zip to the Chrome Web Store and submit it for review.
// No dependencies. Needs env: CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN.
// Usage: node scripts/cws-publish.mjs dist/gytakusub-extension-2.0.1.zip [--no-publish]
import fs from "node:fs";

const [, , zipPath, ...flags] = process.argv;
const { CWS_EXTENSION_ID: id, CWS_CLIENT_ID: cid, CWS_CLIENT_SECRET: secret, CWS_REFRESH_TOKEN: refresh } = process.env;
if (!zipPath || !id || !cid || !secret || !refresh) {
  console.error("usage: cws-publish.mjs <zip>  (env: CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN)");
  process.exit(2);
}

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("token exchange failed: " + JSON.stringify(j));
  return j.access_token;
}

const token = await accessToken();
const h = { Authorization: `Bearer ${token}`, "x-goog-api-version": "2" };

// 1. upload the package
const up = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${id}`, {
  method: "PUT", headers: h, body: fs.readFileSync(zipPath),
});
const upJ = await up.json();
console.log("upload:", JSON.stringify(upJ));
if (upJ.uploadState !== "SUCCESS" && upJ.uploadState !== "IN_PROGRESS") {
  console.error("Upload rejected:", (upJ.itemError || []).map((e) => e.error_detail).join("; "));
  process.exit(1);
}

// 2. submit for review (publishes automatically after approval, like the dashboard checkbox)
if (flags.includes("--no-publish")) { console.log("uploaded only (--no-publish)"); process.exit(0); }
const pub = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${id}/publish`, { method: "POST", headers: h });
const pubJ = await pub.json();
console.log("publish:", JSON.stringify(pubJ));
if (!pub.ok || (pubJ.status || []).some((s) => !/^(OK|ITEM_PENDING_REVIEW|PUBLISHED_WITH_FRICTION_WARNING)$/.test(s))) {
  console.error("Publish not accepted:", (pubJ.statusDetail || []).join("; "));
  process.exit(1);
}
console.log("Submitted for review.");
