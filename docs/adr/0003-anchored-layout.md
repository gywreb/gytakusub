# ADR 0003 — Translations are anchored to the lettering they replace

Status: accepted (1.1.0). Date: 2026-11-08. Refines the layout half of ADR 0001.

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
- **Anchored placement.** Each translation in a bubble is matched to the text
  block it replaces (the block its box overlaps most; members without a box
  take the unclaimed blocks in reading order). Its rectangle is the largest one
  inside the interior that contains that block's centre, is centred within the
  block's own extent (or 1.5 letters of its centre), and avoids: the other
  members' blocks, everything past the cut between two members (the shape's
  waist when it is clearly narrower there, else midway between the blocks;
  rows for stacked members, columns for side-by-side ones), and smaller
  regions lying inside the shape. Fallbacks in order: unanchored with the same
  exclusions, unanchored, 78% of the box.
- **Tag versus box.** A tag is still authoritative — except when the model's
  box centre lies outside the stamped region and inside another region's
  shape, in which case the text goes to that region. An untrusted tag falls
  back to the box like an untagged item (nearest region, smaller region on a
  tie) instead of a halo placement.

## Evidence (ten exports, 185 distinct real pages, `tests/layout-score.mjs`)

| | before | after |
|---|---|---|
| translation over its own lettering | 86.1% | 92.8% |
| rectangle at least as large as the lettering's box | 73.9% | 84.0% |
| shared bubbles: every line over its own lettering | 68.8% | 81.4% |
| translations covering lettering that was not erased | 71 | 54 |
| rectangles narrower than 3 letters | 160 | 124 |
| rectangle centre outside the bubble shape | 1 | 0 |
| lines placed by halo (no region) | 160 | 146 |
| mean rectangle area / bubble light area | 56% | 53% (by design: proportionate to the lettering) |
| analysis time per page | 2.11 s | 2.13 s |

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
