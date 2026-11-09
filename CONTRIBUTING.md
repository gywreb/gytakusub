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
3. **The tests pass** (`test`: unit tests and the real-browser tests; see `docs/TESTING.md`).

`main` is protected: changes reach it only through a pull request with these checks green, and it can't be force-pushed or deleted.

## Releasing (maintainer)

On an up-to-date `main`: `node scripts/release.mjs`. It tests and tags the version main is at, and CI builds the GitHub Release. See `store/RELEASE-CHECKLIST.md` for the Chrome Web Store.
