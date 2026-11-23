# ADR 0020: One bubble model for the CPU and the graphics card

Status: accepted (3.0.0). Date: 2026-11-23. Part of the 3.0 plan (a robust core): "the same page gives the same result on CPU and on a graphics card".

## Context

Since 2.0 the bubble model came in two variants (ADR 0004): static int8 (QDQ, activations quantized too) for the CPU, where ONNX Runtime runs it on integer kernels, and weight-only int8 (float activations) for WebGPU, which has no QuantizeLinear kernel. The two drew bubbles a few pixels apart (mask IoU 0.95–0.99 on generated pages), so:

- the same page could come out differently on a graphics card than on the CPU;
- a debug report replayed on the CPU (Node, the bench) did not reproduce the owner's graphics card. In the Portuguese chapter (2.13.1) 6 of 77 lines were placed differently in the replay. Replaying today's French reports (page 9): bubbles 12 px apart.

## Decision

One model for both backends: the weight-only variant (`vendor/segment.onnx`, 27.9 MB). `engine/cv.js` loads it on WebGPU when there is a graphics card, else on the CPU. `scripts/vendor-segment.mjs` vendors one file; `scripts/quantize-segment.py` keeps the static variant for measuring only.

## Measured

- **Replays on the CPU** of the owner's reports from his graphics card (2.15.0, French chapter): page 20, regions and placements exactly the same (were within 2 px); page 9, regions within 1 px (were 12 px apart), placements identical.
- **`tests/gpu.test.mjs`** (Dawn on a software GPU, in CI): the same bubbles with masks within 2% IoU, and the page's regions and placements within 2 px, on every fixture page.
- **Quality, generated pages looked at** (150 + 150, against the two-model build): lines set under 0.7 of their size 98 → 97 and 138 → 140; lines a bubble could hold at 0.7 set smaller (keeping clear of the outline) 8 → 7 and 16 → 16; touching their outline 16 → 14 and 28 → 29; lettering left and art damage unchanged; outline pixels erased 1,788 → 1,818.
- **Package:** 43.3 MB smaller (the CPU's own model is gone).

## Cost

On a device without WebGPU the bubble model is slower: float convolutions instead of integer ones. ADR 0004 measured 1.9 s against 2.8 s per page for the model; here a generated page's whole run through the bench (analysis, layout, erasing, lettering, on the CPU) took 4.7 s against 5.5 s on average. Where the browser offers WebGPU (the extension in Chrome, Brave and Edge 124+, the web app in Safari 26), nothing changes.

## Not done here

- The text detector already was one model; its CPU and WebGPU results agree to the box in `gpu.test.mjs`.
- The fill differs by design: LaMa on a graphics card, AOT on the CPU (ADR 0015). It changes pixels in erased areas, not where lines go.
