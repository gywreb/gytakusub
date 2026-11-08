# Testing a release branch, verifying it, and merging

Written for the Windows + Brave setup. Everything in `code` is typed into **PowerShell** opened in the repo folder (right-click the folder → *Open in Terminal*), unless it says Brave.

## A. Get the branch onto your machine (2 min)

```powershell
git fetch origin
git checkout release/1.1
git pull
```

Then in Brave: `brave://extensions` → find **Gytakusub** → click the **↻ reload** icon. If the card shows an error, click it and paste the text to me. (The extension folder is the same `extension/` you loaded unpacked before; reloading picks up the new files.)

The first translation after a reload takes about a second longer: the browser compiles the OpenCV WebAssembly once and caches it.

## B. Smoke test in the extension (10–15 min)

Work through this list on a chapter you know. Tick what passes; for anything that fails, note the page and take a screenshot.

1. **Key still works.** Toolbar icon → Options → *Test key* shows OK.
2. **One page.** Hover a page → *Translate*. Lettering is erased (bubble surface reconstructed, outline intact) and English sits inside each bubble.
3. **Auto-translate while scrolling** on a site you enabled it for. Pages translate as they come into view; the *first* render of each page is already right (this was the 1.0 bug — Redo is no longer needed to fix placement).
4. **Japanese chapter** (vertical text). Bubbles are found; English is stacked in short lines inside tall bubbles; sound effects drawn as art are left alone.
5. **Peek.** Rest the pointer on a translated bubble for half a second → the original lettering appears; move off → translation returns.
6. **Edit.** Double-click a translated bubble → change the text → **Ctrl+Enter**. The bubble updates. Scroll away and back: it stays. *Redo* on that page replaces it with a fresh translation.
7. **Glossary.** In the same dialog, fill "original term = translation" → *Add*. Options → Glossary shows the new line.
8. **Hide / Show** (hover bar or **Alt+Shift+T**) and **Alt+T** (translate everything on screen) still work.
9. **Dark bubbles** (white lettering on black), if the chapter has them.
10. **A banner / credits page** with big lettering: no art is wiped.

### If something looks wrong

Options → tick **Debug overlay** → *Save* → hover the page → *Redo*. Red boxes = bubbles found, blue = loose text found, green = where text went. Send me:
- the screenshot with the boxes,
- **F12** → *Console* → right-click the `Gytakusub debug` line → *Copy object* → paste,
- and the original page image (right-click it → *Save image as*) if you can.

Untick Debug overlay afterwards.

## C. Web app (phone path) — optional before merge

The web app is deployed from `main` by GitHub Pages, so the simplest check is **after** the merge: open `https://gywreb.github.io/gytakusub/` on the iPhone (or Brave), paste a screenshot of a page, confirm it translates. The automated browser test already runs the web app end to end on every push, so this is a sanity check, not the only safety net.

To try it before merging, in PowerShell:

```powershell
node scripts/sync-shared.mjs
npx --yes http-server web -p 8080 -c-1
```

then open `http://localhost:8080` in Brave, ⚙ → paste the API key → *Save*, and *Paste image* a page screenshot. **Ctrl+C** stops the server.

## D. Verify the automated checks (1 min)

Open https://github.com/gywreb/gytakusub/actions?query=branch%3Arelease%2F1.1 — the latest **Tests** run must be green. It covers:
- syntax of every script, and that the vendored OpenCV/hyphen files match what the vendoring scripts produce;
- 72 engine assertions on nine synthetic pages (detection against ground truth, placement inside bubbles, lettering erased, outlines kept);
- the real extension in headless Chromium against a mock Claude API: first render = Redo = cached render, every tagged line inside its bubble, the drifted-box scenario, peek, edit, persistence;
- the web app in headless Chromium.

Click a run → *Artifacts* → `browser-renders` to see the screenshots those tests produced.

## E. Merge and release (10 min)

1. Open the pull request **release/1.1 → main** (I open it; the link is in the chat). Read the description — it is the changelog.
2. If everything in B passed: **Merge pull request** → *Create a merge commit* → **Confirm merge**. (If anything failed, tell me instead; nothing merges until it's fixed.)
3. Tag the release so CI builds the store package and the GitHub Release:
   ```powershell
   git checkout main
   git pull
   git tag v1.1.0
   git push origin v1.1.0
   ```
   Actions → **Release** builds `gytakusub-extension-1.1.0.zip` and attaches it to https://github.com/gywreb/gytakusub/releases.
4. Chrome Web Store: https://chrome.google.com/webstore/devconsole → the Gytakusub item → **Package** → *Upload new package* → the zip from the release → **Submit for review**. Store listing text for "What's new" is in `store/LISTING.md`. (Once the CWS secrets are configured in the repo, step 4 happens automatically on the tag.)
5. GitHub Pages redeploys the web app from `main` on its own (Actions → *Deploy web app*).

## F. If a problem shows up after merging

Tell me which page/site. The fix goes into a branch with a failing test first, then the fix, then the same steps as above. If the problem is serious, `main` can be reverted from the PR page (*Revert*) and the previous zip re-uploaded to the store.
