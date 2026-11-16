#!/usr/bin/env node
// One-time helper for the fallback way of letting CI upload to the Chrome Web Store: a refresh
// token stored as a GitHub secret. The recommended way stores nothing (scripts/cws-google-setup.sh).
// Set the Google app's publishing status to "In production" first: in "Testing", Google expires
// the refresh token after 7 days.
// Usage: node scripts/cws-token.mjs <client_id> <client_secret>
// Opens a Google sign-in URL; after you approve, prints the refresh token to paste into GitHub secrets.
import http from "node:http";

const [, , cid, secret] = process.argv;
if (!cid || !secret) { console.error("usage: cws-token.mjs <client_id> <client_secret>"); process.exit(2); }

const port = 53682;
const redirect = `http://localhost:${port}/`;
const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: cid, redirect_uri: redirect, response_type: "code", access_type: "offline", prompt: "consent",
  scope: "https://www.googleapis.com/auth/chromewebstore",
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get("code");
  if (!code) { res.end("No code in request."); return; }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: cid, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const j = await r.json();
  if (j.refresh_token) {
    res.end("Done — go back to the terminal.");
    console.log("\nCWS_REFRESH_TOKEN=" + j.refresh_token + "\n\nGitHub → Settings → Secrets and variables → Actions: add it and CWS_CLIENT_ID, CWS_CLIENT_SECRET as secrets, and CWS_PUBLISHER_ID (Developer Dashboard → Publisher → Settings) as a variable.");
  } else {
    res.end("Token exchange failed; see terminal.");
    console.error(j);
  }
  server.close();
});
server.listen(port, () => {
  console.log("1. Open this URL in a browser signed in as the Chrome Web Store developer account:\n\n" + authUrl + "\n\n2. Approve. The browser redirects to localhost and the refresh token prints here.");
});
