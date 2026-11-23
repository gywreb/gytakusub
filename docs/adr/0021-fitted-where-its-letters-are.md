# ADR 0021: A line is fitted where its letters are; the eraser keeps to the lettering's pen

Status: accepted (3.1.0). Date: 2026-11-24. First step of the 3.1 plan (what 3.0 left).

## Context

3.0 left two of its goals unmet, and one regression:

- **Size.** On real pages, 11.1% of lines were set under 0.7 of their size, against 10.3% for 2.14.7. The margin off the outline cost it: the same build with no margin set 7.9% on the pages looked at.
- **Slanted bubbles.** On the new shapes, 1.4% of lines a bubble could hold at 0.7 of their size, keeping clear of the outline, were set smaller; most in slanted bubbles.
- **Art erased beside large lettering.** On one looked-at real page, art damage went from 3.3 to 12.3 per thousand pixels: a title in brush lettering 158 px tall, which the bubble model took for a bubble, was erased with the panel's frame lines, the outline of a cloud and part of a sound effect beside it.

## Decision

1. **Each line is judged over the rows its letters span** (`text.js fitShape`), not its whole line slot. The letters' reach above and below the line's middle is the text's own ink, accents and descenders included, measured as drawLines() draws it. The margin is from the letters' ink to the outline's; judged over the slot, the room's narrowing above a first line's letters and below a last line's also counted against them, about a fifth of the size beyond the margin.
2. **Each line is centred in its own row of the room** (`dx`). `roomShape` gives each row the room left and right of the centre line (`left`, `right`; `half` stays, the nearer of the two). A line takes its row's whole width and stands in its middle, so the lines follow a slanted bubble as a letterer sets them. A line shifted only as far as it had to be (tried first) hugged one side: lines in caption boxes came to touch their border.
3. **The margin off the outline is 3 px at least** (`LAYOUT.edgeMinPx`; it was 2, with 0.15 of a letter above that). Lines now fill their room up to the margin, and at 2 px the margin was the bench's own tolerance for touching: a pixel off in the room put a line on the outline. On the pages looked at, lines touching their outline went 16 → 14 (generated) and 31 → 25 (the new shapes), for real lines under 0.7 of their size 8.40% → 8.48%.
4. **A mark swept up beside a line is its lettering only when drawn with the line's pen** (`erase.js penOf`, `ofPen`). The pen is the thickness most of the line's own ink has (twice the distance transform's peak per mark, the median weighted by ink). A mark beside it, not on its box, that is under 0.35 of that thickness is art: a frame line, a cloud's outline, screentone. A pen under about 6 px judges nothing: dialogue is erased as before. Marks on the line's own box are lettering whatever their pen: applied to them too (tried first), a typeface's thin strokes were left, and lettering left on real pages went from 1.6% to 3.6%.

## Measured

On pages never looked at (held-out halves), 3.0.0 → 3.1.0:

- **Real pages** (Manga109-s, 333 pages, 2,752 lines): lines under 0.7 of their size 11.1% → 8.9%; lines with over 3% of their ink on the outline or the art past it 73 → 72; lettering still seen after erasing 1.66% → 1.69%; art damage 0.115% → 0.098% (no page worse, 70 better); sound effects changed 0.25% → 0.19%.
- **Generated pages** (810 lines; the new shapes, 1,165): under 0.7 of their size 13.7% → 11.7% and 14.8% → 12.4%; lines a bubble could hold at 0.7 set smaller, keeping clear of the outline, 5 → 1 and 16 → 6; in slanted bubbles, under 0.7 8 → 3 of 72; touching their outline 20 → 22 and 28 → 32; text past its bubble 10 → 9 and 11 → 10; lettering left the same; bubble outline pixels erased 1,940 → 1,062 and 3,691 → 2,817.
- **The page the eraser's rule came from** (looked at): art damage 12.3 → 5.4 per thousand pixels (2.15.0: 3.3), no lettering left.

Touching on the pages never looked at is the one number that got worse. On the pages looked at the 3 px margin brought it back (29 → 25, 14 → 14); across both halves, 57 → 57 and 34 → 36.

## Rejected

- **A wider margin in letters** (0.2 of a letter against 0.15): on 86 generated pages, the same sizes and the same lines touching. Most letters on the bench are under 14 px, where the 2 px floor decided, hence decision 3.
- **No outline growth in flat bubbles** (the mask grown by 0.3 of a letter took the art beside large lettering): it left the halo of scanned lettering as a grey ghost; lettering left on real pages went from 1.6% to 1.9%.
- **A bubble's surface as a smooth gradient** (each channel a quadratic in x and y), for the webtoon's dark bubbles: no change on generated dark bubbles. Their lettering is left because the bubble model's mask of a dark bubble is wrong, which the eraser can't mend (on the 3.2 learned mask's list).
