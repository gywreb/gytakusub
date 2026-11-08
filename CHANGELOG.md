# Changelog

All notable changes to Gytakusub are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-11-08

A rebuilt page engine. 1.0 found bubbles, erased lettering and fitted text with hand-written heuristics that were tuned one reported page at a time; each fix risked the last one. 1.1 replaces that layer with [OpenCV](https://opencv.org/) (WebAssembly, bundled, runs locally) and a test corpus the engine must pass before anything ships. See `docs/adr/0001-dependencies.md` for the reasoning.

### Added
- **OpenCV-based page analysis.** Lettering is found first (glyph components → text blocks, judged by stroke width and glyph height consistency), then the flat light or dark shapes that contain only lettering become bubbles. Japanese vertical text, dark bubbles with white lettering, captions and free narration on screentone are all handled; eyes, sound effects and panel backgrounds are rejected on principle rather than by size alone.
- **Inpainting instead of painting.** Original lettering is removed with Telea inpainting inside the bubble (outlines untouched) and in a small region for free text, so the bubble's own surface and simple art behind loose text are reconstructed.
- **Hover to peek.** Rest the pointer on a translated bubble for a moment to see the original lettering; move away to get the translation back. Options → "Peek at the original" turns it off.
- **Edit a line.** Double-click a translated bubble to correct the text; the correction stays for that page until you Redo. The same dialog can teach the glossary ("original term = translation") for later pages.
- **Bundled lettering font** (Comic Neue Bold, SIL Open Font License) so pages look the same on every machine; Options → "Font family" still overrides it.
- **Hyphenation** at syllable boundaries using Franklin Liang's algorithm (the `hyphen` package, vendored), tried only when an un-hyphenated layout does not fit.
- **Debug overlay** (Options) drawing detected regions and text areas, plus **Export debug report** in the popup: one `.zip` with the original image, the debug render and the JSON for every translated page on the tab (the hover bar's **Report** does one page). `tests/replay-report.mjs` replays such a zip through the engine offline.
- **Real-browser tests.** The actual extension and the web app run in headless Chromium against a mock Claude API on every push; detection, layout and erase are asserted against ground truth on thirteen synthetic pages (Spanish, Italian, Japanese).

### Changed
- A numbered stamp (tag) returned by the model is authoritative for where a line goes. 1.0 only trusted a tag if the model's pixel box also fell inside the bubble, so a drifted box silently moved the text into the wrong panel until a Redo got luckier.
- The service worker now returns a cleaned page plus text placements; the content script only draws text. Content scripts no longer carry the engine (a few KB instead of hundreds).
- Text fitting tries every size without hyphens first and hyphenates only when nothing else fits, instead of hyphenating eagerly at line ends.
- Minimum Chrome version stays 116; the extension's CSP now allows `wasm-unsafe-eval` (WebAssembly; no remote code, no `eval`).

### Fixed
- Translations displaced from, or oversized for, a correctly detected bubble on the first render (the tag/box issue above).
- Text spilling into a neighbouring bubble; inconsistent sizes across a page; erased line art on banner pages; partially erased lettering when the model's box was too small (all made moot by the new engine, and covered by the corpus tests).

### Known limitations
- Telea inpainting smooths periodic screentone behind free narration (the dots blur where the letters were). Bubbles are unaffected.
- Detailed artwork can occasionally be stamped as a text region; the model is told to return nothing for such stamps, so the only cost is the stamp.
- Package size grew by ~6 MB (the OpenCV WebAssembly), compiled once by the browser and cached.

## [1.0.0] — 2026-11-08

First release: Brave/Chrome extension and web app. Local bubble detection with set-of-mark prompting, in-place typesetting, per-site enable and auto-translate, chapter context, bring-your-own Claude API key.
