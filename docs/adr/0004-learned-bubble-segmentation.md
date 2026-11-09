# ADR 0004 — Bubbles from a learned segmentation model

Status: **accepted for 1.1.1 on `feature/learned-layout`** (2026-11-09),
pending the user's live test and the licensing decision below. Supersedes the
bubble half of ADR 0002 (the light-region tests become the fallback); ADR
0003's layout invariants stay.

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

The build environment cannot reach huggingface.co (unless the account's
allowed domains include `huggingface.co` and the Xet storage host
`cas-bridge.xethub.hf.co`), so the model file is downloaded by hand and
vendored with `node scripts/vendor-segment.mjs <file.onnx> --source … --license …`.
Files: `kitsumed/yolov8m_seg-speech-bubble` → `model_dynamic.onnx` (109 MB) or
`model.pt` (54.8 MB, exported here with Ultralytics to a static 640 ONNX);
`ogkalu/comic-speech-bubble-detector-yolov8m` → `comic-speech-bubble-detector.pt`
(52 MB, boxes only). A 100 MB fp32 file is quantized first
(`scripts/quantize-segment.py`: static int8, QDQ, per-channel, calibrated on
the user's exported pages); whether the result ships inside the package or is
fetched on first run and cached is decided by its size.

## Measurement (2026-11-09, 270 pages from 12 exports)

Model: `kitsumed/yolov8m_seg-speech-bubble`, int8 (head in float), 512 px
input, conf 0.25, hybrid with the light-region rules for unclaimed lettering.
Of the two candidates it was the only one that found the white bubbles
reliably: Koharu's YOLO26-s model returned mostly panel frames on these
Spanish scanlation pages and missed five of five white bubbles on one of them
(it did find a heavily toned bubble the kitsumed model missed — neither model
handles tone reliably, which is why the rules stay as fallback).

| `score-reports.mjs` (model answers as witness) | rules only | + segmenter |
|---|---|---|
| dialogue recognised as a bubble | 92.4% (by text 95.0%) | **98.0% (99.4%)** |
| lines covered by a region | 93.5% | **94.8%** |
| regions without an answer, per page | 0.61 | 0.90* |
| analysis per page (Node, wasm) | 0.61 s | 2.60 s |

Final code: model bubbles without lettering are dropped, and before that each
one gets a second text-detection pass on its crop at up to 2× resolution
(`detectInEmptyBubbles`: the page-wide pass runs at 960 px, where small
lettering in a bubble can fall under the threshold). Without the second pass
dropping empty bubbles cost 1.7 points by count (98.8 → 97.1%); with it, 98.0%.
The GPU variant of the model scores the same as the CPU variant (both 94.0% /
97.1% / 99.4% before the second pass).

\* Of 89 such regions on 90 pages: 40 segmented bubbles *with* lettering that
the recorded run had no answer for (the model never saw a stamp there in that
run — this metric cannot see new regions fairly), 21 loose text blocks and 20
rule-based bubbles (as before), 8 segmented bubbles without lettering (now
dropped before stamping).

| `layout-score.mjs` | rules only | + segmenter |
|---|---|---|
| lines placed by halo or loose (no bubble found) | 190 | **106** |
| rendered size under 0.7× the original | 9.6% | **8.7%** |
| 10th-percentile rendered size | 0.71 | **0.74** |
| translations over un-erased lettering | 70 | **52** |
| rectangle over its own lettering | 96.1% | 96.0% |
| rectangles narrower than 3 letters | 136 | 147 |
| shared bubbles: every line over its own | 89.3% | 82.6% (322 vs 458 shared placements: the model separates joined bubbles) |
| analysis per page (Node; text detector on ORT in both) | 0.67 s | 2.53 s |

(Final code, including the rule that a distrusted stamp stands unless the
model's box points at another region.)

The two small regressions come from mask edges: at 512 px input a prototype
cell is ~9 page pixels at 850 px width, so masks are blobby and sometimes
tighter than the outline. The ADR 0003 floor (never less room than the
lettering) bounds the damage; a larger input (640: +1.1 s on CPU) or WebGPU
would sharpen them.

Synthetic corpus: the model splits the joined bubble into its two lobes and
sees the stick figures' round heads as bubbles (dropped: no lettering inside);
the tests accept a truth bubble covered by several lobes and measure erasure
where the lettering was. 100 assertions pass with the model in place.

## GPU (WebGPU), added 2026-11-09

Both models run on ONNX Runtime's WebGPU execution provider when the context
has a WebGPU adapter — extension service workers since Chrome 124 (Brave keeps
WebGPU on and only blanks the adapter's identifying strings), dedicated
workers in Safari 26 for the web app — and on the wasm CPU provider
otherwise. The vendored runtime is ORT's WebGPU build (29 MB wasm), which also
carries the CPU provider; its CPU speed equals the plain build's (1.86 vs
1.93 s for the bubble model), so one runtime serves both.

The int8 QDQ bubble model is wrong for the GPU: ORT's WebGPU provider has no
QuantizeLinear kernel, so 295 of its nodes ran on the CPU between GPU nodes
(measured with Dawn on a software GPU). The GPU therefore loads a second
variant, `segment-gpu.onnx`: weight-only int8 (Conv weights int8 per output
channel behind DequantizeLinear, activations float) with the input fixed at
512 px — all 273 nodes on the GPU, 28 MB. On the CPU that variant would be
slower (2.8 vs 1.9 s), which is why the CPU keeps the QDQ model; transformers.js
picks a quantisation per device the same way.

Verified: `tests/gpu.test.mjs` runs both models on WebGPU through Google's Dawn
(the implementation in Chrome) on Mesa's software Vulkan driver, in CI as
well, and requires the same text lines and confident bubbles as the CPU path
on every fixture page. Speed on a real GPU is not measurable here; the
owner's debug reports carry `timing.backend`, `timing.detect` and
`timing.segment`.

Why not first: the GPU path could not be exercised in the build environment
or CI until a software WebGPU (Dawn + lavapipe) was set up, and the QDQ model
chosen for the CPU turned out to be the wrong format for the GPU — shipping it
untested would have been slower than the CPU, not faster.

## Licensing

**Decided 2026-11-09 by the owner: Gytakusub is relicensed to AGPL-3.0 from
1.1.1** (`LICENSE`, `THIRD_PARTY.md`, licence files inside the package, source
link in Options). The analysis that led to it:

- The model card says GPL-3.0; the ONNX metadata says Ultralytics AGPL-3.0,
  which is Ultralytics' position for every model trained with its code unless
  an enterprise licence is bought. The training data is not described.
- For the owner's own use (the only install today) there is nothing to do.
- For a Chrome Web Store build, the simplest compliant path is to publish the
  extension itself under **AGPL-3.0** (the code is already open source; MIT
  code can be relicensed by its author; the store allows AGPL extensions and
  requires nothing more than the source being available, which it is). The
  alternative is to keep the model out of the package and fetch it on first
  run as an optional component (the extension works without it), which keeps
  MIT for the code but is a weaker separation argument. Training our own
  bubble segmenter on permissively licensed pages would remove the question;
  the user's exports cannot be that data.
- What other translators do is not something I could verify; Koharu
  (Apache/MIT code) ships this same model and leaves the weights under their
  own licence.
- Koharu's YOLO26-s model is excluded regardless: its lineage is a
  Manga109-trained model, and Manga109 is research-use only.

## Measurement before any switch (procedure)

Same corpus, same tools, model loaded via `GYT_SEGMENT=<file.onnx>`:

- `tests/score-reports.mjs *.zip` — coverage, dialogue recognised as a bubble,
  false regions per page (model answers as witness), with and without the
  segmenter;
- `tests/layout-score.mjs *.zip` — rendered font size, letter-broken words,
  lines over their own lettering, overlap with un-erased text;
- analysis time per page (segmentation is reported separately as
  `timing.segment`) in Node and in Chrome.

The segmenter ships only if dialogue-as-bubble improves and no rendered-size
row gets worse (both held). Speed is the open cost: ~2 s/page on the
single-threaded wasm at 512 px. The WebGPU execution provider (ORT's webgpu
bundle, 29 MB wasm) is the next step; it cannot be tested in this environment
or in headless CI and needs the user's machine.

## What is already tested

`tests/segment.test.mjs` builds a stand-in model (`make-fake-seg.py`) with the
exact output layouts, runs it through ONNX Runtime in Node, and asserts boxes,
mask areas, NMS and the analysis hand-off; the browser suite ships the same
stand-in with the extension (`--segmenter`) so the service worker runs ONNX
Runtime for real — CSP, wasm fetch from the extension URL, no dynamic
`import()`.
