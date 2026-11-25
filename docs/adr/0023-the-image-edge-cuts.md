# 0023. The image's edge cuts lettering; it bounds nothing

Status: accepted (3.2.0 where the learned mask erases, ADR 0022; 3.2.1 in the rules)

## Context

A page's image ends where it was cut, not where something was drawn. A webtoon episode is served in several images, cut with no regard to the lettering, so a cut runs past a bubble's lettering or through it. A Manga109 spread's half ends at the gutter. The eraser took the image's edge for a line drawn on the page:

- where the learned mask erases, for a bubble's outline (3.2.0, the owner's real run: the letters the cut ran by were left; ADR 0022);
- in the rules, for the edge of a line's window. The rules keep the marks that stay inside a window round each line: a stroke of art or an outline crossing the window touches its edge (ADR 0013). Where the image's edge clipped the window, a letter the cut runs through touched it too, and stayed. On the owner's page 50 the rules left the "!" the cut ran through; on generated pages with lettering at the cut (`--cut-lettering`), 15 of 79 lines in white bubbles were left untouched, on pages looked at.

## Decision

The image's edge is where the image stops. Past it nothing is seen: not the rest of a bubble, a letter or a stroke of art.

1. **Where the learned mask erases** (3.2.0): no outline is followed in from the image's edge, and the bubble model's interior runs on to the edge across a gap of one of the model's input pixels (ADR 0022).
2. **In the rules** (3.2.1): a mark touching its line's window only where the image's edge clipped the window has crossed nothing (`erase.js`, `touches`).
3. **But such a mark can't be judged by its size or pen**, since how far it runs past the edge isn't seen, and a stroke of art the edge cuts passes for a mark of the line by both. A mark the image's edge cuts is the line's lettering only on the line's own box (the detector's): on real pages looked at, the window alone took hair the page's top cut over a column, and the tip of a spike the bottom cut (art damage on those pages 2.10 → 2.26 and 0.08 → 0.26 per thousand); with this condition both stay, and the cut lettering still goes.
4. **Nor is a whole bubble judged from the part the image shows**: the share check in a bubble stays where the image cuts it (ADR 0022: without it, a small dark bubble the image cut was filled whole).

## Measured (3.2.1, the rules; generated pages: 150 never looked at, with lettering at the cut)

- Lines in bubbles the image cuts at their lettering, left untouched: 64 → 52 of 169 (37.9% → 30.8%). In white bubbles 12 → 0 of 83; in dark bubbles 52 of 86 both, as the rules leave dark bubbles' lettering anywhere (the learned mask is for them, ADR 0022).
- Their glyph pixels left as drawn: 33.7% → 28.6%. All lines left untouched: 10.5% → 9.3%.
- 30 pages better, none worse; outline pixels erased the same (1,157), art damage 0.053% both.
- With the setting on (the rules erase plain bubbles and what the mask saw nothing in): lines in cut bubbles left untouched 10.1% → 5.9% (in white bubbles 7 → 0 of 83), their glyph pixels left as drawn 7.3% → 3.7%; 21 pages better, none worse, outline and art damage the same.
- Real pages never looked at (333, the setting off): lettering still seen the same, 1.69%; five pages changed in art damage, two for the worse (2.63 → 3.51 and 26.47 → 28.40 per thousand), two for the better, one by 0.01; over all 0.098% both. Webtoon pages (100), generated (40) and new shapes (40) never looked at: as they were. On pages looked at: of 167 real pages one changed (the lobe under Not fixed); generated, new-shape and webtoon pages as they were.
- **The owner's webtoon episode** (110 pages, a debug report of 3.2.0, 106 lines the independent detector reads before erasing), replayed with Claude's own answers: lines it still reads after erasing 8 → 2 with the setting off, 7 → 2 with it on (the "!" of page 50 among them); on two more pages lettering the cut ran through, which it didn't count, is erased too; no other page changed.

## Not fixed

- **A stroke of art the image's edge cuts on the line's own box**: where the detector's box for a line takes in a stroke the edge cuts, drawn with the lettering's pen, the rules can't tell it from a cut letter. On a real page looked at, a lobe of a burst bubble's outline hanging from the page's top, over a column whose box reached the top, was erased (396 pixels; art damage on the page 1.21 → 1.28 per thousand). Asking the pen as well as the box changed nothing there: the lobe is drawn with it.
- **Dark bubbles cut at their lettering**, with the setting off: as dark bubbles anywhere.

## Rejected

- **The window alone** (decision 2 without 3): the art taken on real pages, above.
- **The line's pen as well as its box for a mark the image cuts**: on the pages looked at, the same as the box alone.
- **A fixed number of pixels at the image's edge** (rejected without a run, on reasoning): the gap at the edge is the bubble model's, as wide as one of its input pixels in the page's, which changes with the page's size (ADR 0022).
