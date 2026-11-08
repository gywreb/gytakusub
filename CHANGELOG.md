# Changelog

All notable changes to Gytakusub are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-11-08

A rebuilt page engine. 1.0 found bubbles, erased lettering and fitted text with hand-written heuristics that were tuned one reported page at a time; each fix risked the last one. 1.1 replaces that layer with [OpenCV](https://opencv.org/) (WebAssembly, bundled, runs locally) and a test corpus the engine must pass before anything ships. See `docs/adr/0001-dependencies.md` for the reasoning.

### Added
- **Learned text detection.** Text lines are found by PaddleOCR's PP-OCRv4 detector (Apache-2.0, 4.7 MB), run locally by OpenCV's dnn module from the bundled WebAssembly — no server, no extra runtime. OpenCV geometry then snaps each box to the ink, merges lines into paragraphs, and accepts the flat light or dark shape around a paragraph as a bubble when its only content is the lettering. Measured on 172 real pages from the user's exports: false regions 5.7 → 0.9 per page, same bubble recognition, coverage 93 → 94%. See `docs/adr/0002-learned-text-detection.md`. The rule-based analyser remains as a fallback.
- **Inpainting instead of painting.** Original lettering is removed with Telea inpainting inside the bubble (outlines untouched) and in a small region for free text, so the bubble's own surface and simple art behind loose text are reconstructed.
- **Hover to peek** (off by default). With Options → "Peek at the original" on, resting the pointer on a translated bubble for a moment shows the original lettering; moving away brings the translation back.
- **Edit a line.** Double-click a translated bubble to correct the text; the correction stays for that page until you Redo. The same dialog can teach the glossary ("original term = translation") for later pages.
- **Bundled lettering font** (Comic Neue Bold, SIL Open Font License) so pages look the same on every machine; Options → "Font family" still overrides it.
- **Hyphenation** at syllable boundaries using Franklin Liang's algorithm (the `hyphen` package, vendored), tried only when an un-hyphenated layout does not fit.
- **Debug overlay** (Options) drawing detected regions and text areas, plus **Export debug report** in the popup: one `.zip` with the original image, the debug render and the JSON for every translated page on the tab (the hover bar's **Report** does one page). `tests/replay-report.mjs` replays such a zip through the engine offline.
- **Real-browser tests.** The actual extension and the web app run in headless Chromium against a mock Claude API on every push; detection, layout and erase are asserted against ground truth on thirteen synthetic pages (Spanish, Italian, Japanese).

### Changed
- A numbered stamp (tag) returned by the model is authoritative for where a line goes. 1.0 only trusted a tag if the model's pixel box also fell inside the bubble, so a drifted box silently moved the text into the wrong panel until a Redo got luckier. The one exception: when the model's box sits squarely inside a *different* detected shape, the number was misread (a corner stamp can land beside a neighbour's text) and the box decides — measured as 9 of 437 tagged lines in the user's exports, all of them wrong tags.
- **Anchored layout.** Each translation takes the largest rectangle of its bubble around the lettering it replaces — never another speaker's line, a smaller region inside the shape, or the far side of a joined bubble's waist — and stays centred on that lettering. Previously a shared bubble was cut into horizontal lobes and a single translation took the roomiest rectangle anywhere in the shape, so text drifted away from where the original was and, when a light background passed as a bubble, landed over other bubbles. Measured over 185 real pages (`tests/layout-score.mjs`): translations over their own lettering 86% → 93%, at least as large as that lettering 74% → 84%, shared bubbles with every line over its own 69% → 81%, translations covering lettering that was not erased 71 → 54, areas narrower than three letters 160 → 124.
- **Toned bubbles.** A bubble shaded with screentone or a gradient used to offer only its flat light fragment as text area, so the translation came out tiny. The usable interior is now what the outline encloses (grown from the light region over tone dots, mid-greys and lettering, bounded by structural ink), with leak guards that keep the old interior when an outline is broken. Dark bubbles are unchanged.
- Erasing reaches most of a letter beyond each detected line along its direction, catching the last glyph the detector sometimes stops short of.
- An image the site refuses to serve to the extension (hotlink protection, "Could not fetch image (403)") is fetched again by the page itself when it may (same-origin or CORS); an image that still fails is not retried on every scroll, and the same error is not toasted again within a minute. Failed images are listed in the debug report (`summary.failed`).
- The service worker now returns a cleaned page plus text placements; the content script only draws text. Content scripts no longer carry the engine (a few KB instead of hundreds).
- Text fitting tries every size without hyphens first and hyphenates only when nothing else fits, instead of hyphenating eagerly at line ends.
- Minimum Chrome version stays 116; the extension's CSP now allows `wasm-unsafe-eval` (WebAssembly; no remote code, no `eval`).

### Fixed
- Translations displaced from, or oversized for, a correctly detected bubble on the first render (the tag/box issue above).
- Text spilling into a neighbouring bubble; inconsistent sizes across a page; erased line art on banner pages; partially erased lettering when the model's box was too small (all made moot by the new engine, and covered by the corpus tests).

### Validated on real pages
The detector was reworked against the first real exports (850 px JPEG pages with 8 px Latin capitals; Japanese pages): line grouping from glyph components only, width-aware letter counts, evidence rules for lettering (alignment, letters per row, height clustering, density). Scored with the model's own answer as witness (`tests/score-reports.mjs`), tuned on one export and validated on two untouched ones: dialogue recognised as a bubble rose from 49% to 83% (hold-outs 64→88%, 49→84%) with coverage and false regions unchanged. The eraser now ships only the inpainted patches (≈10% of the bytes of a full page), and every result carries per-stage timings.

### Known limitations
- Telea inpainting smooths periodic screentone behind free narration (the dots blur where the letters were). Bubbles are unaffected.
- Detailed artwork (armour, faces, foliage) is still stamped as a text region a few times per page; the model is told to return nothing for such stamps, so the cost is tokens, not wrong text. Dialogue in bubbles the detector misses (~15% on the pages seen so far) is placed by the model's box with a halo instead of inside the bubble.
- Package size grew by ~11 MB (OpenCV WebAssembly 6 MB, text detector 4.7 MB), compiled/parsed once per worker start and cached by the browser.
- Analysis takes ~2 s per page in the browser (the detector), before the model call; pages translated while scrolling fast queue behind each other. A faster runtime (WebGPU) is the planned 1.2 improvement.

## [1.0.0] — 2026-11-08

First release: Brave/Chrome extension and web app. Local bubble detection with set-of-mark prompting, in-place typesetting, per-site enable and auto-translate, chapter context, bring-your-own Claude API key.
