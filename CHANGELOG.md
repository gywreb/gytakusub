# Changelog

All notable changes to Gytakusub are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [1.1.1] — unreleased (branch `feature/learned-layout`)

Bubbles from a learned model, and a faster runtime. See `docs/adr/0004-learned-bubble-segmentation.md`.

### Added
- **Learned bubble segmentation.** A YOLOv8-seg speech-bubble model (from `kitsumed/yolov8m_seg-speech-bubble`, quantized to int8, 43 MB) returns bubble masks; the engine uses them as bubble interiors and assigns the detected lettering to them. The light-region rules remain for lettering the model leaves outside any mask (it misses some heavily toned bubbles), and a model bubble with no lettering inside is ignored (never stamped, never erased). Measured on 270 pages from the user's exports, model answers as witness: dialogue recognised as a bubble **92.4% → 98.8%** (by text 95.0 → 99.4%), coverage 93.5 → 95.4%; lines left outside any bubble 190 → 119; translations rendered under 0.7× the original 9.6% → 8.8%; overlap with un-erased lettering 70 → 52. Cost: about 1.9 s more per page on the CPU wasm backend (512 px input) — overall about the same as 1.1.0, whose text detector was slower.
- **ONNX Runtime Web** (Microsoft, MIT) runs both models. The text detector moved to it from OpenCV's dnn: 2.1 s → 0.7 s per page on the CPU, same lines found; dnn stays as the fallback.
- **GPU (WebGPU).** Both models run on the graphics card when the browser offers WebGPU (Chrome/Brave/Edge 124+ in the extension's service worker; Safari 26 for the web app), and on the CPU otherwise or if the GPU fails to start. The bubble model ships in two variants chosen at load time: weight-only int8 for the GPU (no int8 activations, which ORT's WebGPU backend would send back to the CPU node by node) and int8 QDQ for the CPU. Verified in CI on a software GPU: same lines and bubbles as the CPU path on every fixture page. Options → "Use the graphics card" turns it off. Debug reports show where the models ran (`timing.backend`).

### Changed
- **Licence: GNU AGPL v3** (was MIT up to 1.1.0). The bubble model is GPL-3.0 per its card and AGPL-3.0 under Ultralytics' terms; publishing the whole extension under the AGPL keeps the store build compliant. The licence text and `THIRD_PARTY.md` ship inside the package, and Options links to the source.

### Known limitations
- Package size: +100 MB unpacked (runtime 29 MB, bubble model 43 MB CPU + 28 MB GPU variant).
- GPU speed is not measured yet: the build environment and CI have only a software GPU. The first real numbers come from the owner's debug reports (`timing.detect`, `timing.segment`, `timing.backend`).

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
- **Anchored layout.** Each translation takes the largest rectangle of its bubble around the lettering it replaces — never another speaker's line, a smaller region inside the shape, or the far side of a joined bubble's waist — and stays centred on that lettering. Previously a shared bubble was cut into horizontal lobes and a single translation took the roomiest rectangle anywhere in the shape, so text drifted away from where the original was and, when a light background passed as a bubble, landed over other bubbles. One invariant holds whatever the shape analysis does: a translation never gets less room than the lettering it replaces (that area is erased and inside the bubble by definition), so text cannot come out smaller than the original for lack of space. Measured on 230 real pages from the user's exports: translations rendered below 0.7× the original letter size 15.3% → 9.5%, words broken letter by letter 68 → 37, lines over their own lettering 86% → 96% (`docs/adr/0003-anchored-layout.md`).
- **Toned bubbles.** A bubble shaded with screentone or a gradient used to offer only its flat light fragment as text area, so the translation came out tiny. The usable interior is now what the outline encloses (grown from the light region over tone dots, mid-greys and lettering, bounded by structural ink); hairline gaps are sealed, open tail tips are cut off, and a leak through a wide opening keeps the old interior. Dark bubbles are unchanged.
- Text fitting keeps words whole and lets a line run slightly past its box before it ever breaks a word letter by letter; the smallest size it will go to is 35% of the original (was 45%).
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
