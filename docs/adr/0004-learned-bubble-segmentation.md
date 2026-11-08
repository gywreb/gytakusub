# ADR 0004 — Bubbles from a learned segmentation model

Status: **proposed** — plumbing built and tested (2026-11-09); the switch is
gated on the measurement below. Supersedes the bubble half of ADR 0002 (the
light-region tests) if adopted; ADR 0003's layout invariants stay.

## Context

After the text detector was learned (ADR 0002), every remaining failure the
user reported on real chapters came from the one part still decided by rules:
*what is a bubble and what does it enclose*. Toned and gradient bubbles,
bubbles whose outline is broken by a character or an open tail, a bright sky
passing as one shared bubble, bubbles cut by the panel edge — each needed its
own rule, each rule was measured and held, and the next chapter brought the
next shape. The user named this pattern (ad hoc) and asked for the approach
the field uses. Open-source manga translators (Koharu, manga-image-translator)
do not decide bubbles from pixel statistics; they run an instance-segmentation
model that returns balloon polygons.

## Decision (proposed)

Run a YOLO instance-segmentation model for speech bubbles with **ONNX Runtime
Web** (MIT, vendored: 77 KB ESM bundle + 14.8 MB single-threaded SIMD wasm) in
the service worker and the web app's worker, and use its masks as the bubble
interiors. The text detector, paragraph merging, layout (ADR 0003), erase and
inpainting are unchanged; the analysis only stops guessing the bubble shape.
The light-region rules remain as the path taken when no model is present.

`engine/segment.js` understands both Ultralytics export layouts (YOLOv8-seg
`[1, 4+nc+32, N]` + prototypes, and end-to-end `[1, N, 6+32]` rows) and maps
boxes and masks back to page pixels through the letterbox. `engine/ort.js`
loads the runtime; `getSegmenter()` in `engine/cv.js` loads
`vendor/segment.onnx` + `segment.json` if they exist. `page.js` runs it before
`analyze()`, whose `instances` option takes the model's bubbles
(`bubblesFromInstances`): mask = interior, paragraphs whose centre lies in the
mask = the lettering, surface luminance = polarity. A bubble the model found
but the text detector left empty is still a region, and the eraser removes the
letter-sized ink inside its mask (`paintInsideMask`).

## Candidate models (checked 2026-11-09; re-verify before adopting)

| model | what | size | licence / data | notes |
|---|---|---|---|---|
| kitsumed/yolov8m_seg-speech-bubble (Hugging Face) | bubble masks, 1 class, 640 input, YOLOv8m-seg (27 M params) | ~105 MB fp32 ONNX; int8 ≈ 27 MB | GPL-3.0; training data not described | what Koharu ships (as `mayocream/speech-bubble-segmentation`, a SafeTensors repack). ONNX exported with dynamic shapes. |
| mayocream/koharu-yolo26s, 1024 ONNX export by Liiesl (`bubble-segment-onnx`) | panel / dialogue text / balloon / onomatopoeia masks, YOLO26-s (11 M) | 40 MB | AGPL-3.0, fine-tuned from a Manga109-trained model (research-only data) | excluded for a published build; the four classes would also replace the text detector |
| ogkalu/comic-speech-bubble-detector-yolov8m | bubble **boxes** only, 8k pages incl. webtoons | ~50 MB | Apache-2.0 | no masks: the interior would still need the light-region rules inside the box |
| ShadowB / anonimkaq4 / Mrdhnto YOLO26 models | masks or boxes, Manga109-derived | 10–40 MB | Manga109: research use only | excluded |

Ultralytics' position is that models trained with its code are AGPL-3.0
unless an enterprise licence is bought; the Hugging Face cards above carry
GPL/AGPL for that reason. For the user's own use this is fine; for the Web
Store listing it is a decision to take explicitly (a GPL model file loaded as
data by MIT code, or training a bubble segmenter on permissively licensed
pages — the user's exports cannot be that data).

The build environment cannot reach huggingface.co, so the model file is
downloaded by hand and vendored with
`node scripts/vendor-segment.mjs <file.onnx> --source … --license …`. A 100 MB
fp32 file should be quantized first (static int8 with ONNX Runtime's
quantization tools, calibrated on the user's exported pages); whether the
result ships inside the package or is fetched on first run and cached is
decided by its size.

## Measurement before any switch

Same corpus, same tools, model loaded via `GYT_SEGMENT=<file.onnx>`:

- `tests/score-reports.mjs *.zip` — coverage, dialogue recognised as a bubble,
  false regions per page (model answers as witness), with and without the
  segmenter;
- `tests/layout-score.mjs *.zip` — rendered font size, letter-broken words,
  lines over their own lettering, overlap with un-erased text;
- analysis time per page (segmentation is reported separately as
  `timing.segment`) in Node and in Chrome.

The segmenter ships only if dialogue-as-bubble and false regions improve and
no rendered-size row gets worse. If the first candidate is too slow on the
single-threaded wasm (expected 2–5 s/page for an M-size model at 640 px),
the WebGPU execution provider (`ort.webgpu.bundle.min.mjs`, 29 MB wasm) is
the next step before giving up on the model.

## What is already tested

`tests/segment.test.mjs` builds a stand-in model (`make-fake-seg.py`) with the
exact output layouts, runs it through ONNX Runtime in Node, and asserts boxes,
mask areas, NMS and the analysis hand-off; the browser suite ships the same
stand-in with the extension (`--segmenter`) so the service worker runs ONNX
Runtime for real — CSP, wasm fetch from the extension URL, no dynamic
`import()`.
