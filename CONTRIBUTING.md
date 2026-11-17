# Contributing to Gytakusub

Thanks for helping. Gytakusub is maintained by one person ([@gywreb](https://github.com/gywreb)), who reviews and merges every change. Fork the repository, work on a branch, and open a pull request against `main`. The template asks for everything below.

## Pull request rules

CI checks these on every pull request, and a pull request that fails one is not merged.

1. **It carries a version.**
   - Raise `"version"` in `extension/manifest.json` above main's: patch for a fix, minor for a feature, major for a breaking change.
   - Add a dated `## [X.Y.Z] — YYYY-MM-DD` section to `CHANGELOG.md`, and leave nothing under *Unreleased*.
   - If another pull request takes that version first, take the next one.
   - Check: `node scripts/check-version.mjs origin/main`.
   - The fetcher's own `VERSION` (`fetcher/worker.js`) is separate. Raise it only when the web app needs a newer fetcher, because every user then has to update theirs.
2. **A UI change shows screenshots.** If it changes what people see, put screenshots in the description. That covers:
   - the web app's pages, styles or `app.js`;
   - the extension's popup, Options page or in-page overlay;
   - icons or fonts.

   Show before and after; phone and desktop, dark and light where the change shows there. The list of files that count is in `scripts/check-screenshots.mjs`.
3. **The tests pass.** The `test` check covers the unit tests and the real-browser tests (see `docs/TESTING.md`). A pull request runs the suites its changes need. Documentation alone runs none; a web app or fetcher change runs the web suite; anything else runs both. `main` and releases always run everything.

`main` is protected: changes reach it only through a pull request with these checks green, and it can't be force-pushed or deleted.

## Development

```sh
cd tests && npm install
npm run demo          # regenerate the synthetic test pages (needs python3 + Pillow + a Noto CJK font; they are committed)
npm test              # chapter fetcher (page extraction per reader theme, key/CORS/address checks, image relay),
                      # engine tests on the synthetic pages (detection vs ground truth, layout, erase, text fitting),
                      # the eraser's fills (screentone, learned, flat), the bubble model, the runtime-trap fallback,
                      # WebGPU (software GPU) and concurrent pages
npm run test:browser  # the real extension (CPU, GPU, drifted model boxes, a stand-in bubble model) + the web app (screenshot and
                      # chapter-link mode through the real fetcher) in headless Chromium against a mock Claude API
npm run viz -- fixtures/gen-03.png out.png --trace   # what the analyser saw, and why it rejected what it rejected
npm run e2e           # full render of the demo page through the engine
npm run vendor        # regenerate OpenCV, ONNX Runtime and hyphen in extension/vendor from the pinned packages (CI verifies)
npm run replay -- report.zip   # reproduce a user's "Export debug report" offline (original + items → render)
npm run score -- *.zip         # detection on real pages from debug reports (coverage, dialogue as bubble, waste)
npm run score:layout -- *.zip  # where and how large translations land on those pages
npm run audit -- report.zip outdir     # the core audit: erased areas with marks left, lines drawn over unerased text
node fill-truth.mjs *.zip --out dir    # the eraser's fill against known backgrounds on real pages (ADR 0013)
```

`npm run test:web` / `test:extension` and `test:browser:web` / `test:browser:extension` run one half. Debug reports hold the pages, so they stay on your machine: put your own pages in `tests/fixtures/real/` (git-ignored) for local tuning, and never commit or post a published page; the synthetic pages are for screenshots.

**Interface text** lives in `extension/_locales/<locale>/messages.json`. A new or changed English message needs the same key in all ten files, with the same `{placeholders}`, markup and links: `node scripts/check-i18n.mjs` says what's missing (CI runs it), and `node tests/browser/i18n.mjs` opens every page in every language and fails on a key, an English leftover, or clipped text.

**In CI** (`.github/workflows/test.yml`), each pull request runs only the suites its changes need (`scripts/ci-changes.mjs`):
- documentation alone runs none;
- changes only to the web app or the fetcher run the web suite (about 4 minutes);
- anything else runs both, including the extension suite (about 18 minutes).

A raised version number alone doesn't count as a change. Every push to `main` and every release tag runs everything. A newer push to the same pull request cancels the older run. One `test` check sums it up.

`GYT_CHANNEL=chrome npm run test:browser` uses an installed Chrome for Testing instead of Playwright's Chromium (branded Google Chrome ≥ 137 ignores `--load-extension`). Testing, verifying and merging a release branch step by step: [`docs/TESTING.md`](docs/TESTING.md). How the code is organised: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Releasing (maintainer)

On an up-to-date `main`: `node scripts/release.mjs` (any OS). It makes sure GitHub's tests passed for that commit, then tags the version main is at and pushes the tag. CI runs the full test suite on the tag, then builds the zip, publishes a GitHub Release and uploads to the Chrome Web Store when the `CWS_*` secrets are configured. A failed release run can be rebuilt for the same tag from Actions → Release → *Run workflow*. Store listing copy, permission justifications and the submission checklist live in `store/` (`store/RELEASE-CHECKLIST.md`).

The web app: `main` deploys `web/` to GitHub Pages through `.github/workflows/pages.yml` (enable *Settings → Pages → Source: GitHub Actions* once).
