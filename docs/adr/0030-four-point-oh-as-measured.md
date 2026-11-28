# 0030. 4.0, as measured: the gate read as the app fills, and the rules kept

Status: accepted (4.0.0)

## Context

4.0's plan (roadmap, "4.0: the plan") had five steps and one gate:

1. the learned text mask on by default (3.4);
2. what the mask still leaves (3.5, 3.6);
3. a bubble model of our own;
4. the rules the learned parts replace, deleted;
5. 4.0.0.

The gate: lettering still seen on real pages at most 1%, and free text left untouched on generated pages at most 5%, both on held-out pages.

After 3.6, real pages were at 0.88%. Free text on the held-out generated pages was 5.0%: 7 lines of 139, where 5% is 6.95.

## The bench's fill

The bench fills textured areas with Telea unless told `--fill aot`. The app never does where a learned fill runs: AOT on the CPU, LaMa on a graphics card (`cv.js getInpainter`). Telea stays only when those models fail to load.

Of the 8 free-text lines 3.6 left on the 150 plain generated pages looked at, 3 (seeds 44, 101, 130) had every unchanged pixel inside the eraser's mask. `synth-run.mjs --why-left` now counts this as `masked`. They were erased, and Telea pulled the dark lines around them back into the lettering's shape. With AOT none of the 3 counts as left. On 3 generated pages AOT now takes about Telea's time (28 s against 27 s), so the bench can afford it.

## Decision 1: 4.0's free-text gate is read with AOT

The gate is read with AOT, with Telea beside it so history still compares. Free text left untouched, held out, 3.5 → 3.6 (counted once, 28–29 Nov):

| Pages | AOT | Telea |
|---|---|---|
| Generated, plain (the gate's set) | 12 → 6 of 139 (8.6% → 4.3%) | 12 → 7 (8.6% → 5.0%) |
| Webtoon | 6 → 3 of 88 (6.8% → 3.4%) | 6 → 3 |
| The owner's bubble shapes | 13 → 6 of 139 (9.4% → 4.3%) | 12 → 6 |
| Lettering at the image's cut | 13 → 7 of 139 (9.4% → 5.0%) | 12 → 7 |

With AOT, art damage is lower with 3.6 on all four sets (0.0167% → 0.0120% plain, 0.0389% → 0.0144% webtoon), with one page worse on the owner's shapes. The gate passes on its own set. The cut set sits on the line.

On the pages looked at, the free-text lines still left with AOT are the same 5 on the plain pages and the owner's shapes, and 4 on webtoon pages. They come from three causes:

- free text over a white shape in the art that the light-region rules call a bubble (seeds 27, 47);
- lines never found (87, 134);
- a fill that still comes back like the lettering (3, and 33 on webtoon).

No rule was written for any of them: one or two looked-at lines each is what a rule overfits to.

## Decision 2: no rule is deleted (step 4)

Each deletion was to pass "nothing worse" on looked-at pages first: generated plain, webtoon and the owner's shapes with AOT, and the 321 real pages. Then both held-out halves. Neither passed the first.

1. **No rule-made bubbles where the bubble model runs** (`ANALYZE.maxFracSegmented` 0). Plain pages looked at: free text left 4.2% → 2.5%, since the 2 mix-up lines' shapes were rule-made bubbles. But lines touching their outline went 14 → 33, text past its bubble 2 → 14, lines found 765 → 757, bubble outline pixels erased 682 → 936, and one bubble line was left (seed 92). The rules still find bubbles the model misses.
2. **No ink rules after the mask on a region it ran on.** Plain pages looked at: free text left 4.2% → 6.7% (seeds 52, 101, 130), and one bubble line left. On the first 160 real pages, lettering still seen went 9 → 11 lines. Where the mask finds nothing or gives up, the rules still erase lettering.

The rules also remain the whole eraser wherever ONNX Runtime can't run. 4.0 doesn't delete them.

## Decision 3: 4.0.0 ships without its own bubble model (step 3)

The model trained on generated pages did worse on real pages ([ADR 0028](0028-a-bubble-model-of-our-own.md)). Generated bubbles are geometric, with no eyes or faces nearby to tell apart. Training on real pages is ruled out: Manga109-s and the owner's reports are test sets only. The published model stays.

## What 4.0.0 is

The release where the gate holds on held-out pages: lettering still seen on real pages 0.88%, free text 4.3% as the app fills. The parts of the plan that would have made pages worse were measured and kept out. The owner chose to call it 4.0.0 on that basis (29 Nov). The pages are the same as 3.6.0's.

## Not measured, or not solved

- **Coloured lettering in dark gradient bubbles** (webtoon pages, red on purple, say). In grey it has almost no contrast. The rules don't see it as ink, and the mask isn't run on a bubble whose surface reads as plain. 16 of 165 such lines are left on the webtoon pages looked at (AOT). It's not part of 4.0's gate. It's the next thing to measure.
- **LaMa**, the fill on a graphics card, isn't run by the bench. The numbers above are AOT's, the lower of the app's two fills (reasoning: LaMa continues screentone where AOT blurs, ADR 0015).
