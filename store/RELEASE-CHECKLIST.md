# Release checklist — Gytakusub (Chrome Web Store)

Everything below is a one-time account step or a copy-paste from `store/LISTING.md`. Budget: US$5 one-time developer fee; nothing else.

## 0. Before you start (5 min)
- [ ] Load `extension/` unpacked in Brave one more time, open Options → Test key, and translate one page end to end. (CI runs the real extension in headless Chromium, but against a mock API; a real key on a real site is the one check only you can do.)
- [ ] `git pull` and take the zip from the GitHub Release of the tag you tested (`gytakusub-extension-X.Y.Z.zip`; CI builds it only after the full test suite passes on that tag, and it is `extension/` minus `icon512.png`).

## 1. Developer account (10 min, $5)
- [ ] Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account you want to own the listing (a dedicated account is fine).
- [ ] Pay the one-time US$5 registration fee and accept the developer agreement.
- [ ] Account tab → fill **publisher display name** (e.g. "gywreb") and a **contact email**, then **verify the email** (required before publishing).
- [ ] Optional: verify the GitHub Pages domain under *Account → Verified websites* if you want "by gywreb.github.io" on the listing. Not required.

## 2. Create the item (2 min)
- [ ] Dashboard → **New item** → upload the `gytakusub-extension-X.Y.Z.zip` attached to the GitHub Release.
- [ ] If the upload reports a manifest problem, stop and paste the message to me.

## 3. Store listing tab (10 min)
- [ ] Paste **Name**, **Summary**, **Description** from `LISTING.md`.
- [ ] Category: Productivity. Language: English.
- [ ] Upload icon `extension/icons/icon128.png`.
- [ ] Upload the five screenshots from `store/assets/` (1280×800, numbered in order) and the small promo tile (440×280).
- [ ] Homepage URL: `https://github.com/gywreb/gytakusub`. Support URL: `https://github.com/gywreb/gytakusub/issues`.

## 4. Privacy practices tab (10 min) — this is where most rejections happen
- [ ] Paste the **single purpose** text.
- [ ] Paste each **permission justification** (storage, activeTab, scripting, optional host permission).
- [ ] Remote code: **No** (paste the remote-code row from `LISTING.md` if the form asks why WebAssembly and the ONNX models are present).
- [ ] Data usage: tick **Authentication information** and **Website content** only; tick all three certifications.
- [ ] Privacy policy URL: `https://gywreb.github.io/gytakusub/privacy.html` (confirm the page loads first — Pages must be enabled, see repo README).

## 5. Distribution tab (1 min)
- [ ] Visibility: **Public** from 2.7.0 (it was Unlisted before; see "Going public"). Free. All regions.

## 6. Submit (1 min, then wait)
- [ ] **Submit for review**. Leave "publish automatically after review" ON.
- [ ] Typical review for a new item with broad host permissions: a few days; up to ~2 weeks is not unusual. You'll get an email either way.

## 7. If it is rejected
Paste the rejection email to me verbatim. The two likely reasons and what we'd do:
- *"Broad host permissions not justified"* → since 2.7.0 site access is already optional and asked at first use. Next step would be asking per site (the image servers differ per site, so each new site would need its own prompt, sometimes two).
- *"Description doesn't match functionality / misleading"* → adjust the wording they quote; no code change.

## 8. After approval
- [ ] Install from the store link in Brave on the Windows machine and the MacBook; remove the unpacked copy.
- [ ] Try Orion on the iPhone with the store link (free; beta extension support) and tell me what breaks, if anything.
- [ ] Enable auto-translate only on the sites you actually read, via the popup.
- [ ] Going public: see the next section.

## Going public (2.7.0 onwards)
What 2.7.0 adds for strangers: a setup page that shows what is sent and asks for agreement before anything is sent (Chrome Web Store user-data policy: disclosure and consent inside the extension, not only in the privacy policy), site access asked at first use, Help (GitHub Issues), "not affiliated with Anthropic", safer image downloads.
- [ ] **Account → Trader status.** Every publisher must declare Trader or Non-Trader (EU Digital Services Act). It's your own call; Google won't decide it for you. A free hobby project with no business behind it is usually Non-Trader. If you choose Trader, your legal name, address and phone number are shown publicly on the listing.
- [ ] **Store listing**: paste the new Description, the Homepage URL and the Support URL from `LISTING.md`.
- [ ] **Test instructions** tab: a separate, spend-limited review key and the steps (`LISTING.md` → Test instructions). Revoke the key after the review.
- [ ] **Privacy practices**: replace the host-permission justification with the *optional host permission* row; re-check the Website content wording.
- [ ] **Distribution → Visibility: Public.** Free, all regions. Then Submit for review. (If 2.7.0 is already live as Unlisted, change the visibility and submit; the dashboard says whether it goes through review again. The policies are the same for every visibility.)
- [ ] Before you go to bed on release day: install from the public listing in a fresh browser profile and walk through the setup page (agree → key → Allow access → translate one page). That's the path every new user takes.
- [ ] **Watch** the repo (Watch → Custom → Issues) so new issues reach your email. Reply within a few days; if one is a real bug, label it `bug`.
- [ ] **A bad release**: Build → Package → *Roll back to previous version* (no review, live within minutes; it re-publishes the previous package under a new version number you give it). Note: rolling back from 2.7.x to 2.6.x would bring back install-time site access, which people who installed 2.7 never granted, so the browser may disable the extension for them until they approve it. Prefer a fixed 2.7.x unless the bug is serious.
- [ ] **A policy email from Google** (warning or takedown): paste it to me verbatim before changing anything; most need a listing or wording change, and you usually get a deadline.

## Uploading a new version by hand (item already exists)
1. If a version is still in review: the item → ⋮ → **Cancel review** (it returns to draft).
2. **Package** → *Upload new package* → the zip from the GitHub Release.
3. Store listing: replace the **Description** (and paste the *What's new* text) from `LISTING.md` if behaviour changed.
4. Privacy practices: re-check the answers against `LISTING.md`.
5. **Save draft** → **Submit for review**.

## Updating later
Versions come with pull requests (each one raises `extension/manifest.json` and adds its `CHANGELOG.md` section). To release what is on main, run `node scripts/release.mjs` from the repo folder (any OS). It checks that GitHub's tests passed for that commit (wait for them after a merge, about 25 minutes), then tags the version main is at. CI tests again, zips, creates the GitHub Release and — once the setup below is done — uploads to the store and submits for review. Listing text only needs changing when behaviour changes.

## Automating updates (one-time, ~15 min) — after the first version is approved

Later versions are then one command from the repo folder (Windows PowerShell, macOS or Linux): `node scripts/release.mjs`. CI tests, zips, creates the GitHub Release, uploads to the store and submits for review. The API doesn't touch the listing: when the listing text or `store/assets/` change, update them in the dashboard (**Store listing** tab) yourself.

The upload uses the Chrome Web Store API V2 (Google planned to support the old v1.1 API only until 15 October 2026), and signs in **without any stored key**: GitHub vouches for the release run, and Google swaps that for a 15-minute token of a service account (Workload Identity Federation, which `google-github-actions/auth` recommends over keys). Only this repo's release workflow, run from `main` or a version tag, is let in.

1. **Google Cloud project**: https://console.cloud.google.com → New project (e.g. `gytakusub-release`). Note its **project ID**.
2. **Run the setup** in Google Cloud Shell (https://shell.cloud.google.com, the same Google account):
   ```
   bash <(curl -fsSL https://raw.githubusercontent.com/gywreb/gytakusub/main/scripts/cws-google-setup.sh) YOUR_PROJECT_ID
   ```
   It turns on the APIs, creates the service account `gytakusub-release@…` and the GitHub sign-in, and prints what to paste next. If Google asks for a billing account, stop and use the fallback below.
3. **Developer Dashboard → Account**: add the service account's email it printed. (One service account per publisher.)
4. **Publisher ID**: Developer Dashboard → **Publisher → Settings**.
5. **GitHub variables** (not secrets; none of these is secret): repo → Settings → Secrets and variables → Actions → **Variables** tab → New repository variable, three times: `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT` (both printed by the setup), `CWS_PUBLISHER_ID`.
6. Done. The next `node scripts/release.mjs` uploads and submits by itself. The item keeps the visibility set in the dashboard (Unlisted).

**Fallback: a refresh token** (a long-lived secret in GitHub, so the way above is better):
1. In the Cloud project: APIs & Services → Library → **Chrome Web Store API** → Enable.
2. **Google Auth Platform → Audience** (older console: OAuth consent screen): External, add yourself as a test user, then **Publish app** so the status is **In production**. In "Testing", Google expires the refresh token after 7 days ([Google: publishing status](https://support.google.com/cloud/answer/15549945)). Google will show "this app isn't verified" when you sign in: that is expected for an app only you use.
3. **Clients** (older console: Credentials → Create credentials → OAuth client ID) → **Desktop app**. Copy the client ID and secret.
4. `node scripts/cws-token.mjs <CLIENT_ID> <CLIENT_SECRET>` → open the URL, sign in with the store-owner account → it prints `CWS_REFRESH_TOKEN=…`.
5. GitHub **secrets** `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and the **variable** `CWS_PUBLISHER_ID`.

Note: the Web Store API can only *update* an item that already exists and was published once through the dashboard, which is why this comes after approval.

If a run fails at the upload step, the message from Google is printed verbatim in the Actions log; paste it to me.
