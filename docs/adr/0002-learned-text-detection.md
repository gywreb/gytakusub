# ADR 0002 — Learned text detection replaces hand-written text rules

Status: accepted (2.0.0); the model is replaced by PP-OCRv6 in ADR 0005, and ONNX Runtime Web (deferred below) was adopted in ADR 0004. Date: 2026-11-08. Supersedes the "bubble policy" row of ADR 0001 in part.

## Context

ADR 0001 kept "what counts as a bubble" as our own rules on OpenCV primitives.
On the first real exports from the user's readers (850 px JPEG pages, 8 px
Latin capitals, screentone, mecha and hair detail) those rules needed a new
exception every chapter: letters welded to outlines, armour read as aligned
lettering, faces read as bubbles, a shout bubble skewing the page's letter
size. Each fix was measured on the user's exports (tests/score-reports.mjs)
and each held — but the failures were structural: finding text with
geometry is a research problem that the field solved with learned detectors.

## Decision

Use **PaddleOCR's PP-OCRv4 text detector** (DBNet, Apache-2.0, 4.7 MB ONNX)
to find text lines, run by **OpenCV's dnn module from the wasm we already
bundle** — no second runtime. The official export uses a `HardSigmoid` layer
OpenCV 4.5 lacks; `scripts/vendor-detector.mjs` rewrites those ten nodes as
`Mul/Add/Clip` (mathematically identical) and CI checks the rewrite is
reproducible. Geometry keeps the jobs it is good at: snapping boxes to the ink
(DBNet predicts a shrunk core and its unclip under-grows small text and
over-grows large text), merging lines into paragraphs, finding the flat light
or dark shape around a paragraph and testing that its only content is the
lettering, inpainting. The heuristic analyser stays as a fallback for when
the model cannot be loaded.

## Evidence (eight exports, 172 real pages, model answers as witness)

| | rules (latest) | learned |
|---|---|---|
| coverage (lines whose position falls in a detected region) | 93.1% | 94.4% |
| dialogue recognised as a bubble, by text | 95.8% | 95.7% |
| false regions per page | 5.68 | **0.93** |
| analysis per page (Chrome, wasm) | 0.3 s | 2.1–2.8 s |

The false regions were what produced erased faces and swapped lines. The
synthetic corpus (13 pages, 100 assertions) passes on the learned engine
once the generator drew screentone at realistic pitch.

## Alternatives considered

- **ONNX Runtime Web** (wasm SIMD/threads or WebGPU): likely 3–5× faster
  inference, but +15 MB and a second runtime to maintain. Deferred to 1.2 as the
  speed lever if 2 s per page proves too slow in practice.
- **Comic-specific detectors** (comic-text-detector, Magi): better on manga
  SFX and vertical text, but GPL or tens to hundreds of MB.
- **Keep tuning rules**: every rule was principled and measured, and the
  curve still flattened at ~93% with destructive misses; see the score
  history in the commits of 2026-11-08.

## Consequences

- Package grows by 4.7 MB (total vendored ~11 MB). First analysis after the
  worker starts also parses the model (~0.3 s).
- Analysis is ~2 s per page and runs before the model call; pages in flight
  queue in the worker. Acceptable at reading pace; a known cost while
  scrolling fast.
- The scorer's witness changed once: an item is found if either the region
  the user's build stamped or the model's own box lands in a detected region,
  so an engine is not penalised for lacking a false region the old build had.
