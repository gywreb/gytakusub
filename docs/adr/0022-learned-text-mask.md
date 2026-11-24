# ADR 0022: A learned text mask finds the lettering the rules can't see whole

Status: accepted (3.2.0). Date: 2026-11-24. Second step of the 3.x plan: the learned mask, behind a setting that is off by default.

## Context

The eraser finds lettering by rules (ADR 0013, 0014, 0021): ink of the line's polarity in a window round each detected line, whatever stands out in colour from a plain surround, and marks drawn with the line's pen. Where the surround isn't plain, the rules see only part of the lettering, or none:

- **free text over art**: on generated pages 3.1 left 22–25% of free-text lines untouched (pages never looked at);
- **the webtoon's dark bubbles**, filled with a gradient and lettered in red or white: 18.5% of the webtoon lines kept their lettering (3.1, ADR 0021's bench cases). The bubble model's mask of such a bubble is wrong, which the eraser couldn't mend;
- **white lettering on a dark ground**, and lettering with a halo over tone.

The goal set for 3.2: free-text lettering left at least halved, the webtoon's dark bubbles erased, real pages no worse, within a size and speed budget.

## Decision

1. **A text-mask model, behind a setting** ("Learned text mask (preview)", off by default, in the extension's options and the web app's settings). The model is comic-text-mask (TareHimself, MIT), a U-Net on a ResNet-18 trained to say, per pixel of a detector's text crop, whether it is lettering. It is rebuilt from its published weights into ONNX by `scripts/textmask-onnx.py` (batch normalisation folded, float16 weights computed in float32; 28.7 MB) and vendored at a pinned revision with its checksum (`scripts/vendor-textmask.mjs`, `vendor/textmask.json`). It runs on the graphics card where there is one, and its mask there is the CPU's (`gpu.test.mjs`).
2. **It runs where the rules are weak**: on free text, and on bubbles whose surface isn't plain (`erase.js plainBubble`: the interior away from the lettering not nearly one colour). A plain bubble keeps the rules, which find its lettering whole by polarity and by colour.
3. **One crop per region, run as the authors run theirs** (`engine/textmask.js`): round a bubble's lines (its blocks and the detector's lines in it) or a free text's paragraph, padded by half a letter, scaled to 384 on its long side and letterboxed into 384 × 384.
4. **The eraser takes the model's mask in place of its rules** for such a region, checked against what lettering is:
   - only pieces of it (connected) that reach into the region's lines (its blocks' boxes and the detector's lines in the crop), as the rules keep to marks reaching into the lettering's zone: along a dark bubble's edge the model sees a ring of lettering, away from the lines;
   - in a bubble, only inside the interior, and never the bubble's outline where the interior takes it in;
   - none of it, and the rules instead, when it took a shape for lettering: when in a bubble it calls most of the interior lettering (`ERASE.modelBubbleShare` 0.5), or when a piece on the lines is thicker than 1.5 times the detector's lines there are high (`ERASE.modelThickLines`). Lettering never fills its bubble, and a stroke of it, outline and all, lies about within its line's box; the model takes a small dark bubble whole for a glyph;
   - no outline growth (ADR 0013's 0.3 of a letter): the model's mask holds a lettering's outline whole (white round black, dark round white, 4 to 12 px: `textmask.test.mjs`). Grown by a letter size the analysis got wrong, the area spread over the art beside it;
   - in a bubble, the fringe growth (3 px) keeps off the outline too.
5. **When**: the mask is made while Claude reads the page (the prefill), for every region. At the finish, a region is masked again when its crop has changed (the layout adopts lines into a region, looking again finds more: a mask kept from before would leave their lettering, the rules being skipped there), and so is a region the layout adds (`textmask.js masksFor`). The debug report has the mask's time and where it ran (`timing.textMask`).

## Measured

On pages never looked at (held-out halves), 3.1.0 against 3.2.0 with the setting on. With it off, 3.2.0 erases as 3.1.0 does (the same rows on the bench). Text sizes, placement and the lines found don't change.

- **Real pages** (Manga109-s, 333 pages, 2,752 lines): lettering the independent detector still sees 1.69% → 1.06% (more on 7 pages, less on 20); art damage 0.098% → 0.045% (worse on 8 pages, better on 55); sound effects changed 0.19% → 0.16%.
- **Generated pages** (810 lines): free-text lines left untouched 34 of 139 (24.5%) → 15 (10.8%); all lines 5.2% → 2.7%; art damage 0.051% → 0.020%; bubble outline pixels erased 1,062 → 950.
- **The new shapes** (1,165 lines): free-text lines left untouched 22.3% → 10.1%; art damage 0.054% → 0.025%; bubble outline pixels erased 2,817 → 1,437.
- **Webtoon pages** (789 lines): lines left untouched 18.5% → 5.6% (in dark bubbles 59.5% → 15.6%, in the other bubbles 4.7% → 1.9%, free text 20.5% → 8.0%); art damage 0.053% → 0.048%; bubble outline pixels erased 2,635 → 5,026.
- **Time**, on one CPU thread (the bench's): the mask's median per page 4.2 s on real pages (the rest of the engine: 4.5 s), 6.7 s on webtoon pages and on the new shapes; one page in ten over 10.9 s and 12.0 s; the most 21.7 s and 30.5 s. On a graphics card the mask is the CPU's (`gpu.test.mjs`, on a software GPU, which says nothing of speed).
- **Size**: 28.7 MB; the extension is about 220 MB unpacked.

On the pages looked at, the same: real 1.71% → 1.12% still seen, damage 0.083% → 0.030%; generated free text 26.1% → 13.4% untouched; webtoon 18.0% → 6.3%, outline pixels 1,649 → 4,171.

**Not fixed: outlines on the webtoon pages.** The bubble model misses many dark bubbles. Read as free text, they have no interior to keep the mask inside, and where a dark bubble meets its outline the model sees lettering on the lines' ends. A small dark bubble the bubble model misses can be erased whole, the thickness check not catching it. Finding those bubbles is the comic detector's work (3.3); then the interior and outline checks above apply to them.

The setting stays off by default: its cost on a CPU is about the rest of the engine's again, and the outline cost on dark bubbles waits on 3.3.

## Rejected

- **Each crop at its own size** (scaled down only past 384): a fraction of the time, but the model took the whole of a dark bubble lettered 11 px tall for lettering. On 37 webtoon pages looked at, bubble outline pixels erased: 405 (3.1), 8,783 at its own size, 2,987 letterboxed; art damage, summed over the pages in pixels per thousand: 25.7, 42.4, 23.4.
- **A crop per line of free text**: the model ran five times for one paragraph.
- **The outline growth** (ADR 0013) on the model's mask: on a dark bubble read as free text 53 px tall (its letters were 21), the mask grew 16 px past the lettering, onto the art. On 72 webtoon pages looked at, art damage summed: 195.7 with it, 71.4 without (3.1: 40.0).
- **Pieces that run out of their crop dropped** (as the rules drop marks that leave their window), **with the thickness check at the lines' height** (1 rather than 1.5): on 60 real pages looked at, lettering still seen went from 1.46% (3.1) to 3.12%. On one page, 6,516 of a crop's 6,763 mask pixels lay in pieces touching its edge, and a piece 20.5 px thick lay on a line 20 px high. Without the first and at 1.5, on 50 of those pages: 0.48% (3.1: 1.19%).
- **No thickness check, and in a bubble the lines' boxes kept past the interior** (as the rules take a line's ink in its window): at 1.5 the check still takes two- and three-line free text, whose lines' outlines the mask joins into one piece, for a shape (68.6 px on lines 32 px high), and it doesn't catch the small dark bubble it is for (a piece between 48 and 72 px thick, on a line the detector boxed 48 px high); and a bubble the bubble model drew over three of six lines of free text kept the other three. Tried on 62 generated and 49 webtoon pages looked at: free-text lines left 9 against 8, webtoon lines left 24 against 25, and outline pixels erased 491 against 280 and 2,863 against 2,311. That small dark bubble, and the lines past a bubble drawn too small, are the bubble model's to find (the next step, 3.3).
