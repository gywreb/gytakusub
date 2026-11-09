# ADR 0005 — PP-OCRv6 text detector; vertical Japanese as a first-class layout

Status: accepted (2.0.0). Date: 2026-11-09. Replaces the model chosen in ADR 0002;
the rest of that decision (a learned detector for lines, geometry for the rest)
stands.

## Context

The owner's test of a Japanese raw chapter (One Piece 1197 on rawkuma, 9 pages,
plus an earlier export of Isekai Merchant 28.2, 19 pages) came back with two
complaints: translations far too small, and the original lettering left on the
page under or beside them. English and Spanish chapters, read the same day,
were fine.

What the debug exports showed, page 7 of One Piece as the example:

1. **The detector did not see vertical Japanese.** PP-OCRv4 (trained mostly on
   horizontal Chinese and English) returned 42 boxes on the page, most of them
   single kana or fragments; whole columns of dialogue, and all of the
   narration set on the art, had no box. Nothing undetected is erased, and the
   size of a bubble's translation came from whatever fragment had been found —
   often a column of furigana, half the size of the text. Hence the 5 px
   translations next to unerased originals.
2. **Boxes were shifted right**, by up to about 2% of the page width
   (engine/detect.js). The page is resized for the model to multiples of 32 on
   each axis, so the two axes have different scales; boxes were mapped back
   with one. On Latin rows the snapping to the ink mostly hid it; on a column
   it put the box between two columns.
3. **Ruby (furigana) counted as lettering.** A column of kana half as wide as
   the kanji it reads sits beside most dialogue. As lines of their own they
   set the size estimate to half the real one and, as the page's "typical
   column", got real columns split in two (and their glyphs, cut by the split,
   survived the eraser).
4. **The column width was measured with the row recipe.** The letter size of a
   Latin line is the dense band of its ink profile; across a CJK column the
   profile is dominated by whatever stroke runs down the middle (a long vowel
   mark, a run of dots), so the band came out a third of the glyph width.

## Decision

- **PaddleOCR PP-OCRv6_small text detector** (released June 2026, Apache-2.0,
  2.5 M parameters, 9.9 MB), PaddlePaddle's own ONNX export from a pinned
  Hugging Face revision. Same DB output as v4, so the pipeline around it is
  unchanged; PaddleOCR reports Japanese detection 82.3 vs 72.7 (v5 mobile) and
  large gains on rotated and vertical text. `scripts/vendor-detector.mjs`
  rewrites four op types so that OpenCV 4.5's dnn (the fallback when ONNX
  Runtime fails) can run the same file; only the Erf rewrite is approximate
  (≤ 0.003 on the probability map). CI downloads the pinned file and checks
  the vendored one is what the script makes of it.
- **Per-axis scale** when mapping boxes back to the page.
- **Ruby is part of the column it reads**: a column at most 0.7× (and at least
  0.3×) the size of a neighbouring column, against its side and within its
  length, joins it — erased and stamped with it, but not counted in its size.
  Only beside columns: a small horizontal line beside large lettering is a
  line of its own.
- **Column glyph width** from the ink profile across the column, counting only
  marks wholly inside the detector's box (hatching, tone and a neighbour's
  strokes cross its edges), as the run of columns holding any real share of it.
- **Sizes are voted by glyphs, and dots are not glyphs**: a bubble's letter
  size is the glyph-weighted median of its paragraphs (a speck beside the text
  no longer sets it); a column of "……！！" counts the page's column pitch, not
  one glyph per dot; a bubble that holds only marks takes the page's letter
  size for its translation ("..." at the size of the dialogue).
- **A sound effect never joins dialogue**: with the segmentation model's
  masks, lines merge into a paragraph only within the same bubble.
- **Free text set in columns** gets a placement wide enough for rows: widened
  about its centre to 0.6 of its height, as far as the other regions allow.
- **The eraser judges a mark by its size across the line**, not along it: a
  wave dash or long vowel mark in a column is a long mark and still lettering.
- **A second look inside dark bubbles.** At 960 px v6 small misses some small
  white lettering on black that v4 found (one of the synthetic test pages), and
  the bubble model is trained on light bubbles, so nothing else looks there. A
  dark shape that is bubble-like (compact, convex, at most 6% of the page),
  holds a little light ink and no detected line has its crop detected again
  at up to twice the resolution — the same second look the bubble model's
  empty bubbles already get. A larger input for the whole page was measured
  instead and rejected: at 1056 px coverage of Latin pages fell from 97.0% to
  90.8% (why was not investigated; 960 px was also PaddleOCR 2.x's default limit).

PP-OCRv6 also finds text v4 never reported: sound effects, signs, page numbers
— and, now and then, a shape read as a glyph (a round face with two eyes is an
"ö"). Three rules keep those out of the bubbles, each stated in terms of
lettering rather than of the cases seen:

- lettering is drawn in strokes: a "line" whose glyph-sized marks are mostly
  solid blobs (half a letter across, solid to the middle, not bars) is not
  lettering;
- a "line" filling a closed shape edge to edge with at most two marks inside
  is the shape itself (a caption or a sign filled by its text has many);
- dialogue in a bubble found by the light-region rules is not drawn at more
  than 2.5× the page's dialogue size (the bound loose text already had).

## Evidence

Measured offline on the owner's debug exports (`tests/score-reports.mjs`,
`tests/layout-score.mjs`): the model's own answer is the witness of where text
is; "lettering left" is the dark pixels left, after erasing, inside each of the
model's boxes for the source text (boxes also hold outline or art, so it never
reaches zero; credit and logo pages account for about a dozen of the Japanese
items "mostly left").

Before = this branch with PP-OCRv4 (bubble model already in); after = this ADR.

**Japanese raws** (2 exports, 28 pages; layout over the 21 pages with items)

| | before | after |
|---|---|---|
| dialogue recognised as a bubble (by text) | 94.3% (91.5%) | **98.4% (98.8%)** |
| coverage | 88.5% | 90.5% |
| original lettering left in the model's boxes (mean per item) | 34.8% | **21.8%** |
| items with most of their lettering left | 47 / 143 | **27 / 143** |
| translation size, px on a 1000 px-wide page: median / 10th percentile | 26.5 / 11.9 | **31.1 / 19.9** |
| translations under 12 px | 12.9% | **2.1%** |
| translations over lettering left unerased | 11 | 12 |
| unused regions per page | 1.43 | 2.21 |
| analysis per page (Node, CPU wasm, two jobs in parallel) | 2.5 s | 3.2 s |

**Latin-script scanlations** (Spanish and English, 11 exports, 242 pages; layout over 223)

| | before | after |
|---|---|---|
| coverage | 95.6% | **97.0%** |
| dialogue recognised as a bubble (by text) | 98.1% (99.5%) | 98.4% (99.5%) |
| original lettering left (mean per item) / items with most left | 25.9% / 18.0% | 26.0% / 17.3% |
| translation size px: median / 10th percentile / under 12 px | 22.4 / 17.3 / 3.0% | 22.4 / 16.5 / 2.3% |
| rendered below 0.7× the original letter | 8.5% | 9.2% |
| words broken letter by letter | 40 | **10** |
| lines hyphenated | 48 | 133 |
| translations over lettering left unerased | 37 | 33 |
| shared bubbles: each translation over its own line | 82.2% | 79.8% |
| unused regions per page | 0.73 | 1.17 |
| analysis per page (as above) | 2.7 s | 2.9 s |

The Latin pages trade a little: more lines hyphenated (where words used to
be broken letter by letter), a 10th-percentile size 0.8 px smaller, and two
shared bubbles in a hundred whose translations no longer each sit over their
own line. Bubble letter sizes are the same as before on these pages (the
median ratio of matched bubbles is 1.00); the differences come from the line
geometry the new detector returns.

## Alternatives considered

- **PP-OCRv6 tiny** (1.8 MB, as fast as v4): close on Japanese, but on the
  Latin pages it lost coverage (91.1% at 960 px, 92.8% at 1152 px, against
  95.6% for v4).
- **PP-OCRv6 medium** (62 MB, about 5× slower than small on the CPU): on the
  two pages compared it found nothing small missed and added specks; not
  measured further at that cost.
- **PP-OCRv5 mobile** (4.7 MB): finds the columns too (checked on one page);
  PaddleOCR's own benchmark puts it well behind v6 small, and it was not
  measured further.
- **comic-text-detector** (manga-image-translator, BallonsTranslator, Koharu;
  GPL-3.0): trained on manga and also gives a text mask, but three networks
  and ~80 MB, and its YOLOv5 block head would replace the line-level pipeline
  rather than slot into it.
- **ogkalu/comic-text-and-bubble-detector** (RT-DETR-v2, Apache-2.0, 11–44 MB
  int8): boxes for text inside and outside bubbles, trained on 11k comic pages
  of unstated provenance; boxes only, so the line geometry the layout and the
  eraser rely on would have to be rebuilt.

## Consequences

- Package +5.2 MB (detector 4.7 → 9.9 MB). Text detection on the CPU (wasm,
  one thread) 0.52 → 0.84 s per page; on WebGPU the difference is small.
- More regions are stamped that the model leaves untranslated (sound effects,
  signs): the cost is prompt tokens and a busier marked image.
- Known limitations: narration set in columns over hatching or screentone is
  erased by inpainting, which leaves a visible smudge; a translation that
  shares a bubble with others can still be squeezed into a narrow column when
  the model's box for it is small; credit pages and site logos are often left
  as they are.
