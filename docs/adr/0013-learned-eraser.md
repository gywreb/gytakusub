# ADR 0013: The eraser fills each area the way its surface was made

Status: accepted (2.12.0). Date: 2026-11-18. Second step of the 3.0 plan (a robust core before new features).

## Context

Up to 2.11 the eraser removed the lettering's ink and filled the hole with Telea, which smears the colours at the hole's edge inward. On real chapters that left:

- **white clouds** on toned bubbles and art: the white stroke round outlined lettering was not in the mask, so Telea spread it over the tone;
- **ghost lettering**: a lettering-shaped smear where the tone or the art should continue;
- **ghost dots** in white bubbles, from bits of lettering the mask missed.

The owner's rule for this release: no case-by-case fixes. The eraser has to work on pages nobody tuned it on, so each part below is either a model of how manga surfaces are made or a learned model, and every number comes from all four real chapters available (One Piece 1197, Isekai Merchant 28.2, and two mangadex chapters, 27 and 20). The pages stay local; nothing from them is committed.

## Decision

1. **The mask covers the lettering's outline.** After the ink and its anti-aliased fringe, the mask grows by `OUTLINE` = 0.3 × the area's letter size, which is how thick lettering outlines run, and never past a bubble's interior, so the bubble's own outline stays. Measured with the earlier marks measure on the ten toned bubbles of two mangadex pages: 7 left marks without it, 2 at 0.15, 1 at 0.3, 2 at 0.45. The result barely changes between 0.15 and 0.45, so 0.3 is not a knife-edge choice.
2. **Each area gets the simplest fill that explains its surface**, tested on the area's own pixels:
   - **Flat** (most white bubbles): at least 95% of the surface (half a letter in from a bubble's edge) sits within 8 levels of its median. The hole takes that colour exactly. This was 2.11's rule for white bubbles and is unchanged.
   - **Screentone** (`engine/tone.js`): a surface of dots or lines is a lattice: one cell repeated along two vectors. The lattice is measured from the autocorrelation of the surface right around the hole, refined to a fraction of a pixel by least squares over the peaks at its sums. It is used only if it predicts the surround: a band of known pixels as deep as the hole is predicted from farther ones the same way the fill will work. That prediction must beat "the local average" by half (`VALIDATE` = 0.5). Up to three candidate lattices are tried and the best one is kept. The fill copies each hole pixel from its nearest lattice positions on the surface, in phase. A learned inpainter at this scale leaves a mottled smudge on regular tone.
   - **Learned** (`engine/inpaint.js`): anything else (art, irregular tone, gradients) goes to AOT-GAN inpainting trained on manga, from lemon-manga-translator (GPL-3.0, 23 MB float32, any size in multiples of 8; since 3.1 its weights are stored as float16, 12 MB, computed in float32: 0.0003 from the full model in the hole, 0..1). It is vendored at a pinned revision with its checksum recorded (`scripts/vendor-inpaint.mjs`, `vendor/inpaint.json`; the tests check it). It runs on the GPU when there is one, else the CPU. A grey page stays grey: where the surround has no colour, only the fill's brightness is kept.
   - **Telea** remains for an area when no model loads.
3. **Both texture fills see some of the page**: two letters, at least 24 px around the area. A bubble's fill copies screentone only from that bubble's interior, never from its outline or the art outside. When the page was analysed downscaled, the fill is done again at the page's own size (ADR 0012).
4. **Free text is erased line by line.** The mask was the ink inside the paragraph's whole box. On One Piece 1197's cover the text detector chained 16 "lines" (the title, a caption, a column, and strokes of the drawing it read as text) into one paragraph covering the whole illustration. Every small stroke in that box passed for lettering, and the faces were erased (in 2.11 too). The learned fill made the damage blockier. Now each detected line has its own window, padded by that line's letter size, so the art between lines is never in the mask. Bubbles keep the paragraph window, since a bubble's interior bounds it. Not chaining such lines in the first place is detection work, for 2.13–2.14.
5. **The learned fill has a size budget.** It inpaints at most 768 px on a side on the GPU and 384 on the CPU, and the fill is scaled back up. On the CPU it costs about 40 µs a pixel: 1.5 s for 240 × 160, 4 s for 384 × 256, 17 s for 768 × 512. The short side never drops under 72 px, because the model's widest dilated convolution needs its quarter-size feature map to be more than 16 across. A long strip of narration on the CPU budget failed on that before (and fell back to Telea). The model is loaded the first time an area needs it: white bubbles and screentone don't.
6. **The debug report records the cost**: per page, how many areas were filled each way, the time the texture fills took, and where the learned fill ran (`timing.fill`).

## Measured

**The fill against known backgrounds** (`tests/fill-truth.mjs`). 150 stretches of real textured pages with no lettering on them (art and tone; flat stretches are skipped, since every method fills those exactly) get lettering drawn on them: half outlined, half plain, 20–34 px. Both fills get the same mask, and the result is compared with what was there. 147 of the 150 went to the learned fill and 3 to the screentone fill. Real scanned tone rarely passes the lattice test; the synthetic page below covers clean tone.

| | 2.11 (Telea) | 2.12 |
| --- | --- | --- |
| Mean absolute error (levels) | 36.6 | 24.8 |
| SSIM over the lettering's box | 0.451 | 0.623 |
| Areas where 2.12's SSIM is better | | 142 of 150 |
| Areas where 2.12's error is smaller | | 136 of 150 |

SSIM per chapter, 2.11 → 2.12: One Piece 0.52 → 0.70, Isekai Merchant 0.50 → 0.70, mangadex 27 0.37 → 0.53, mangadex 20 0.45 → 0.62. I looked at the 8 areas where SSIM did not improve. 2.12 looks better in four of them (plausible art where Telea leaves a blur) and about the same in two. It looks worse in two: on one nearly white stretch the screentone fill left a faint striped pattern, and on one busy patch of art the learned fill left dark patches. Pixel error rewards blur, which is why it is not the only measure used.

**The synthetic tone page** (`tests/tone.test.mjs`, `fixtures/tone-00.png`), marks left (0.15 or more is a mark):

| Area | 2.11 | 2.12 |
| --- | --- | --- |
| Outlined lettering on a toned bubble | 4.09 | 0.04 |
| On a gradient bubble | 0.81 | 0.02 |
| In a white bubble | 0.00 | 0.00 |
| Narration on screentone | 6.23 | 0.13 |

**Whole chapters** (`npm run audit`, all four; 414 erased areas). 2.12 chose a flat fill for 311 of them, the learned fill for 101, screentone for 2, and Telea for none. On the 351 areas with a plain surround, where the marks measure holds, 2.11 left marks on 6 and 2.12 on 5. Four of those are the reader site's banner image on the first and last page of the two rawkuma chapters, which Claude translates as a sign. So on plain surfaces 2.11 was already clean, once the measure itself was fixed (below). Its visible failures were on the other 63 areas, with a textured surround (15%), and the fill test above covers those.

**Cost.** Measured on this project's 2-core cloud machine, CPU (wasm), one process, with the CPU budget:

- the learned fill: 1.6 s per textured area on mangadex 27 (1.4 such areas a page, so about 2 s a page), 3.5 s on One Piece (2.6 a page, about 9 s a page);
- the screentone fill: 30–160 ms to try and refuse, about 0.2 s when it fills;
- flat areas: nothing new.

On WebGPU the model runs on the GPU (`createSession` strict) and its output matches the CPU's exactly. That was checked on a software GPU (Mesa llvmpipe through Dawn), which says nothing about speed. Speed on a real GPU has not been measured here.

## The measure itself

The marks measure (`tests/residue.mjs`) compares the erased window with the surface around it. Building it into a gate on real chapters exposed four faults, now fixed:

- free text was read at fractional pixel positions, so it read no pixels at all;
- the level was compared with the ring's median, which on screentone is the paper between the dots;
- the ring included lettering outside the window that the eraser had removed too;
- the ring reached into thick and spiky bubble outlines and the art crowding them.

Fixing these took 2.11's count of dirty bubbles from 109 of 388 down to 21: most of the old count was the measure, not the eraser. Even fixed, it misjudges both ways when the surround is textured (art, screentone): it flagged clean learned fills and passed smeared ones. So areas on a textured surround are now counted apart and judged by the fill test above, and the plan's earlier gate figures (14% → under 3%) are withdrawn.

## Not done here

- **A learned text mask** (comic-text-detector) was tried: it catches lettering the detector misses. It is 38.6 MB at half precision, GPU only, and takes about 7 s a page on a CPU. Its job is erasing what the detector missed, which is 2.13.0.
- **Free text over art** is filled better (the fill test is mostly art) but has no automatic measure on whole pages yet. That is 2.13.0 too.
- Visible on real pages and still open:
  - a lighter blob where a radial gradient tone meets the hole;
  - a darker smudge in a few light-ray toned bubbles;
  - the learned fill sometimes invents a stroke on art, or leaves dark patches on busy art;
  - the screentone fill can leave faint stripes on a nearly white surface;
  - a glow bubble with art showing through becomes a soft grey.
- **The speed gate is not checked yet.** The plan's gate is that a page is no slower than in 2.10 on the owner's GPU. The test machine has only a software GPU; `timing.fill` in a debug report from the owner's machine measures it. If the fill shows up, the next step is to run it while Claude is answering. The regions are known by then, and the call takes several seconds a page.
- On a CPU-only machine a page with art behind its text takes seconds longer (above).
