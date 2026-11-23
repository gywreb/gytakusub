# ADR 0019: Text stays in its room, at the lettering's size

Status: accepted (2.15.0). Date: 2026-11-22. Part of the 3.0 plan (a robust core).

## Context

The owner's French chapter (MangaDex, 2.14.7) showed translations crossing the borders they belong
inside, and sizes the lettering never had:

- **Page 6:** two caption boxes drawn as one L-shaped caption. The analysis merged both captions'
  lines into one paragraph, the layout cut that paragraph across its rows, and each translation
  spread over both boxes and past them.
- **Page 9:** a two-lobe bubble. One translation ran past the bottom curve, and the two lines came
  out at 31 and 20 px where the letterer used one size.
- **Page 20:** a narrow bubble's text ran past its top and bottom, a slanted bubble's text crossed
  the slant, and "HA HA HA!" came out 1.3 × too large.

The Korean reports (Naver) showed the other side: Korean set smaller than it was drawn.

Four causes:

1. **The room ran past the outline.** Since 2026-11-08 (commit dc2896b), a translation's box was grown to cover
   the whole box of the lettering it replaces, so that the text never came out smaller than the
   original. An upright box around lettering in a curved or slanted bubble has corners past the
   outline. The fitter took the box's fit whenever it was larger than the shape's.
2. **One region, two rooms.** The bubble model gives one mask for two caption boxes drawn together,
   and the analysis may merge their lettering into one paragraph. The region was cut between
   speakers only by a row or a column midway between them.
3. **The last-resort fit ignored height.** When nothing fitted at the size floor, words were allowed
   to run 30% past the box's sides, and any number of lines past its top and bottom.
4. **Two letter sizes were wrong.**
   - Claude's size label ("large") scaled a size already measured on the lettering, so the scaling
     happened twice.
   - The letter size of a row is the band of rows holding ≥30% of the peak row's ink, × 1.15. A
     Hangul syllable's lower part (a final consonant, a vowel's stem) is a few thin strokes, so the
     band stopped above it. On generated pages it measured 0.88 of the syllables' height (median),
     and 0.67 or less on one line in seven.

## Decision

1. **The room is the interior and the lettering's holes in it, never past the outline**
   (`layout.js`). A lettering box counts as room only where the interior encloses it (`holesOf`):
   not where its corners lie past a curved side, nor between a burst's spikes or in a cloud's notch.
   - A bubble whose interior holds less than 85% of its lettering is doubted. This is light art
     taken for a bubble around text drawn over the art, and its lettering's boxes stay room whole,
     as before.
     It has no shape: the text is fitted to the box. The art's lines around it are no outline, and
     read as one (the margin off the ink, below), they set text over art at half its size.
   - The 85% is judged on the lettering's lines, not the block's upright box: in a slanted bubble
     the box's corners lie past the slant, and judged on it, such bubbles were doubted and their
     text set across the slant (2 lines past their bubble on generated look pages, 0 judged on the
     lines).
2. **A region's ink divides it among its lines** (`roomParts`). Each line's part is what its
   lettering reaches without crossing ink, plus the ink it encloses, such as marks past its line
   boxes. A line's room leaves out what is in another line's part and not in its own.
   - A border between two caption boxes runs to the outline, so it divides them.
   - What no line reaches (the outline's inner edge inside the bubble model's mask) stays in every
     room. A first version made each line's room its part alone, and lost that edge from every
     bubble: on 20 generated pages, 53 lines came out under 0.7 of their size instead of 36.
   - When the parts together leave out more than 40% of the region (tone, speed lines), the region
     stays one room. A bubble with one line is never divided.
3. **A paragraph several lines share is divided by their boxes, line by line** (`shareBlocks`).
   When each of its lines lies under one line's box, each line takes its own lines. Otherwise the
   paragraph is cut midway between the boxes, as before.
   - A block the analysis merged from several paragraphs (two captions' lettering in one L-shaped
     region) is split into its paragraphs when as many items share it: a line belongs with the one
     before it when the gap is under a line's height and they overlap across half the narrower one
     (`paragraphs`). Each item takes the whole paragraph its box overlaps most, one each. Claude's box
     for a caption can cover its first line only, and split line by line by the boxes, the caption's
     other lines went to the next item (page 6 in the owner's browser: its text at 16 px). Where the
     paragraphs don't pair with the items, the lines are shared by the boxes as before.
4. **The fitter sets text to the shape, and to the box only where it stays in the room.**
   - The box's fit is used when it is larger and at most 3% of its letters lie within the shape's
     margin or past it (the shape is read on the ink, below). Each line's letters are its width by the middle 0.8 of its
     size. The bubble model's mask is smooth and reaches past a burst's outline, so judged on the
     mask, such fits crossed the outline: on 18 generated pages, 6 lines past their bubble, and 2
     judged on the ink.
   - The last-resort fit may run past the sides, never past the top and bottom.
   - One margin keeps text off the outline: 0.15 letters from the outline's ink, in the shape. Before,
     a fifth of the size came off each side on top of 0.2 letters, and lines a bubble could hold at
     0.7 of their size came out smaller.
   - The margin is measured from the ink, where the region's ink parts are known, not from the
     bubble model's mask. On the owner's French chapter the mask reached past the ink by 0.13 letters
     (median), and by more than 0.3 letters on one row in seven, so lines set 0.3 letters off the
     mask came within 1–2 px of a caption's border. The box's fit must keep the margin too, not
     only stay inside the outline. Lines within a tenth of a letter of their outline ("touch", on
     generated look pages): 56 of 686 before, 18 after; lines set under 0.7 of their size: 93
     before, 99 after. Read on a doubted room too, the margin cost 6 more lines under 0.7 (art's
     lines taken for an outline), so a doubted room has no shape (decision 1). 0.2 letters from the
     ink cost 7 more small lines than 0.15, with 12 touching. A mask margin with a floor off the ink
     (0.3 off the mask, never within 0.15 of the ink) is narrower than either on every row, and was
     dropped.
5. **The text is tried centred on the lettering, too.** When the room's box is far from the
   lettering's centre (the wide middle of an L-shaped caption), the room centred on the lettering is
   offered as well, and the text takes whichever fits it larger.
   - Within its room, a block stays centred on the lettering when it fits there. Otherwise it goes
     where its narrowest row is widest, nearest the lettering's centre on a tie (`fitShape`). Page
     6's middle captions, whose room narrowed under the lettering: 17 and 20 px before, 26 and 29.
   - A room keeps its own centre line and top (`roomShape` returns `cx`, `top`), and the fit, the
     drawing and the outside measure use them. Overlapping boxes are trimmed apart (`separate`) after
     their rooms are read, and text centred on the trimmed box sat up to 8 px off its room on page 6,
     against a caption's border.
   - A line may end after a hyphen between letters, no hyphen added, with 3 letters at least on each
     side as for a hyphenation point (`compound`). Page 9's right lobe held "remote-controlled" on
     one line only at 19 px.
6. **The lines of one bubble keep within 20% of each other's size**, when their lettering was one
   size (within 20%): a larger fit is cut to 1.2 × the smallest, but never under 0.7 of the line's own
   lettering. A line peeked at is still fitted, so its bubble's other lines keep their size.
   - All at the smallest size (a first version) set 11 more lines of 456 under 0.7 on real look
     pages; within 20%, 3 more.
   - Page 9's bubble: 31 and 20 px before, now within 20%.
7. **Letter sizes:**
   - Claude's size label scales only a size guessed for the page.
   - Lettering Claude read as Hangul is set at its syllables' height. That height is the band of
     rows holding ≥10% of the peak, counting letter-sized marks only (a caption box's side runs down
     every row), with no 1.15. On the same 94 generated lines it measures 0.95 (median), none under
     0.7.
8. **The debug report records each line's share outside its room** ("outside its room"), so a report
   shows text past its bubble without anyone having to spot it.

## Consequences

- The generator has the shapes that broke: overlapping captions, two-lobe bubbles, slanted and narrow
  bubbles (`synth.mjs --readers`). The bench counts each shape's lines, overflow, small and oversize.
- The trade is measured, not assumed. Text kept inside the outline has less room, so some lines come
  out smaller. CHANGELOG 2.15.0 gives the numbers on held-out pages.
- What this does not do:
  - A line whose translation is much longer than its lettering still comes out small in a small
    bubble. That limit is geometry, and the bench reports it separately ("geometry").
  - Korean lettering whose rows nearly touch, in a line box the detector drew over two of them, can
    still measure two rows (4 lines in 94 over 1.3×).
