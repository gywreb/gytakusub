# 0027. A translated line's box, erased where the mask finds lettering

Status: accepted (3.5.0)

## Context

4.0's second step (roadmap, "4.0: the plan") breaks down what the learned text mask still leaves, on pages looked at, and fixes the largest cause.

On the 150 plain generated pages looked at, with 3.4.0's engine, 16 free-text lines were left untouched. For 6 of them, nothing found lay under the box of the line Claude translated: no region, no line the detector or the second look found, no lettering the analysis had set aside. The mask is only run on regions, so it never looked there. For the other 10, some lettering was found, but not all of it was erased. That's the next cause to break down.

On the 100 webtoon pages looked at, 31 lines in dark bubbles were left untouched. Most were in bubbles the bubble model missed, with their lettering not found either.

Claude read a line there, and the mask is a witness of its own: it finds which pixels are lettering. The rules can't be used that way. On busy art they would take any stroke inside the box for lettering.

## Decision

1. **With the learned text mask on, a translated line's box that holds nothing found becomes a region to erase** (`layout.js adoptLettering`, `fromBox`). This applies to a line with no mark, or with a bubble's mark its box shows was misread (a shout drawn beside the bubble). It doesn't apply to a box mostly inside some region already, or to a box smaller than a letter.
2. **Only what the mask finds there is erased, never the rules** (`erase.js`). A piece of the mask counts only when at least half of it lies inside the box (`ERASE.readerBoxShare`). A piece mostly outside it is what borders the lettering: the outline of a bubble the bubble model missed, or a stroke of art. A piece mostly inside is kept whole, since a reader's box may stop short of its line. When the mask finds nothing, nothing is erased.
3. **The region is erased only.** The line is placed as it would be without it (its box, or the region nearest it). A first version also placed the line into the box. On the webtoon pages looked at, that set larger text in narrow dark bubbles and 4 more lines touched their outline. Placing those lines better is a separate change, with its own gate.
4. **With the mask off, nothing changes.**

On the pages looked at, the share rule replaced a first try that kept the mask only near the box. That try still erased part of a burst's outline on one page (149 outline pixels) and 26 on a webtoon page. The share rule left both outlines as they were.

## Measured

Against 3.4.0 (the mask on), on pages never looked at:

| Pages | Lines | Lines left untouched | Free text left untouched | Dark-bubble lines left untouched | Art damage | Bubble outline pixels erased |
|---|---|---|---|---|---|---|
| Generated | 810 | 22 → 19 | 15 → 12 (10.8% → 8.6%) | — | +0.6% (3 pages) | 950 → 950 |
| Webtoon | 789 | 44 → 28 | 7 → 6 | 27 → 14 (15.6% → 8.1%) | +0.8% (4 pages) | 5,026 → 5,043 (2 pages) |
| The new shapes | 1,165 | 21 → 19 | 14 → 12 | — | +0.2% (3 pages) | 1,437 → 1,437 |
| Lettering at the image's cut | 979 | 31 → 26 | 15 → 12 | — | +0.6% (2 pages) | 1,779 → 1,779 |
| Real pages (2,839 lines the witness reads) | 2,752 | lettering still seen 31 → 24 (1.09% → 0.85%) | — | — | 0.0448% → 0.0456% (+1.9%, 6 pages) | — |

No held-out page has more lines left untouched, or more lettering still seen. Sizes, text past its bubble, lines touching their outline and sound effects changed (real pages) are the same on every page. Bubble outlines: the same on every set but the webtoon pages, 17 pixels more on 2 pages.

On real pages, lettering still seen is now under 4.0's 1% (0.85%). Free text left on generated pages is 8.6% on three of the four sets, against 4.0's 5%.

**Art damage rises only where a line is newly erased.** Every erased line costs some: the fill can't redraw the art under the lettering. On generated pages the bench gives each changed pixel to the nearest line (`synth-run.mjs --line-damage`; pages never looked at):

| | Lines erased | Damage pixels a line |
|---|---|---|
| Free text, erased as in 3.4 | 454 | 184–203 (by set) |
| Free text, erased from the box alone | 9 | 50–232 (by set), 97 on average |
| Bubble lines, erased as in 3.4 | 3,170 | 14–52 (by set; 52 on webtoon pages) |
| Bubble lines, erased from the box alone | 18 | 0–14 |

A line erased from its box costs about what any other erased line costs. The gate's "nothing else worse" is read that way: art damage per erased line no worse, not the page's total. More lines erased means more fill.

**Real pages looked at** (321 pages, the researchers' boxes): lettering still seen 31 → 27 lines. Art damage rose 0.8% (8 pages, most by a few pixels) and sound effects changed 1% (2 pages). Lettering still seen rose on one page. On one page a box held hand-drawn lettering over a drawing of a band. The mask took strokes of the drawing with the lettering, and the fill smeared it. A guard that would have kept that page and not lost lines elsewhere wasn't found. The mask's share of the box and the thickness of its pieces overlapped between the pages it helped and that one. A rule for one page would be fitting to it, so none was added.

## Not measured

- **Fills here are Telea's**, as everywhere on the bench (docs/QUALITY.md, "Limits"). Over hatching it leaves a smooth grey. The extension fills with AOT on the CPU and LaMa on a graphics card, which do better over texture, so the damage of the newly erased lines is likely lower in use. That is reasoning, not measured here.
- **Real readers' boxes.** The generated pages' answers have their boxes moved by up to 15% (one in ten by up to 40%), as the bench simulates Claude; the real pages' are the researchers' boxes. A box that drifts onto art away from its line lets the mask's false finds there through. The owner's reports remain the final check.
