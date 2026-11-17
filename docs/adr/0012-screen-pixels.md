# ADR 0012: The translation at the screen's own pixels

Status: accepted (2.11.0). Date: 2026-11-17. First step of the 3.0 plan (a robust core before new features).

## Context

The owner asked whether the translation adapts to every screen size. It had never been measured. `tests/browser/screens.mjs` measured 2.10.0 on a responsive reader at 390, 768, 1366 and 2560 px wide, on 1×, 2× and 3× screens:

- The overlay was drawn once into a canvas of the engine's working size (at most 1600 px on the long side) and stretched by CSS to the image's size on screen. On a 2× laptop at 1366 px that is 0.42 canvas pixels per screen pixel (stretched 2.4×); on a 3× screen 0.28 (3.6×). Nothing was redrawn when the window, the zoom or the screen changed.
- The erased areas were cut from the working-size page, so they were softer than the page they covered whenever the page was bigger than 1600 px (One Piece pages: 1370 × 2000, analysed at 1096 × 1600).
- In a 390 px window the smallest lines were 5 px tall on screen, and there was no way to read them.
- The web app rendered pages at the working size too, so a saved page, or one zoomed on a phone, was smaller and softer than the original.

## Decision

- **Overlay backing = size on screen × devicePixelRatio**, capped at 16 million pixels per page (a 2× full-HD page is about 8 million; long strips hit the cap). Patches are drawn in the page's own pixels, text in working pixels, each through its own transform.
- **Redrawn when the wanted size changes**: growing by more than 1% redraws (stretching is where blur starts), shrinking only by more than 10%. During a resize CSS stretches the old pixels, which stay in place; the redraw comes 180 ms after the wanted size stops moving, not on every layout pass.
- **Pages far from the screen give their pixels back** (three screen-heights away) and are drawn again on return (within one). 2.10.0 kept a working-size canvas for every translated page.
- **Erased areas at the page's own size**: `erase()` can hand back its mask; `finishPage` gets the page again at full size and inpaints each changed area there, with the mask resampled onto the full-size pixel grid by the exact affine map (`eraseFullSize`), so the patch lines up with the original to a fraction of a pixel. The erasing method itself (which pixels, how they are filled) is unchanged; replacing it is 2.12.0.
- **A readable view**: a line drawn under 9 CSS px shows at 15 px beside its bubble while the pointer rests on it. The lettering itself can't grow, since it has to fit the bubble the artist drew.
- **The web app renders at the page's own size**, capped at 16 million pixels (iOS Safari's canvas limit).
- The debug report records the overlay: pixel ratio, backing size and each line's size on screen.

## Measured (`tests/browser/screens.mjs`, demo page and One Piece 1197 p.7)

| | 2.10.0 | 2.11.0 |
| --- | --- | --- |
| Canvas pixels per screen pixel, 2× at 1366 px | 0.41 | 1.00 |
| Canvas pixels per screen pixel, 3× at 768 px | 0.50 | 1.00 |
| After a resize | never redrawn | redrawn once it settles |
| Lines under 9 px | unreadable | readable on hover |
| Web app page size | 1129 × 1600 | 1200 × 1700 (the original's) |

## Not done here

- Long webtoon strips are capped at 16 million overlay pixels. A strip 720 px wide and 20,000 tall on a 2× screen gets about 1.05 canvas pixels per CSS pixel, not 2. Drawing only the visible part of a strip would remove the cap. It is left for later because it changes how overlays are positioned.
- The eraser's white clouds on toned bubbles and art are unchanged; they are now just sharper. 2.12.0 replaces the eraser.
