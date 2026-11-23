# How Gytakusub works

| | `extension/` | `web/` |
|---|---|---|
| Where | Brave / Chrome / Edge on desktop | Any browser, installable as a home-screen app on iPhone/Android |
| Input | Images on sites you enable; hover → Translate, `Alt+T`, or per-site auto-translate | Screenshots (paste / Photos), or a chapter link from any site that needs no login, through your own free [chapter fetcher](../fetcher/README.md) |
| Output | Transparent overlay on the page | Translated page images you can save or share |

## One page, start to finish

1. The page is downscaled (≤1600 px; tall webtoon strips are sliced) and **text and bubbles are found locally** by two open-source models (on the graphics card when there is one). Lines are snapped to the ink, merged into paragraphs and assigned to the bubble they sit in. Each region gets a numbered red stamp.
2. Claude (vision) is asked, per piece of text, *which numbered region it is in* (set-of-mark prompting, far more reliable than asking a language model for coordinates), and answers in a fixed JSON schema. The tag decides placement; the model's pixel box only corrects a misread stamp and orders speakers in a joined bubble, and vouches for free text the analysis set aside, which is then erased too ([ADR 0014](adr/0014-free-text-second-witness.md)); where nothing was found under it, the detector looks again at just that box, zoomed in ([ADR 0015](adr/0015-what-claude-reads-is-erased.md)). Lines with nothing to translate ("…", "!"), lines Claude gives back as they are drawn (it gives each line's original too; [ADR 0016](adr/0016-lines-given-back-as-drawn.md)), sound effects and logos are left as drawn. While the answer is on the way, the engine fills the page's textured areas ahead. How well each step works is measured on pages the rules were never tuned on ([QUALITY.md](QUALITY.md), [ADR 0017](adr/0017-measured-on-pages-never-tuned-on.md)).
3. The original lettering is erased and the translation is typeset into the largest rectangle inside the bubble, sized from the original lettering. Free text over artwork is erased in place and drawn with a halo.
   - The eraser's mask is the lettering and its outline (a white stroke round black letters), never the bubble's own outline. On a plain surround, lettering of any colour is what stands out from it.
   - Each area is filled with the simplest model that explains its surface: its own colour when it is flat (most white bubbles); the screentone continued in phase when the surface is a lattice of dots or lines and that lattice predicts the surround; a manga-trained inpainting model (AOT-GAN) otherwise. See [ADR 0013](adr/0013-learned-eraser.md).
   - When the page was downscaled, the erased areas are redone at the page's own resolution.
4. The overlay is drawn at the screen's own pixels and redrawn when the window or zoom changes. A line too small to read shows at a readable size while the pointer rests on it ([ADR 0012](adr/0012-screen-pixels.md)).
5. Names and the last ~40 translated lines are carried across pages for consistent translation. Double-click a bubble to edit the line or teach the glossary.

## Modules

Both apps share the same engine, which runs locally in a worker (the extension's service worker, a Web Worker in the web app):

| Module | Role |
|---|---|
| `extension/engine/detect.js` | Text lines from PaddleOCR's PP-OCRv6 (small) detector (Apache-2.0), run by ONNX Runtime; OpenCV's dnn module is the fallback. Latin rows and vertical Japanese columns. |
| `extension/engine/segment.js` | Speech-bubble masks from a YOLOv8-seg model (kitsumed, int8; GPL-3.0/AGPL-3.0), run by ONNX Runtime. The masks are the bubble interiors. |
| `extension/engine/ort.js` | Loads ONNX Runtime Web once per worker: on the graphics card (WebGPU) when the browser offers one, on the CPU (wasm) otherwise; calls into it are serialised. |
| `extension/engine/analyze.js` | Page analysis on [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html): detected lines snapped to the ink → paragraphs → assigned to the model's bubbles; lettering outside any bubble mask falls back to the light/dark-shape rules or becomes loose text. Vertical Japanese with furigana, dark bubbles, captions, free narration. `analyze-heuristic.js` is the rule-based fallback when no detector loads. |
| `extension/engine/layout.js` | Where each translation goes: the largest rectangle of the bubble around the lettering it replaces, and the room row by row, never past the outline; a region its ink divides (two caption boxes) gives each line its own part; joined bubbles cut at the waist; free text keeps its footprint. A model tag is authoritative. Lettering Claude read as Hangul is set at its syllables' height ([ADR 0019](adr/0019-text-stays-in-its-room.md)). |
| `extension/engine/erase.js` | The eraser: the mask (lettering, its fringe and outline, never the bubble's outline), the choice of fill per area, and erasing again at full size. |
| `extension/engine/tone.js` | The screentone fill: measures the surface's lattice from its autocorrelation, checks it predicts the surround, and copies the tone in phase. |
| `extension/engine/inpaint.js` | The learned fill: AOT-GAN inpainting trained on manga (GPL-3.0), run by ONNX Runtime. |
| `extension/engine/tuning.js` | The numbers the engine decides with, by stage (layout, erase, analysis, detector, screentone, fill, page), each with its unit and what it bounds. The bench can vary them (`GYT_TUNE`, docs/QUALITY.md); a test checks each is a number the engine reads. |
| `extension/devreload.js` | Loaded unpacked (developing, or testing a branch), the extension reloads itself when `dev-reload.txt` in its folder changes; an install from a store never looks. |
| `extension/engine/owner.js` | Who frees what OpenCV made: each engine function passes the objects it makes through an owner, freed however the function ends ([ADR 0018](adr/0018-a-page-leaves-nothing-in-opencv.md)). |
| `extension/engine/page.js` | One page in the worker: downscale, analyse, stamp the regions for the model; then place, erase and return the cleaned areas with text placements. |
| `extension/text.js` | Fits and draws the text: one font per page, the first bundled one with every letter of its translations (system fonts for Chinese, Japanese, Korean); sizes from the original letter size, one size for one bubble's lines, the text set to the bubble's shape (a margin off the outline's ink; the block moved to where the room is widest when it narrows under the lettering) and to its box only where that keeps the margin; line breaks at spaces and after a word's hyphen, or between words for Chinese, Japanese and Thai, with their line-start rules; the target language's TeX hyphenation patterns only when an un-hyphenated layout does not fit; halo over artwork. |
| `extension/prompt.js` | Claude prompt (set-of-mark), API call with a JSON-schema structured answer, response parsing, chapter context. The answer contract it re-exports lives in `engine/contract.js`. |
| `extension/languages.js` | The target languages in the dropdown (English name for the prompt, own name for the list) and which have a translated interface. Shared with the web app. |
| `extension/i18n.js`, `extension/_locales/` | The interface in ten languages, following the target language: our own loader for Chrome-format `messages.json`, because `chrome.i18n` can't switch at run time. English underneath, so nothing ever shows a key. |
| `extension/settings.js` | Settings defaults and storage, shared by the service worker, the popup and Options (the pages read storage directly, never through the busy worker). |
| `extension/vendor/` | OpenCV.js 4.5.5 (wasm + loader), ONNX Runtime Web 1.31.1 (`ort/`), the PP-OCRv6 detector, the bubble model (`segment.onnx` for the CPU, `segment-gpu.onnx` for WebGPU), the inpainting models (`inpaint.onnx`, AOT, on the CPU; `lama.onnx`, LaMa, on a graphics card), `hyphen` with English patterns (other languages' patterns in `hyphen/`), and the lettering fonts' character table. Generated by `scripts/vendor-*.mjs`; CI regenerates OpenCV, ONNX Runtime, hyphen and the font table from the pinned npm packages and the font files and the detector from PaddlePaddle's pinned Hugging Face revision, and fails if anything differs. The bubble and inpainting models are vendored by their scripts with the source and checksum recorded beside them (`segment.json`, `inpaint.json`, `lama.json`); the tests check the inpainting models against their records. |

The copies under `extension/` are canonical; `node scripts/sync-shared.mjs` copies them into `web/` (CI does this on deploy; the copies are git-ignored).

### Engine boundary

The apps reach the engine through two files only:

- `engine/index.js`, for the worker that runs pages: prepare, prefill, finish, release (a page dropped before its finish), the inpainter's warm-up, the engine's settings.
- `engine/contract.js`, for any thread: how a page is cut into slices for the model, and how the model's answer is checked and turned into page fractions. It imports nothing, so the web app's page can load it without the models. `prompt.js` re-exports it.

The engine imports only its own files and `vendor/`. `scripts/check-engine-contract.mjs` checks all of this in CI (`tests/engine-contract.test.mjs`), along with the web app's offline cache listing every engine module, so a stage can be replaced without touching a caller.

## Why these choices

[`docs/adr/`](adr/): 0001 (dependencies), 0002 and 0005 (text detector), 0003 (layout), 0004 (bubble model, GPU), 0006 (chapter fetcher), 0007 (what translating costs), 0008 (the page on screen first), 0009 (agreement and site access), 0010 (language list and interface language), 0011 (lettering fonts, line breaking and hyphenation per language), 0012 (the overlay at the screen's own pixels, erased areas at full size), 0013 (the eraser: outline, flat, screentone and learned fills), 0014 (free text by two witnesses, lettering by colour, fills ahead of the answer), 0015 (what Claude reads is erased or left as drawn: punctuation, sound effects and logos, a second look on its box, one stamp for one line; LaMa on the graphics card).
