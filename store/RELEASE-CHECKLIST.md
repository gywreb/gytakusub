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
- [ ] Dashboard → **New item** → upload `dist/gytakusub-extension-2.0.0.zip`.
- [ ] If the upload reports a manifest problem, stop and paste the message to me.

## 3. Store listing tab (10 min)
- [ ] Paste **Name**, **Summary**, **Description** from `LISTING.md`.
- [ ] Category: Productivity. Language: English.
- [ ] Upload icon `extension/icons/icon128.png`.
- [ ] Upload the three screenshots from `store/assets/` (1280×800) and the small promo tile (440×280).
- [ ] Homepage URL: `https://github.com/gywreb/gytakusub`. Support URL: `https://github.com/gywreb/gytakusub/issues`.

## 4. Privacy practices tab (10 min) — this is where most rejections happen
- [ ] Paste the **single purpose** text.
- [ ] Paste each **permission justification** (storage, activeTab, scripting, host permission).
- [ ] Remote code: **No** (paste the remote-code row from `LISTING.md` if the form asks why WebAssembly and the ONNX models are present).
- [ ] Data usage: tick **Authentication information** and **Website content** only; tick all three certifications.
- [ ] Privacy policy URL: `https://gywreb.github.io/gytakusub/privacy.html` (confirm the page loads first — Pages must be enabled, see repo README).

## 5. Distribution tab (1 min)
- [ ] Visibility **Unlisted**. Free. All regions.

## 6. Submit (1 min, then wait)
- [ ] **Submit for review**. Leave "publish automatically after review" ON.
- [ ] Typical review for a new item with broad host permissions: a few days; up to ~2 weeks is not unusual. You'll get an email either way.

## 7. If it is rejected
Paste the rejection email to me verbatim. The two likely reasons and what we'd do:
- *"Broad host permissions not justified"* → we switch to `optional_host_permissions` and request access per site when the user enables it (I kept the code structure ready for this; it costs one extra permission prompt per site).
- *"Description doesn't match functionality / misleading"* → adjust the wording they quote; no code change.

## 8. After approval
- [ ] Install from the store link in Brave on the Windows machine and the MacBook; remove the unpacked copy.
- [ ] Try Orion on the iPhone with the store link (free; beta extension support) and tell me what breaks, if anything.
- [ ] Enable auto-translate only on the sites you actually read, via the popup.
- [ ] After a week with no issues: Distribution → **Public**, if you want it discoverable.

## Uploading a new version by hand (item already exists)
1. If a version is still in review: the item → ⋮ → **Cancel review** (it returns to draft).
2. **Package** → *Upload new package* → the zip from the GitHub Release.
3. Store listing: replace the **Description** (and paste the *What's new* text) from `LISTING.md` if behaviour changed.
4. Privacy practices: re-check the answers against `LISTING.md`.
5. **Save draft** → **Submit for review**.

## Updating later
Run `node scripts/release.mjs 2.0.1` from the repo folder (any OS). CI tests, zips, creates the GitHub Release and — once the secrets below exist — uploads to the store and submits for review. Listing text only needs changing when behaviour changes.

## Automating updates (one-time, ~15 min) — after the first version is approved

Later versions are then one command from the repo folder — Windows PowerShell, macOS or Linux: `node scripts/release.mjs 2.0.1` (`./scripts/release.sh` is the same thing for Unix shells) → CI tests, zips, creates the GitHub Release, uploads to the store and submits for review. Listing text and screenshots stay as they are.

1. **Google Cloud project**: https://console.cloud.google.com → New project (e.g. `gytakusub-ci`).
2. **Enable the API**: APIs & Services → Library → search **Chrome Web Store API** → Enable.
3. **OAuth consent screen**: APIs & Services → OAuth consent screen → External → app name `Gytakusub CI`, your email → Save. Under *Test users* add your own Google account (the one that owns the Web Store listing). Leave it in "Testing" — that's fine for a single-user tool.
4. **OAuth client**: Credentials → Create credentials → OAuth client ID → Application type **Desktop app** → Create. Copy the **Client ID** and **Client secret**.
5. **Refresh token**: on your MacBook, in the repo:
   `node scripts/cws-token.mjs <CLIENT_ID> <CLIENT_SECRET>` → open the printed URL, sign in with the store-owner account, approve → the terminal prints `CWS_REFRESH_TOKEN=...`.
6. **GitHub secrets**: repo → Settings → Secrets and variables → Actions → New repository secret, four times:
   `CWS_EXTENSION_ID` = `anmnhodgeaojlhlinobnaakmgkdaoekk` (from the dashboard URL), `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`.
7. Done. Note: the Web Store API can only *update* an item that already exists and was published once through the dashboard — which is why this comes after approval.

If a run fails at the upload step, the message from Google is printed verbatim in the Actions log; paste it to me.
