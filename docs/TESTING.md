# Testing a release branch, verifying it, and merging

Written for the Windows + Brave setup. Everything in `code` is typed into **PowerShell** opened in the repo folder (right-click the folder → *Open in Terminal*), unless it says Brave.

## A. Get the branch onto your machine (2 min)

```powershell
git fetch origin
git checkout release/2.0
git pull
```

Then in Brave: `brave://extensions` → find **Gytakusub** → click the **↻ reload** icon. If the card shows an error, click it and paste the text to me. (The extension folder is the same `extension/` you loaded unpacked before; reloading picks up the new files.)

The first translation after a reload takes a few seconds longer: the browser compiles the WebAssembly once and loads the two models (text detector, bubble model) — on the graphics card when it can.

## B. Smoke test in the extension (10–15 min)

Work through this list on a chapter you know. Tick what passes; for anything that fails, note the page and take a screenshot.

1. **Key still works.** Toolbar icon → Options → *Test key* shows OK.
2. **One page.** Hover a page → *Translate*. Lettering is erased (bubble surface reconstructed, outline intact) and English sits inside each bubble.
3. **Auto-translate while scrolling** on a site you enabled it for. Pages translate as they come into view; the *first* render of each page is already right (this was the 1.0 bug — Redo is no longer needed to fix placement).
4. **Japanese raw chapter** (vertical text, with furigana). Every column of the original is erased, furigana included; the English is set at a readable size that fills the bubble (not the size of the furigana); narration printed straight on the art is erased and replaced too; big sound effects drawn as art are left alone.
5. **Peek** (Options → tick *Peek at the original* first; it is off by default). Rest the pointer on a translated bubble for half a second → the original lettering appears; move off → translation returns.
6. **Edit.** Double-click a translated bubble → change the text → **Ctrl+Enter**. The bubble updates. Scroll away and back: it stays. *Redo* on that page replaces it with a fresh translation.
7. **Glossary.** In the same dialog, fill "original term = translation" → *Add*. Options → Glossary shows the new line.
8. **Hide / Show** (hover bar or **Alt+Shift+T**) and **Alt+T** (translate everything on screen) still work.
9. **Dark bubbles** (white lettering on black), if the chapter has them.
10. **A banner / credits page** with big lettering: no art is wiped.
11. **Popup while translating.** With a chapter translating, click the toolbar icon: it opens at once with your settings (master switch, model, site toggles) — not the defaults.
12. **Graphics card.** Export a debug report (below): `timing.backend` in a page's JSON says `detect:webgpu segment:webgpu` when the models ran on the graphics card. Untick Options → *Use the graphics card* once and translate a page: same result, slower.

### If something looks wrong

Options → tick **Debug overlay** → *Save*. Then, with the chapter translated, click the toolbar icon → **Export debug report**. One `.zip` downloads with, for every translated page on that tab, the original image, the debug render (red = bubbles found, blue = loose text, green = where text went) and the report JSON. Attach the zip here — nothing to screenshot or copy. (The hover bar also has a **Report** button that exports just that one page.)

On my side `npm run replay -- report.zip` reproduces every page offline, so the fix comes with a test against your actual page, and `node layout-score.mjs *.zip` (in `tests/`) measures where translations land over every page you have ever exported — a change ships only if those numbers do not go down.

The report's `summary.json` also lists images that failed (`failed`: URL, size, error), so a "Could not fetch image" toast is reproducible without a screenshot.

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

Open https://github.com/gywreb/gytakusub/actions?query=branch%3Arelease%2F2.0 — the latest **Tests** run must be green. It covers:
- syntax of every script, and that the vendored files match what the vendoring scripts produce (OpenCV, ONNX Runtime and hyphen from the pinned npm packages; the text detector from PaddlePaddle's pinned Hugging Face revision);
- 108 engine assertions on fourteen synthetic pages (detection against ground truth, placement inside bubbles, lettering erased, outlines kept; one page of vertical Japanese with furigana);
- the bubble model's output parsing, the fallback when the runtime traps, both models on WebGPU (a software GPU) giving the same lines and bubbles as the CPU, and three pages at once on the GPU;
- the real extension in headless Chromium against a mock Claude API: first render = Redo = cached render, every tagged line inside its bubble, the drifted-box scenario, a stand-in bubble model, the GPU path, peek, edit, persistence, and the popup and Options showing the stored settings while the worker is busy;
- the web app in headless Chromium: a screenshot, and a chapter link opened through the real chapter fetcher (pages relayed, next chapter, a bot-check site explained);
- the chapter fetcher on its own: page extraction on one page of each common reader theme, its key, CORS, address checks and image relay.

A separate weekly workflow, **Guide check**, re-reads the Cloudflare pages the chapter-link setup steps follow (plus the Deploy to Cloudflare link and MangaDex's API) and opens an issue titled "Chapter-link setup guide: review needed" when one changed.

The **Release** workflow (on a `v*` tag) runs this same Tests workflow on the tagged commit before it builds anything.

Click a run → *Artifacts* → `browser-renders` to see the screenshots those tests produced.

## E. Merge and release (10 min)

1. Open the pull request **release/2.0 → main** (I open it; the link is in the chat). Read the description — it is the changelog.
2. If everything in B passed: **Merge pull request** → *Create a merge commit* → **Confirm merge**. (If anything failed, tell me instead; nothing merges until it's fixed.)
3. Tag the release so CI builds the store package and the GitHub Release:
   ```powershell
   git checkout main
   git pull
   git tag v2.0.0
   git push origin v2.0.0
   ```
   Actions → **Release** runs the tests on the tag, builds `gytakusub-extension-2.0.0.zip` and attaches it to https://github.com/gywreb/gytakusub/releases. If that run fails for a reason outside the code (it happened once: the workflow lacked a test dependency), fix the workflow on `main`, then rebuild the same tag from Actions → **Release** → *Run workflow* (tag `v2.0.0`).
4. Chrome Web Store: https://chrome.google.com/webstore/devconsole → the Gytakusub item → **Package** → *Upload new package* → the zip from the release → **Submit for review**. If an earlier version is still in review, cancel that review first (⋮ → *Cancel review*); the item goes back to draft and takes the new package. Store listing text for "What's new" is in `store/LISTING.md`. (Once the CWS secrets are configured in the repo, step 4 happens automatically on the tag.)
5. GitHub Pages redeploys the web app from `main` on its own (Actions → *Deploy web app*).

## F. If a problem shows up after merging

Tell me which page/site. The fix goes into a branch with a failing test first, then the fix, then the same steps as above. If the problem is serious, `main` can be reverted from the PR page (*Revert*) and the previous zip re-uploaded to the store.
