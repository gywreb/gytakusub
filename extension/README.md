# Gytakusub

Translate manga / manhwa / comic pages **in place**, on any website, using your own Claude API key.
No backend, no account, no credits — the extension talks to the Claude API directly from your browser.

## Install (Brave / Chrome / Edge)

From the Chrome Web Store listing, or unpacked:

1. Unzip this folder somewhere permanent.
2. Open `brave://extensions` (or `chrome://extensions`), turn on **Developer mode**.
3. **Load unpacked** → pick the `gytakusub` folder.

Then click the extension icon → **All settings** → paste your API key (platform.claude.com → Settings → API keys) → **Save & test**, and reload any manga tab that was already open.

Settings, glossary and (optionally) the API key sync through your browser's sync. The first translation after the browser starts takes a few seconds longer: the WebAssembly modules compile and the two models load once.

## Use

| Action | How |
|---|---|
| Translate one page | Hover the image → **Translate** |
| Translate everything on screen | `Alt+T`, or popup → *Translate visible images* |
| Hide / show translations | `Alt+Shift+T`, the eye button in the popup, or hover → **Hide** |
| Make a site "yours" (hover button + shortcuts) | Popup → *On \<this site\>* → *Enable here*. Elsewhere the extension stays dormant until you use the toolbar button or `Alt+T`. |
| Translate automatically while scrolling | Popup → *On \<this site\>* → *Auto-translate while scrolling* (per site; implies enabled) |
| Switch everything off | Popup → the switch in its header (badge shows "off") |
| Redo a page (e.g. after editing the glossary) | Hover → **↻ Redo** |
| Correct a line / teach the glossary | Double-click a translated bubble → edit → **Ctrl+Enter**; or fill "original term = translation" → *Add* |
| Peek at the original lettering | Options → *Peek at the original while hovering* (off by default), then rest the pointer on a translated bubble |
| Report a bad page | Options → *Debug overlay*, then popup → **Export debug report** (one `.zip` for every translated page on the tab) |

## How it works

1. The background worker fetches the image bytes itself (so cross-origin CDNs work; if a site refuses, the page fetches it when it may) and downsizes it to ≤1600 px (tall webtoon strips are sliced into ~1800 px pieces).
2. **Local text and bubble detection**, in the worker: PaddleOCR's PP-OCRv6 text detector finds the lines (Latin rows and vertical Japanese columns), a speech-bubble segmentation model finds the bubbles, and OpenCV snaps the lines to the ink and groups them into paragraphs inside their bubbles. Both models run on ONNX Runtime, on the graphics card (WebGPU) when the browser offers one and on the CPU otherwise (Options → *Use the graphics card*). Each region gets a numbered red stamp on the copy sent to Claude.
3. Claude is asked, per text item, *which numbered region it is in* (set-of-mark prompting — far more reliable than asking a language model for coordinates) and answers in a fixed JSON schema. The tag decides placement; the pixel box only catches a misread stamp and orders speakers inside a joined bubble. Names it finds and the last ~40 translated lines in the tab are fed back into later requests for continuity.
4. The worker **inpaints the original lettering away** (Telea; outlines and art untouched) and computes where each line goes: the largest rectangle of the bubble around the lettering it replaces. The content script lays a transparent canvas over the image with the cleaned patches and typesets the translation (bundled Comic Neue Bold), sized from the original lettering, hyphenating only when nothing else fits.
5. Results are cached per image URL for the browser session; up to 3 pages translate in parallel, nearest to the viewport first.

## Cost

One request per page: the page image (at most about 1,600 input tokens on most models after the API's own downscaling), roughly 500 tokens of instructions, and — with *Chapter context* on — about 400 more for names and recent lines; the answer is a few hundred output tokens. Haiku is the default; Sonnet or Opus read dense or stylised pages better at a higher price. These are estimates from the request size, not a measurement on your account; the Console's usage page shows the real figures.

## Known limitations

- Only `<img>` elements are handled. Readers that draw pages into a `<canvas>` or a CSS `background-image` are not supported.
- Overlays follow the image's on-screen rectangle; if the image sits inside a scrolling sub-panel the overlay can spill past the panel edge.
- Translations are set horizontally (no vertical typesetting); hyphenation is English-only.
- On the CPU (no WebGPU) a page takes about 3 s to analyse before the model call; pages translated while scrolling fast queue behind each other.
- Sound effects and signs the model leaves untranslated still get numbered stamps, which costs a few prompt tokens.
- Inpainting smooths screentone and hatching behind narration set on the art (a visible smudge where the letters were). Bubbles are unaffected.
- The package is large (about 115 MB unpacked, 78 MB to download) because the models and runtimes are bundled; nothing is downloaded at run time.

## Files

```
manifest.json     MV3 manifest
background.js     service worker: fetch → page engine → Claude → cache; keyboard commands; per-tab context
settings.js       settings defaults and storage, shared by the worker, popup and options
prompt.js         Claude prompt, structured-output schema, API call, response parsing
content.js        image discovery, hover bar, overlay rendering & positioning, auto mode, debug report
text.js           text fitting and drawing on the page side
engine/           page engine (runs in the worker):
  page.js           prepare a page for the model, then place, erase and return it
  detect.js         PP-OCRv6 text detector (ONNX Runtime; OpenCV dnn fallback)
  segment.js        speech-bubble segmentation (YOLOv8-seg)
  ort.js            ONNX Runtime loader: WebGPU or CPU, serialised calls
  cv.js             shared OpenCV instance and model loading
  analyze.js        lines → paragraphs → bubbles and loose text
  analyze-heuristic.js  rule-based fallback when no detector loads
  layout.js         where each translation goes
  erase.js          inpainting of the original lettering
vendor/           OpenCV.js, ONNX Runtime Web, the two models, hyphenation patterns (licences beside them)
fonts/            Comic Neue Bold (SIL OFL)
popup.*           quick actions, model, site toggles, debug report
options.*         API key, model, glossary, prompt, sites, lettering, GPU, debug
ui.css            shared look of the popup and Options (same tokens as the web app)
LICENSE           GNU AGPL v3; THIRD_PARTY.md lists the bundled components
```

Source, tests and design notes: https://github.com/gywreb/gytakusub
