# 0028. A bubble model of our own

Status: measured, not shipped (27 Nov 2026). Both candidates failed the gate on the real pages looked at, so neither was counted on held-out pages.

## Context

The bubble model finds speech bubbles and draws their shape. Today's is kitsumed's YOLOv8m-seg (GPL-3.0, ADR 0004), quantized for the browser (ADR 0020). On generated webtoon pages it finds 34% of dark bubbles. ogkalu's comic detector finds 77%, but it gives only boxes, and end to end those cost bubble outlines and art (3.2.2, ADR 0024). A dark bubble the model misses is erased only from a reader's box, if at all (3.5, ADR 0027).

Generated pages know every bubble's shape exactly. 4.0's third step (roadmap, "4.0: the plan") fine-tunes today's model on them.

## Decision

1. **Training data: generated pages only** (`tests/bench/bubble-data.mjs`). Manga109-s and the owner's reports stay test sets. Training uses seeds from 1,000,000 and Ultralytics' own check during training uses seeds from 2,000,000, so the bench's pages (0–149 looked at, 100,000+ held out) are never trained on. Each page mixes the bench's kinds at random, fixed by its seed: lettering printed on things (half the pages), the owner's bubble shapes (half), a webtoon's dark bubbles (half), lettering at the image's cut (a quarter). Pages keep their lettering. 3,000 pages train, 300 check.
2. **The label is a bubble's inside and outline as one shape.** On 40 pages looked at, today's model draws its masks closer to that than to the inside alone: IoU 0.85 against 0.82 on light bubbles. The engine's rules were tuned on those masks. The generator cuts the inside half a pixel short of the outline, so the two are joined by a closing of 5 px before the shape is traced.
3. **Fine-tuned from today's weights** (kitsumed's `model.pt`, pinned revision `72da698`, checksum checked), so it keeps what it learned from real pages. The settings are fixed before any result: input 512 (the engine's), at most 40 passes with early stopping after 10 without gain, AdamW at 0.0005 falling to a tenth on a cosine, Ultralytics' default augmentation, seed 0.
4. **Two candidates:** every layer trained, and the backbone (layers 0–9) frozen. Freezing keeps more of what it learned on real pages and may learn less from the generated ones. The pages looked at choose between them, and the held-out pages count the winner.
5. **Trained on the owner's NVIDIA card** (`scripts/train-bubbles.py`, docs/TRAINING.md). The set is made on Linux, where the bench's fonts are. Ultralytics is pinned at 8.4.220.
6. **The export and quantization stay as today's.** ONNX with dynamic shapes at opset 19, as kitsumed's file was. Then `scripts/quantize-segment.py --weights-only --static 512`, which turns kitsumed's ONNX into today's `segment.onnx` byte for byte (checked: same SHA-256). Today's weights go through the same export (`base.onnx`), and must give today's numbers before the candidates are trusted.
7. **The project is AGPL-3.0**, so a model trained with Ultralytics' code ships under the same terms as today's.

## Gate (held-out pages)

- **Dark bubbles found at least 77%** (ogkalu's detector's rate), light ones no fewer (`bench/detectors.mjs bubbles`).
- **Real pages:** lettering still seen and art damage no worse.
- **Size and time no worse.** It's the same network, so they should match, but they're measured too.

The generated held-out pages come from the same generator as the training pages, so that half of the gate is easier than it looks. The real pages, which training never sees, are the true check.

## Measured

**The export path.** Today's weights, exported on the owner's machine by the training script (Ultralytics 8.4.220, PyTorch 2.14.1 with CUDA 13.0), match kitsumed's ONNX within 0.00002 in float32. After the same quantization, confidences differ by at most 0.0009. The files aren't byte-identical: 28.7 MB against 27.9 MB, from a newer exporter's graph. On 35 webtoon pages looked at, the two find the same bubbles on every page, with the same 5 false ones. A candidate's numbers below therefore come from its weights, not from the export.

The training run's own export of today's weights finds the same bubbles as today's model on 100 webtoon pages looked at, with the same 12 false ones.

**Training** (the owner's RTX 3070 Ti, PyTorch 2.14.1 with CUDA 13.0): every layer trained stopped early after 33 passes (best: 31), in 23.5 minutes. With the backbone frozen it ran all 40 passes (best: 38), in 21.1 minutes. On Ultralytics' own check (generated pages, seeds from 2,000,000), mask mAP50 was 0.990 and 0.988.

**Generated pages looked at** (`bench/detectors.mjs bubbles`):

| | Dark bubbles found (webtoon) | Light found (webtoon) | Light found (plain) | Bubbles that weren't there |
|---|---|---|---|---|
| Today's model | 43.6% | 90.1% | 90.4% | 12 + 13 |
| Every layer | 100% | 100% | 100% | 1 + 1 |
| Backbone frozen | 100% | 99.8% | not run | 9 |

End to end on the 100 webtoon pages looked at, against 3.5 (both candidates about the same): lines in dark bubbles left untouched went 18 → 11–12, text set under 0.7 of its size 90 → 78–79, and text past its bubble 53 → 28–31. But bubble outlines erased doubled (4,174 → 8,037–8,487), and art damage rose 39%.

**Real pages looked at** (the first half, 167 pages), against 3.5:

| | Lettering still seen | Art damage | Sound-effect pixels changed |
|---|---|---|---|
| Today's model | 13 lines | 50.7 | 8,855 |
| Every layer | 18 | 92.2 (+82%) | 20,792 (+135%) |
| Backbone frozen | 17 | 54.1 (+7%) | 10,817 (+22%) |

**Why, on the pages looked at.** Comparing the bubbles each model finds on those 172 page halves: the frozen candidate found 211 that today's model doesn't, and missed 92 that it finds, 59 of them with a score of 0.7 or more. The new ones include eyes (a white oval round a dark pupil), faces, white patches in focus lines, plain white areas of a panel and sound effects. The missed ones are hand-drawn bubbles: wobbly or spiky outlines, and bubbles open to the panel's edge. The generated pages draw bubbles as clean geometric shapes, and nothing in their art looks like an eye or a face. Trained on them alone, the model learned that a clean white oval is a bubble and a hand-drawn one isn't.

On generated pages, today's masks cover 75% of a bubble's outline and the frozen candidate's 87% (webtoon pages looked at). The label covered all of it. That may account for part of the doubled outline erasing. More bubbles found (dark ones among them) is the rest. This is reasoning, not measured apart.

## What it leaves

Today's model stays. What was learned:

- **Generated pages alone don't teach real bubbles.** A second try would need generated pages with what real pages showed here: hand-drawn and open bubbles, and art that looks like bubbles (eyes, faces, focus lines).
- **The label should end where today's masks do**, within the outline, not past it. The engine's eraser was tuned on today's masks.
- **The tools stay:** `tests/bench/bubble-data.mjs`, `scripts/train-bubbles.py`, `scripts/pack-set.py`, docs/TRAINING.md and `bench/detectors.mjs --max`.
