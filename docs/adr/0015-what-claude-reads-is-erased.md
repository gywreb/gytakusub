# ADR 0015: What Claude reads is erased, or left as drawn; LaMa on the graphics card

Status: accepted (2.13.0). Date: 2026-11-20. Third step of the 3.0 plan (clean art).

## Context

The audit (`tests/audit-core.mjs`) replayed 11 of the owner's chapters on 2.12 with their saved answers: 1,126 translated lines.

- 58 lines still had lettering after erasing. Checked one by one:
  - 12 are not real. Those chapters were read with the 1.x engine, whose one stamp covered two bubbles; today's engine splits them, so the replay puts one answer in one of the two. The audit's own matching of overlapping bubbles was also wrong once; fixed (by overlap, not by centre).
  - The rest: covers, logos, credits and title bands (17); lines that are only "…" or "!" (10, six drawn doubled); sound-like words on tone or dark art (8); two lines given one stamp (3); bits left beside a translation (3).
- 29 translations were drawn over lettering nothing erased: punctuation (10), sound effects (9), logos, credits and cover text (7), page numbers (2), one dialogue line.
- The prompt says to leave sound effects out. Claude returned them anyway, mostly as "sign": at least 16 lines in 7 of the 11 reports.

## Decision

1. **A line with nothing to translate is left as drawn** (`layout.js said`). A translation with no letter or digit ("…", "!?", "♪") reads the same in any language. Such a line still takes its place in its bubble: it keeps the lettering its box lies on most (`region.kept`, which `erase.js` leaves), and the other lines are anchored among the rest and keep off it. A region given nothing else is not erased.
2. **Sound effects and logos are labelled, not left out** (`prompt.js LEFT_AS_DRAWN`). The kinds "sfx" (a sound effect) and "logo" (series logos, publisher or magazine marks, scan credits, page numbers) are in the answer's schema and dropped on parsing. Chapter titles, blurbs and captions stay "narration" or "sign". `PROMPT_VERSION` 7.
3. **A second look on Claude's box** (`detect.js detectInTranslatedBoxes`). When lines the layout would take (score 0.7 up) cover under a quarter of a translated line's box, the detector runs again on the box with half its size around it, zoomed until its long side is 640 px (4× at most). The page-wide pass at 960 px misses lettering far from dialogue size; zoomed, it was found in 19 of 22 boxes tried. What it finds joins the analysis's lines (`second`), and the layout adopts it ([ADR 0014](0014-free-text-second-witness.md)) at the detector's own threshold, 0.5.
4. **Two lines, one stamp: the boxes decide.** The line lying most on the bubble's lettering keeps the stamp. Another goes to the region no line was given whose lettering its box lies on most (`layout.js shareStamp`). One boxed outside the bubble while the other is inside takes the lettering under its box, as an untagged line would.
5. **Adoption, two cases added:** a tight box on the core of big lettering takes it (the box 80% on it, the lettering at most 4× the box); a sliver of a large box is not taken for the whole line (the translation would shrink into it while the rest stays).
6. **In a bubble, lettering found by colour is wholly inside it.** Past the outline it is the art around the bubble, which the bubble's flat fill would paint white.

7. **On a graphics card, art is filled by LaMa finetuned on manga** (`vendor/lama.onnx`, `cv.js getInpainter`), not AOT, in the extension and the web app. The CPU and a GPU emulated on the CPU keep AOT (LaMa costs several times as much per area). The web app downloads the model (103 MB) the first time an area needs it; a phone whose tab died twice while LaMa loaded or first ran (out of memory, which nothing can catch) keeps to AOT afterwards (`web/lama-guard.js`, recorded in the debug report).
   - Source: the ONNX export `ogkalu/lama-manga-onnx-dynamic` (Apache-2.0) of `dreMaz/AnimeMangaInpainting` (Big-LaMa finetuned on ~300k manga and anime images, MIT).
   - Made by `scripts/lama-static.py`: fixed at 512 × 512, the size it was finetuned at. An area smaller than that is filled inside the 512 × 512 window of the page around it (`inpaint.js` context, at work size and at full size; the fill cache's key covers the window), a larger one scaled to fit. The upstream file computes its Fourier transforms' matrices from the input's shape: ~10,000 nodes, which ONNX Runtime Web took ~16 s to load each time; fixed, they fold into constants (~3,000 nodes, the same output) and it loads in under 2 s.
   - Weights stored as float16, computed in float32: 103 MB, 0.001 from the full model in the hole (0..1). 8-bit weights (52 MB) were 0.05 off.

The debug report records the second look (`timing.look`: boxes, lines found, ms) and which inpainter ran (`fill.model.kind`, with its load and first two runs).

## Evidence

Same 11 chapters, same saved answers, 2.12.0 → 2.13.0 (lines with nothing to translate not counted, 1,095 lines):

- Translations drawn over unerased lettering: 29 → 16. Left: 6 sound effects and 5 logos, marks or page numbers (what the labels drop), 2 lines of cover text, 1 title of which only a corner was found, 1 box Claude placed 250 px from its text, and a lone "3".
- Lines whose lettering is left: 31 → 24, not counting 10 that only the replay of old reports gets wrong. Left: 11 logos and credits, 2 sound effects, 5 titles and blurbs on art, 4 white-on-dark or outlined lines crossing onto art, 2 bits beside a translation.
- Text moved away from its lettering: 8 → 2.
- Every area whose render changed (264) was compared by eye with 2.12.0. Most are white flecks gone from tone and art around bubbles (decision 6), and dots and marks kept. Worse: one bubble whose lettering crosses its outline onto tone, now translated, has a white patch there (it was left in Japanese before).

In the audit the textured areas are filled with Telea, not the learned fill, so its smears on art say nothing about the extension's fill.

LaMa against AOT, on the same holes (`fill-truth.mjs` areas: real stretches of the owner's pages with lettering drawn over them, so what is under it is known), in SSIM over the hole (higher is closer), with 8-bit weights:

- Black-and-white chapter with screentone, 36 areas: AOT 0.45, LaMa 0.55, LaMa closer in 29. AOT leaves a blurred ghost of the letters on tone; LaMa continues the dots.
- Colour chapter, 51 areas: 0.70 both, LaMa closer in 23. On skin it sometimes leaves a faint band where AOT does not.
- On the CPU here: LaMa ~2.7× AOT's time per area; on lavapipe (a software GPU) it runs, with the same fill as on the CPU.

The shipped file (fixed at 512, float16 weights), on 12 areas of the B/W chapter: padded with a mirror image of the area, SSIM 0.51 against AOT's 0.47 but a larger error (28.7 against 25.4), its dots out of step; seeing the page around the area instead, SSIM 0.59 and error 21.6, closer than AOT in 10 of 12.

## Not done

- Lettering crossing a bubble's edge onto art (white letters outlined in black, on hair or a dark panel) is partly left; erased, it can leave a white patch on the tone past the outline.
- Titles and blurbs on busy art are partly left, and the fill shows.
- A box Claude placed far from its text is drawn there, over the art.
- LaMa's time on a real graphics card is not measured: the test machines have only a software GPU. The debug report shows it (`fill.model`).
- The effect of the new labels is estimated from the old answers until a chapter is read with them.
