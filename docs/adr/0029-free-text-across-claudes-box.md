# 0029. Free text: the mask across Claude's box, the shape rule, and a mask trained on generated pages

Status: accepted (3.6.0)

## Context

4.0 asks that free text left untouched on generated pages be at most 5%. After 3.5 (ADR 0027) it was 8.6% on held-out pages.

On the 150 plain generated pages looked at, 11 free-text lines were left with 3.5. By eye, about 9 were paragraphs where only some lines were erased: the line the detector found, or the part under the box. The mask is run on a region's own crops, so it never looked at the rest of the paragraph.

## What was tried, in order

All numbers in this section are from pages looked at.

1. **The mask also looks across the box Claude gave for a free-text line**, in a crop of its own (`textmask.js textCrops`, `readerBox`). A piece found there counts when at least half of it lies inside the box (`ERASE.readerBoxShare`, as in ADR 0027). With today's mask (comic-text-mask as published), free text left went 10.96% → 6.85% on the 95 plain pages run, but art damage rose 14%: in the box's crop the mask took hatching for lettering. A pen rule followed: a piece there must be drawn with the pen of the lettering the mask found on the region's lines (`ofPen`). That wasn't enough.
2. **The mask fine-tuned on generated pages**, so it stops taking hatching for lettering (below). Each trained version went into 3.5's engine on the 321 real pages first. Both passed: lettering still seen 27 → 26 lines (every layer trained) and 27 → 25 (encoder frozen) of 2,607; art damage 0.076% → 0.073% and 0.036%. The frozen one went on. With the box crops, though, free text went 9.2% → 10.1%: not down.
3. **Why it wasn't down.** 8 of the 12 free-text lines left had their lettering inside a crop the mask was run on. Run alone on those crops, every mask (today's and both trained) marks the lettering. It was lost after the mask. A rule takes any piece thicker than 1.5 times its lines' height for a dark bubble taken whole (`ERASE.modelThickLines`), drops it, and gives up the region's mask. On a paragraph of outlined lettering the mask joins the lines into one piece, and the rule dropped it. The 4 give-ups looked at were all lettering. The rule fired about as often with today's mask: on 9 of the 150 pages with either mask, with the thickness of the pieces spread alike (median 0.52 and 0.51 of the line's height, 99th percentile 1.35 and 1.36). It had been blocking free text before the training too.

## Decision

1. **A thick piece mostly inside the box Claude gave for a free-text line is that line's lettering** (`erase.js paintOwn`, `paintBoxes`; `ERASE.readerBoxShare`). Everywhere else the rule stands. A dark bubble taken whole reaches well past the box around its words, and a bubble's lines aren't free text. The box crops of step 1 take such pieces too.
2. **The box crops of step 1 stay**, with the pen rule. With the trained mask the pen rule changed nothing on the pages looked at. It was measured with and without, before decision 1.
3. **The mask is the one trained with the encoder frozen.** Its decoder and head are new; its encoder is the authors' bit for bit. `models/textmask-decoder.safetensors` holds the 62 tensors that differ (12.6 MB). `scripts/vendor-textmask.mjs` lays them over the authors' pinned weights and builds `vendor/textmask.onnx` byte for byte (`textmask.json`: both checksums).

Both masks with decisions 1 and 2, against 3.5, on pages looked at:

| Pages looked at | | 3.5 | Today's mask | Trained mask |
|---|---|---|---|---|
| Generated, plain (150) | Free text left untouched | 9.2% | 5.0% | 6.7% |
| | Art damage | 0.0194% | 0.0202% | 0.0177% |
| | Bubble outline pixels erased | 1,988 | 1,988 | 764 |
| Webtoon (100) | Free text left untouched | 10.7% | 5.3% | 5.3% |
| | Art damage | 0.0332% | 0.0350% | 0.0162% |
| | Bubble outline pixels erased | 4,174 | 4,174 | 718 |
| The owner's shapes (150) | Free text left untouched | 7.6% | 4.2% | 5.9% |
| | Art damage | 0.0159% | 0.0169% | 0.0139% |
| Real (321) | Lettering still seen | 27 lines | 22 | 23 |
| | Art damage | 0.0760% | 0.0782% | 0.0357% |

Today's mask leaves 2 fewer free-text lines on plain pages and on the owner's shapes, and adds art damage on every set (on real pages, 4 pages worse and none better). That's the box crops taking hatching, as in step 1. The trained mask lowers art damage on every set and erases far less of bubbles' outlines. It's worse than 3.5 in one place: lines with some lettering left on the owner's shapes, 51 → 53. Damage the fill leaves can't be undone by translating again. 2 lines can (reasoning). The trained mask was chosen on these pages, before any held-out page was counted.

## Training the mask

`tests/bench/textmask-data.mjs` makes the set and `scripts/train-textmask.py` trains (docs/TRAINING.md). The settings were fixed before any result:

- **Generated pages only.** Training uses seeds from 1,000,000 (1,500 pages, 22,665 crops) and its own check uses seeds from 2,000,000 (150 pages, 2,192 crops), never the bench's pages. Manga109-s and the owner's reports stay test sets. Pages with a sound effect drawn into the art are skipped: the generator can't say which of its pixels are lettering.
- **The crops the engine makes:** round each line's lettering, round a box like Claude's (moved by up to 15%, one in ten by up to 40%), and up to 3 crops of art with no lettering per page, as negatives.
- **The authors' label and recipe:** each line's footprint (glyphs and outline) and the marks left as drawn, grown by 2 px. Dice and BCE, AdamW, the authors' augmentation, input 384. A quarter of the authors' learning rate (1e-4), at most 15 passes, stopping after 3 without gain, seed 0.
- **Two candidates:** every layer, and the encoder frozen. On the generated check crops, IoU went 0.84 (the authors' weights) → 0.95 and 0.94. Those crops come from the same generator, so this says little. The real pages decided.
- Trained on the owner's NVIDIA card (RTX 3070 Ti, PyTorch 2.14.1, CUDA 13.0, segmentation-models-pytorch 0.5.0): 39 and 30 minutes. A graphics card's sums aren't bit for bit, so training again gives close weights, not these.

## Measured

Against 3.5.0, on pages never looked at (counted once, after the choice above):

| Pages | Lines | Lines left untouched | Free text left untouched | Dark-bubble lines left untouched | Art damage | Bubble outline pixels erased |
|---|---|---|---|---|---|---|
| Generated | 810 | 19 → 13 | 12 → 7 (8.6% → 5.0%) | — | 0.0198% → 0.0157% (no page worse) | 950 → 581 |
| Webtoon | 789 | 28 → 15 | 6 → 3 (6.8% → 3.4%) | 14 → 6 (8.1% → 3.5%) | 0.0486% → 0.0192% (no page worse) | 5,043 → 836 |
| The owner's shapes | 1,165 | 19 → 13 | 12 → 6 (8.6% → 4.3%) | — | 0.0253% → 0.0219% (2 pages worse) | 1,437 → 1,063 |
| Lettering at the image's cut | 979 | 26 → 20 | 12 → 7 (8.6% → 5.0%) | — | 0.0219% → 0.0161% (1 page worse) | 1,779 → 639 |
| Real pages (2,839 lines the witness reads) | 2,752 | lettering still seen 24 → 25 (0.85% → 0.88%) | — | — | 0.0456% → 0.0433% (8 pages worse, 8 better) | — |

- **4.0's gates:** lettering still seen on real pages stays under 1% (0.88%). Free text left is 5.0% on two generated sets and under it on the other two: 7 lines of 139, where 5% is 6.95. It's at the gate, not under it.
- **Real pages:** one more line still seen in all (8 pages more, 5 fewer). Sound effects changed 0.16% → 0.15%. Sizes and text over art are unchanged.
- Sizes, text past its bubble and lines touching their outline are unchanged on every generated set.
- **Thick dark outlines round light letters:** the trained mask marks less of them than the authors' did: 89% of a 12 px one, 84% of 16 px, against 100%. The eraser still takes them whole end to end (100% at 12 px, 99.7% at 16 px). `textmask.test.mjs` now checks the eraser's mask, not the model's, as that's what the page shows. White outlines round dark letters, which the generator draws, are marked whole.
- **Time:** on real pages the mask took a median of 4.3 s a page on one CPU thread, against 3.1 s, because the box crops are masked too. On a graphics card the mask takes tens of milliseconds a page (ADR 0026), so the difference is small there (reasoning, not measured here).

## Not measured

- **Fills here are Telea's**, as everywhere on the bench. The extension fills with AOT or LaMa, so the damage numbers are the bench's, not the app's.
- **Real readers' boxes.** The rule trusts Claude's box for a free-text line. The bench moves the boxes as it simulates Claude, and the real pages' boxes are the researchers'. A real answer that boxes a dark bubble's line as free text, with the box drawn around the whole bubble, would let the mask take the bubble. The owner's reports remain the final check.
- **The trained mask on real lettering styles the generator lacks.** The real pages say it's no worse there, on 654 pages. They don't say it's better.
