# 0024. Detectors trained on comics, measured: neither adopted

Status: accepted (3.2.2: measured; nothing in the engine changes)

## Context

The roadmap's step 3.3 put a detector trained on comics against today's, with one gate: more lines found, nothing worse. Nothing worse covers what the bench counts (lettering left, art damage, bubble outlines erased, text set past its bubble or too small) and the time and size a page costs.

Today the engine finds lines with PP-OCRv6's small text detector, which is not trained on comics, and its second looks (in dark shapes, in the bubble model's empty bubbles, in boxes Claude translated). It finds bubbles with one bubble model (kitsumed/yolov8m_seg-speech-bubble, ADR 0004 and 0020).

Candidates (from their model cards):

- **Lines:** comic-text-detector (dmMaze), the ONNX export `mayocream/comic-text-detector-onnx`: Apache-2.0, trained on Manga109-s, 95 MB, input 1024. Its line map (`det`) was read with the model's own post-processing.
- **Bubbles:** `ogkalu/comic-speech-bubble-detector-yolov8m`: Apache-2.0, about 8,000 manga, webtoon, manhua and western pages, bubbles as **boxes only**, 52 MB (`.pt`; 104 MB as a float ONNX). Koharu's YOLO26-s model (`mayocream/koharu-yolo26s`, Liiesl's 1024 ONNX export, AGPL-3.0) was measured again beside it.
- Not a candidate: `ogkalu/comic-text-and-bubble-detector`, the bench's independent witness. In the engine it would grade itself.

## Measured

`tests/bench/detectors.mjs` measures what a model finds; `bench/synth-run.mjs` what the engine makes of it. Generated pages: seeds 0–39, looked at. Real pages: the owner's debug reports, never in the repo; Claude's answers say where the lines are. Times are this machine's CPU (2 cores, ONNX Runtime's wasm build in Node).

### Lines

| | today | comic-text-detector | both |
|---|---|---|---|
| Generated, 608 blocks on 98 pages (plain, the owner's bubble shapes, webtoon) | 98.2% | 96.4% | 98.4% (+1 block, free text) |
| Real, 784 lines Claude translated on 187 pages (Rawkuma ×3, MangaDex ×3, Naver ×1) | 95.3% | 89.8% | 96.2% |

On real pages 7 lines were found only by the comic detector (6 in bubbles, 1 narration), 50 only today. It takes about 10 s a page (median 10.2 to 15.7 s by report), against about 1.1 s for today's text detector and its look in dark shapes.

On its own it finds fewer lines. With today's it adds 0.9 points on real pages, for about 10 s more a page and 95 MB. **Not adopted.**

### Bubbles found

A drawn bubble counts as found when one of the model's bubbles covers half its inside: by the mask, or by the box for a box-only model. Both models ran through the engine's model reader at 512 px.

| Generated pages | today's bubble model | box detector |
|---|---|---|
| Webtoon, dark bubbles (87; 12 cut by the image's edge) | 30 (34%) | 67 (77%) |
| Webtoon, light bubbles (179) | 163 | 159 |
| Plain pages, bubbles (164) | 147 | 143 |
| Bubbles on no drawn bubble (both page sets) | 12 | 4 |
| Model time a page (median) | 3.2 s | 2.5 s |

- At 1024 px the box detector found 72 of the 87 dark bubbles and 173 of the 179 light ones (Ultralytics, float).
- Koharu's model found 1 dark bubble of 87 and 59 light ones of 179, as ADR 0004 found on real pages. It isn't a candidate.
- **Real webtoons:** three Naver episodes the owner reported (287 pages), 381 lines Claude marked as dialogue. 358 lie in one of today's bubbles and 365 in one of the box detector's boxes. 8 lie only in a box, 1 only in today's bubbles.
- Looked at (privately): what only the box detector found includes three black burst bubbles with white lettering. A box is a looser test than a mask, since it also covers a bubble's corners.

The box detector finds the dark bubbles today's model misses. On generated pages it finds a few fewer light ones.

### End to end

To use boxes, the engine needs an interior. The trial turned each box today's masks left mostly uncovered into a bubble. Its interior was GrabCut's foreground in the box (OpenCV, seeded with the box). On the 40 generated webtoon pages, with the setting off, then on:

| | today | with the box detector |
|---|---|---|
| Lines in a region found before any second look (of 301) | 253 | 275 |
| Lines left untouched | 64 / 20 | 57 / 14 |
| Lines in dark bubbles drawn past their bubble (of 75) | 22 | 11 |
| Lines touching their outline | 40 | 31 |
| Lines set under 0.7 of their size | 30 | 25 |
| **Bubble outline pixels erased** | 408 / 2,191 | **1,325 / 3,329** |
| **Art damage, per thousand pixels** | 0.66 / 0.37 | **0.85 / 0.43** |
| **Time a page** | 5.7 s / 12.0 s | **8.6 s / 16.4 s** |

Plain generated pages came out the same (no box was left uncovered there).

GrabCut's foreground is the bubble *with* its outline. The eraser takes the mask for the bubble's inside and paints over the outline. A gradient bubble's interior is also filled with a flat colour that isn't its own. More lines are found and placed, but the gate's "nothing worse" fails on pages looked at, so held-out pages were not spent. **Not adopted.**

## Decision

1. Neither detector goes into the engine. The text detector and the bubble model stay as they are.
2. Dark bubbles stay the gap. Today's bubble model finds a third of them. On generated webtoon pages 29% of their lines are drawn past the bubble and, with the setting off, 60% stay unerased. Closing it needs a bubble's exact interior, outline excluded, and a fill for a gradient surface, not a second model's boxes. That fits 4.0's learned core: a bubble model trained on generated pages, which draw dark and gradient bubbles with their interior known exactly. Training on them also replaces a GPL-3.0 model with our own. The bar to beat is the box detector's: 77% of dark bubbles found at 512 px.
3. Kept: `bench/detectors.mjs`, and the model reader (`segment.js`) reads a box detector's output (YOLOv8 with no mask head), so such a model can be measured again.

## Not measured

- The detectors on a graphics card. With WebGPU, today's text detector took 50 ms a page on the owner's Naver episode. The comparison here is the CPU's, which every user has.
- Held-out pages. A candidate that failed on pages looked at wasn't counted on them.
