# ADR 0003 — Translations are anchored to the lettering they replace

Status: accepted (2.0.0). Date: 2026-11-08. Refines the layout half of ADR 0001.

## Context

With text detection learned (ADR 0002), the remaining complaints on the
user's pages were about *where* and *how large* a translation lands:

1. In a bubble shaded with screentone or a gradient, the translation was tiny.
   The bubble's "interior" was its flat light region, which on a toned bubble
   is only the bright fragment around the lettering; the text area was fitted
   into that fragment.
2. In a shared bubble, or when a light background (a sky) passed as a bubble,
   translations landed over other speakers' lines or other bubbles. The layout
   cut shared bubbles into horizontal lobes at the narrowest rows and gave a
   single translation the roomiest rectangle anywhere in the shape, so text
   drifted from where the original was.
3. A corner stamp (the number the model reads) can sit next to a neighbouring
   bubble's text; the model then tags that text with the wrong number. In the
   exports, 9 of 437 tagged lines had their box centre inside another detected
   shape than the one they named — all nine were wrong tags, none a drifted box.

## Decision

- **Interior = what the outline encloses.** For light bubbles the interior is
  grown from the light region over everything that is not structural ink
  (components longer than 2.5 letters: outline, tail, art) within a window
  around the shape, then filled. Tone dots, mid-greys and lettering are
  passable. Guards: a result that reaches the window's edge, exceeds three
  times the light area or loses convexity (solidity < 0.5) leaked through a gap
  in the outline and is discarded; the light region stays. Bubble *acceptance*
  is unchanged (same light-region statistics), so no bubble is gained or lost
  by this; only its text area changes.
- **Anchored placement.** Each translation in a bubble is matched to the
  lettering it replaces: a lone translation to all of the bubble's lettering;
  in a shared bubble, to the block its box overlaps most (members without a box
  take the unclaimed blocks in reading order). Specks — blocks with letters
  under half the bubble's letter size or a tenth of the largest block's area,
  typically a row of tone dots read as a 4 px line — are never anchors. The
  rectangle is the largest one inside the interior that contains the anchor's
  centre, is centred within the anchor's own extent (or 1.5 letters / 15% of
  the bubble, whichever is more), and avoids: the other members' blocks,
  everything past the cut between two members (the shape's waist when it is
  clearly narrower there, else midway between the blocks; rows for stacked
  members, columns for side-by-side ones), and smaller regions lying inside
  the shape. Fallbacks in order: unanchored with the same exclusions,
  unanchored, 78% of the box.
- **Invariant: never less room than the original.** Whatever rectangle the
  above produces is widened to include the lettering it replaces. That area is
  erased and lies inside the bubble by definition, so the translation can never
  come out smaller than the original for lack of space — regardless of what
  the shape analysis got wrong. This is the guard that makes the rest safe to
  tune.
- **Interior leaks.** Structural ink is thickened by a pixel or two before the
  flood (hairline gaps), and the flooded mask is opened by about a sixty-fifth
  of the page width — an open tail tip is ~10 px wide at 850 px, a bubble body
  never is — keeping what the light region touches. Only a leak wider than
  that falls back to the light region.
- **Tag versus box.** A tag is still authoritative — except when the model's
  box centre lies outside the stamped region and inside another region's
  shape, in which case the text goes to that region. An untrusted tag falls
  back to the box like an untagged item (nearest region, smaller region on a
  tie) instead of a halo placement.

## Evidence (twelve exports, 230 distinct real pages, `tests/layout-score.mjs`)

Three states: 1.1 as the user tested it on 2026-11-08 afternoon (roomiest
rectangle), the first anchored cut pushed that evening (regressed), and this
decision. "Rendered size" is the font size the page-side fitter actually
chooses, relative to the original letter height.

| | roomiest rect | first anchored cut | this ADR |
|---|---|---|---|
| rendered size / original: median | 0.98 | 0.99 | **1.07** |
| rendered size / original: 10th percentile | 0.60 | 0.60 | **0.71** |
| translations rendered below 0.7× the original | 254 (15.3%) | 276 (16.7%) | **158 (9.5%)** |
| words broken letter by letter | 68 | 67 | **37** (all on credits pages) |
| translation over its own lettering | 85.9% | 92.3% | **96.1%** |
| rectangle at least as large as the lettering's box | 72.9% | 83.5% | **95.8%** |
| shared bubbles: every line over its own lettering | 68.8% | 80.4% | **89.1%** |
| rectangles narrower than 3 letters | 201 | 157 | **137** |
| translations overlapping lettering that was not erased | 84 | 64 | 91 |
| analysis time per page | 2.05 s | 2.07 s | 2.27 s |

The one metric that rose, overlap with un-erased lettering, is the price of
larger rectangles: the overlapped blocks are sound effects and specks beside
the text, not another speaker's line (checked case by case; the shared-bubble
row is the measure of that). Note that the first cut improved every geometric
proxy while making the rendered outcome worse — the reason the rendered-size
rows now exist and gate every change.

The synthetic corpus (100 assertions) passes unchanged; the joined-bubble
assertion (two stacked, non-overlapping areas) holds through the new cut rule.

## Consequences

- A translation now stays near its original even when the bubble has room
  elsewhere; letterers do the same. Text size is unchanged in principle (the
  cap is still 1.3× the original letter height); it grows where the old
  interior was a fragment.
- A false "bubble" that contains real bubbles (a bright sky) still receives
  the lines whose text it holds, but each line is placed around its own
  lettering, so the failure is cosmetic rather than destructive.
- Stamps stay at the region corner; moving them inside the bubble was
  considered and deferred (it changes what the model sees on every page and
  cannot be A/B-measured offline).

## What went wrong on the first cut, and the rule that came out of it

The first version of this layout (pushed 2026-11-08 evening) anchored to the
single block the model's box overlapped most and capped the rectangle at a
few times the anchor's size. On the next real chapter the anchor sometimes
locked onto a speck next to the real text, and the cap then produced
rectangles of a few letters: text came out tiny, and one shout was broken
letter by letter ("er-e yo-u ar-e!"). The offline score said the change was
an improvement, because it measured *position* ("rectangle over the detected
lettering" — a speck counts) and not the thing the reader sees.

Rule from this: every layout change is gated on the rendered outcome on the
user's exported pages — font size relative to the original letter height
(median, 10th percentile, share below 0.7), words broken letter by letter,
whole-word overflow — not on geometric proxies alone (`tests/layout-score.mjs`
reports both). And behaviour that must hold is written as an invariant
(above), not tuned.

## Next step beyond geometry

The hand-written part that remains weakest is "what is a bubble and what does
it enclose". Open-source manga translators (Koharu, manga-image-translator)
answer that with a learned instance-segmentation model that returns balloon
polygons, dialogue text and onomatopoeia in one pass (e.g. Koharu's YOLO26-s
layout model, ~40 MB ONNX, Apache-2.0 training data; Manga109-trained models
are research-only and excluded). Running it needs ONNX Runtime Web (OpenCV
4.5's dnn cannot run YOLO segmentation heads) and a first-run model download
with caching rather than a 40 MB store package. Planned for 1.2, measured the
same way before any switch.
