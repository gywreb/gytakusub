# ADR 0001 — Where we use libraries and where we don't

Status: accepted (2.0.0). Date: 2026-11-08.

## Context

1.0 shipped with every piece of image logic hand-written: bubble detection by
connected components on a downsampled luminance mask, a flood-fill bubble
finder, a glyph-sized eraser, an inscribed-rectangle fitter, a greedy word
wrapper with ad-hoc hyphenation. It worked on the pages it was tuned on and
regressed on the next ones, because ~15 thresholds interacted and nothing but a
single synthetic page checked them.

The question raised during 1.0.1 planning: why is none of this a well-known
package?

## Decision

Use a library wherever a mature one exists for the *primitive*, and keep the
*policy* (what counts as a bubble, where text goes) as our own small, tested
code on top of those primitives.

| Concern | Decision | Why |
|---|---|---|
| Image primitives (threshold, median blur, connected components with stats, contours, convex hull, distance transform, morphology, inpainting) | **OpenCV.js 4.5.5** (official WebAssembly build, from the `opencv-bindings` npm package), vendored by `scripts/vendor-opencv.mjs` | Decades of correctness work we cannot match; inpainting alone is not something to hand-roll. Runs locally in the service worker / Web Worker, so no privacy or cost change. |
| Hyphenation | **`hyphen`** (Liang's TeX patterns, en-US), vendored by `scripts/vendor-hyphen.mjs` | Syllable breaks are a solved problem; our "words ≥ 8 letters at ratio 0.6" rule was a guess. |
| Real-browser tests | **Playwright** (dev dependency only) | The bugs that hurt were integration bugs (timing, cache, browser APIs) that node-canvas harnesses cannot see. |
| Bubble policy, layout, erase mask construction, text fitting | **Our code** (`extension/engine/*.js`, `extension/text.js`) | These encode what a manga bubble *is*; no package does that for comics, and the logic is small once it sits on real primitives. Every rule is covered by `tests/engine.test.mjs` across the synthetic pages with ground truth (thirteen when this was written; fourteen in 2.0.0). |

### What we considered and did not take

- **A text detector / OCR model (PaddleOCR, Tesseract.js, manga-ocr ports).** Tens of MB, slower than the Claude call itself, and Claude already reads the text; we only need *where* it is. The geometric analysis gives that at ~300 ms per page.
- **A bubble-segmentation network (comic-text-detector, Magi).** Best quality, but 50–100 MB of weights in a browser extension and a GPU story we don't want to own. Revisit if the geometric approach proves insufficient on real pages (the `--trace` tooling will show which rule fails).
- **A full OpenCV.js build with every module.** The official build is 10 MB JS with the WebAssembly inlined as base64. We extract the `.wasm` (6 MB, streamed and cached by the browser) and replace the two Embind code generators with closures so the build runs under MV3's CSP without `unsafe-eval` (`-sDYNAMIC_EXECUTION=0` semantics). Nothing else in the Emscripten output is modified; CI regenerates the vendored files and fails if they differ.
- **Bundlers / TypeScript.** Not yet. The extension is a handful of ES modules loaded directly by Chrome; a build step would add tooling the project does not need at this size.

## Consequences

- Package grows by ~6.3 MB (wasm + loader + hyphenation patterns). First load compiles the wasm once (~0.3–0.8 s), then it is cached.
- CSP gains `wasm-unsafe-eval`. No remote code; the Web Store "remote code: No" answer still holds.
- Vendored files are generated, never edited by hand; `npm run vendor` in `tests/` reproduces them and CI checks the result.
- Regressions now have to pass the corpus and the real-browser tests before they reach a branch the user tests.
