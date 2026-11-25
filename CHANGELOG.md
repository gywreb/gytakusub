# Changelog

All notable changes to Gytakusub are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.3.0] — 2026-11-26

One answer contract: every answer Claude gives is checked and repaired in one place, whoever sends it, and the bench now reads pages the way readers that make mistakes do.

### Pages
- **An answer cut off partway keeps its complete lines.** Before, a page whose answer ran past its length limit, or whose JSON broke partway, failed whole. Now the lines complete before the break are placed and erased. [ADR 0025](docs/adr/0025-one-answer-contract.md)
- **A line in a speech bubble that Claude labelled a sound effect is translated.** Its mark and its box must both put it in the bubble. The prompt asks for sound effects drawn as part of the artwork; lettering in a speech bubble is said by someone, and it was left as drawn (2.14.1 found one such line lost).
- **Boxes written another way are read that way:** a 0–1000 grid with y first (Gemini's documented boxes), fractions of the image, or corners in place of a size. The way that puts the boxes on the lettering found wins, and the contract's own way stands unless another fits clearly better. Haiku writes its boxes the contract's way; this is for 5.0's other readers, and the bench's weak one.
- **The same line given twice** (same words and translation, in the same place) is placed once.
- On the owner's 746 report pages the contract changes none of Haiku's 3,154 lines.

**Measured on generated pages looked at** (520 lines on 100 plain pages):
- Haiku-like answers (the strong reader): delivered 91.3% both before and after; nothing changed.
- The weak reader: lines delivered 68.1% → 81.7%, lines lost 166 → 95. Of the lines its answers carried, those lost went 98 → 35. The rest it left out, or they came after its answer was cut off, so no repair can bring them back.
- Exact answers: unchanged.

**Counted on pages never looked at** (seeds 100000+):
- Exact and Haiku-like answers: every page the same as before.
- Weak reader: plain pages delivered 71.5% → 81.8% (lines lost 155 → 99), webtoon pages 62.0% → 68.7% (120 → 99). 50 of 52 answers with boxes written another way were read that way, none wrongly. One page lost a line (not looked at; on the looked-at page that lost one, a box the reader had put off its lettering, read the right way, overruled its mark: the layout's rule).
- **Not met:** the plan's gate asked the weak reader's lost lines to halve (−36% plain, −18% webtoon). Lines a reader leaves out, or that come after its answer is cut off, aren't in the answer, so the contract can't bring them back. Asking again for them would cost a second call on a quarter of real pages to find little.

### Debug report
- `timing.answer` lists what the contract repaired on the page. A line left as a sound effect or logo (`timing.dropped`) now carries its mark and box, so a report shows whether it sat in a bubble.

### Development
- **Claude's errors, measured** on the owner's reports (826 pages, 3,505 lines, Haiku): a mark its own box overrules 1.3%, no mark 5.4% (of lines in a region), a box on no lettering at most 1.9%, bubble text no line names at most 3.2%.
- `bench/reader.mjs` and `synth-run.mjs --reader strong|weak`. The strong reader makes Haiku's errors at those rates. The weak one makes them three times as often, plus the errors other readers make; its numbers are mine until 5.0's reading check. Every generated row counts `delivered`: lines erased and translated inside their own bubble, or over their own free text.
- `engine/contract.js`: `checkAnswer`, `boxWay`, `parseAnswer`; `wordsOf` moves there from `prompt.js`.
- Tests: `engine.test.mjs` (boxes written another way; the contract's way standing with a box off its lettering; the same line twice; a sound effect in a bubble; answers not a list; a cut-off answer's complete items).

## [3.2.2] — 2026-11-25

No change to pages: two detectors trained on comics measured against today's (the roadmap's 3.3). Neither is adopted.

### Development
- **A text detector trained on comics** (comic-text-detector) finds fewer lines than today's. Of 784 lines Claude translated on the owner's pages it found 89.8%, today's 95.3%. Together they found 96.2%, at about 10 s more a page on the CPU. [ADR 0024](docs/adr/0024-comic-detectors-measured.md)
- **A bubble detector trained on comics and webtoons** (ogkalu's, boxes only) finds 77% of the generated pages' dark bubbles, today's bubble model 34%. Turned into bubbles inside the engine, its boxes put more lines in their bubble, but the bubble outline erased grew 1.5 to 3 times and art damage by 16–29%, at 3–4 s more a page. Dark bubbles go to 4.0's learned core: a bubble model trained on generated pages, which know a dark bubble's exact interior.
- `bench/detectors.mjs`: what a candidate detector finds (lines, or bubbles by kind, masks or boxes). The model reader reads a box detector's output (no mask head), so one can be measured.
- Tests: `segment.test.mjs` (a box detector's output comes back as boxes with no mask).

## [3.2.1] — 2026-11-25

Lettering the image's edge cuts through is erased with the setting off too.

### Pages
- **Lettering the image's edge cuts through**, where the rules erase it: with the setting off, and in plain bubbles with it on (a webtoon is served in several images, and the cut falls anywhere). The rules keep the marks that stay inside a window round each line; a stroke of art crossing the window touches its edge. Where the image's edge clipped the window, a letter the cut runs through touched it too, and stayed. Now the image's edge is no edge of the window; and a mark it cuts, whose size past the edge isn't seen, is lettering only on the line's own box. On pages never looked at with lettering at the cut, lines in the bubbles cut there left untouched: with the setting off 37.9% → 30.8% (in white bubbles, 12 of 83 → none), with it on 10.1% → 5.9%. On the owner's webtoon episode replayed, lines the independent detector still reads after erasing: 8 → 2 with the setting off, 7 → 2 with it on. On real pages never looked at, the lettering left is the same; five of 333 pages changed a little in art damage, two for the worse. [ADR 0023](docs/adr/0023-the-image-edge-cuts.md)

**Not fixed:**
- A stroke of art the image's edge cuts, which the detector's own box for a line takes in, drawn with the lettering's pen: the rules can't tell it from a cut letter. On a real page looked at, a lobe of a burst bubble's outline hanging from the page's top was erased.
- Dark bubbles cut at their lettering, with the setting off: the rules leave dark bubbles' lettering there as anywhere (52 of 86 lines); the learned text mask is for them.

### Development
- Tests: `freetext.test.mjs` (lettering the image's edge cuts through, erased by the rules; a stroke the edge cuts beside a line's box, left).

## [3.2.0] — 2026-11-25

The learned text mask: a setting, off by default, that erases the lettering the eraser's rules can't see whole. Free text over art, the webtoon's dark bubbles, white lettering on dark ground.

### Pages
- **Learned text mask (preview)**, in Options (Settings in the web app). With it on, a model trained on comic text finds the lettering to erase on free text and in bubbles whose surface isn't plain: dark, toned or gradient bubbles. Plain bubbles keep the rules, which already find their lettering whole. The eraser checks the model's mask before taking it: only pieces of it on the lines Gytakusub found, never a bubble's outline, and the rules instead where the model took a bubble or a shape for lettering. On pages never looked at, free-text lines left untouched went from 24.5% to 10.8%, and on webtoon pages lines left untouched went from 18.5% to 5.6%. [ADR 0022](docs/adr/0022-learned-text-mask.md)
- **Lettering the image's edge cuts through** (a webtoon is served in several images, and the cut falls anywhere): where the mask erases, the letters the cut runs by go too (where the rules erase, they don't yet: below). The image's edge is no outline of the bubble, and the bubble's interior runs on to the edge across the pixel or two the bubble model can't place. On pages never looked at with lettering at the cut, lines in those bubbles left untouched: 37.9% with the setting off, 10.1% with it on.
- **Why it's off by default:** without a graphics card it's slower. On one CPU thread the mask takes about 4 s a page (median; 7 s on webtoon pages); the slowest tenth of pages take from 8 to 12 s up (by kind of page), and the slowest page measured took 43 s. It runs while Claude reads the page. With a graphics card it runs there, its mask the CPU's: on a real episode (WebGPU, 47 pages where it ran) 37 ms a page (median), 68 ms for the slowest tenth, 352 ms the most.

**Measured on pages never looked at** (held-out halves, the same bench, 3.1.0 against 3.2.0 with the setting on; with it off, 3.2.0 erases exactly as 3.1.0):

| | 3.1.0 | 3.2.0, learned mask |
|---|---|---|
| Real pages (Manga109-s, 333 pages, 2,752 lines): lettering the independent detector still sees | 1.69% | 1.09% |
| Real pages: art damage (pixels changed away from any text) | 0.098% | 0.045% |
| Real pages: sound effects changed | 0.19% | 0.16% |
| Generated (810 lines): free-text lines left untouched | 34 of 139 (24.5%) | 15 (10.8%) |
| Generated: all lines left untouched | 42 (5.2%) | 22 (2.7%) |
| Generated: art damage | 0.051% | 0.020% |
| Generated: bubble outline pixels erased | 1,062 | 950 |
| The new shapes (1,165 lines): free-text lines left untouched | 31 of 139 (22.3%) | 14 (10.1%) |
| The new shapes: art damage | 0.054% | 0.025% |
| The new shapes: bubble outline pixels erased | 2,817 | 1,437 |
| Webtoon (789 lines): lines left untouched | 146 (18.5%) | 44 (5.6%) |
| Webtoon: in dark bubbles | 103 of 173 (59.5%) | 27 (15.6%) |
| Webtoon: in the other bubbles | 25 of 528 (4.7%) | 10 (1.9%) |
| Webtoon: free text | 18 of 88 (20.5%) | 7 (8.0%) |
| Webtoon: art damage | 0.053% | 0.048% |
| Webtoon: bubble outline pixels erased | 2,635 | 5,026 |
| Lettering at the image's cut (979 lines; 169 in bubbles the image cuts at their lettering): those left untouched | 64 (37.9%) | 17 (10.1%) |
| Lettering at the cut: their glyph pixels left as drawn | 33.7% | 7.3% |

Text sizes, placement and the lines found don't change: the mask only changes what is erased.

**The goals set for 3.2:**
- Free-text lettering left at least halved: met (24.5% → 10.8% generated, 22.3% → 10.1% the new shapes, 20.5% → 8.0% webtoon).
- The webtoon's dark bubbles erased: mostly, not all. Lines in them left untouched 59.5% → 15.6% (103 → 27 of 173).
- Real pages no worse: lettering still seen 1.69% → 1.09% (more on 8 pages, less on 20); art damage 0.098% → 0.045% (worse on 8 pages, better on 55).
- Within a size and speed budget: the model adds 29 MB (the extension is about 220 MB unpacked), and on a CPU it takes about as long again as the rest of the engine; it's off by default for that.

**Not fixed:**
- On webtoon pages the mask erases nearly twice as many bubble outline pixels (2,635 → 5,026). The bubble model misses many dark bubbles; read as free text, they have no interior to keep the mask inside, and the model sees lettering where a dark bubble meets its outline. A small dark bubble the bubble model misses can be erased whole. Finding those bubbles is the comic detector's work (3.3).
- Lettering the image's edge cuts, where the rules erase it: with the setting off, and on plain bubbles with it on. The rules keep marks that stay inside their line's window, and at the image's edge the window ends: a letter the cut runs through reads as a mark crossing it, and stays (3.1 does the same). On those pages never looked at, 64 of 169 lines with the setting off. Fixing it changes what the default erases, so it's its own patch.
- Lettering with a grey drop shadow beside it (the same episode): the mask takes the letters and leaves thin edges of the shadow, which the independent detector still reads.

### Development
- `--textmask` on both benches: the learned mask, as the setting; each page's row has the mask's time. Generated pages' rows count the lines in dark bubbles and those left untouched there (`darkLines`, `darkStays`).
- `--cut-lettering` on the generated bench: bubbles the image's top or bottom edge cuts at their lettering, through its nearest row or just short of it, white or dark (from a stream of its own: the other pages stay as they were). Rows count those lines (`cutLines`, `cutStays`) and, in pixels, the glyphs still as drawn (`cutLitPx`, `cutSamePx`; `litPx`, `samePx` for all lines): a line whose row at the cut is left stays under a quarter of its pixels.
- `scripts/vendor-textmask.mjs` vendors the model (comic-text-mask, TareHimself, MIT) at a pinned revision and checks it; `scripts/textmask-onnx.py` builds the ONNX graph from the published weights.
- Debug reports say whether the learned text mask was on (`settings.learnedMask`); each page's `timing.textMask` says where it ran and for how long.
- Tests: `textmask.test.mjs` (the crops, the model on drawn lettering, the eraser's checks, a bubble the image's edge cuts), the mask on the GPU against the CPU (`gpu.test.mjs`), and the extension and the web app with the setting on (`browser/run.mjs --learned-mask`, `browser/web.mjs --learned-mask`).

## [3.1.0] — 2026-11-24

What 3.0 left: text set larger where its bubble holds it, the margin kept; lines that follow a slanted bubble; an eraser that leaves the art beside large lettering. Also a smaller fill model, and one image fewer sent to Claude.

### Pages
- **Text set larger where its bubble holds it, margin kept.** A line is now judged over the rows its letters reach, not its whole line slot. Before, the bubble's narrowing above a first line's letters and below a last line's counted against them: about a fifth of the size, on top of the margin. On real pages never looked at, lines set under 0.7 of their size went from 11.1% to 8.9%. [ADR 0021](docs/adr/0021-fitted-where-its-letters-are.md)
- **Lines follow a slanted bubble.** Each line is centred in its own row of the bubble, as a letterer sets them, instead of all lines on one centre line. In slanted bubbles, lines under 0.7 of their size went from 8 to 3 of 72.
- **The margin off the outline is 3 px at least** (it was 2). Lines now fill their room up to the margin, and 2 px was within a pixel of touching the outline.
- **The eraser leaves the art beside large lettering.** Next to a title in brush lettering 158 px tall, the panel's frame lines, a cloud's outline and part of a sound effect were erased with it: near lettering that large, every mark counted as "letter-sized". A mark beside a line is now erased only when it's drawn with the line's own pen; a stroke far thinner than the lettering's is art. Dialogue lettering is too thin a pen for this rule to judge, so it's erased as before. On that page, art damage went from 12.3 to 5.4 per thousand pixels (2.15.0: 3.3).
- **Naver's ad after an episode is no longer translated.** An image alone in its site and folder beside a chapter's pages isn't a page. The chapter fetcher already left such images out. Checked on all 36 of your debug reports: no page is left out. Besides Naver's ad, the rule also skips rawkuma's series covers.

**Measured on pages never looked at** (held-out halves, both versions on the same bench, 3.0.0 → 3.1.0):

| | 3.0.0 | 3.1.0 |
|---|---|---|
| Real pages (Manga109-s, 333 pages): lines under 0.7 of their size | 11.1% | 8.9% |
| Real pages: lines with over 3% of their ink on the outline or the art past it | 73 (2.7%) | 72 (2.6%) |
| Real pages: lettering the independent detector still sees after erasing | 1.66% | 1.69% |
| Real pages: art damage (pixels changed away from any text) | 0.115% | 0.098% |
| Real pages: sound effects changed | 0.25% | 0.19% |
| Real pages: lines found before Claude answers | 97.1% | 97.1% |
| Lines under 0.7 of their size: generated (810 lines) | 111 (13.7%) | 95 (11.7%) |
| The same, the new shapes (1,165 lines) | 172 (14.8%) | 144 (12.4%) |
| Lines a bubble could hold at 0.7 of their size, keeping clear of the outline, set smaller: generated | 5 (0.6%) | 1 (0.1%) |
| The same, the new shapes | 16 (1.4%) | 6 (0.5%) |
| Lines touching their outline: generated (671 lines in bubbles) | 20 (3.0%) | 22 (3.3%) |
| The same, the new shapes (1,026 lines in bubbles) | 28 (2.7%) | 32 (3.1%) |
| Text past its bubble: generated, the new shapes | 10, 11 | 9, 10 |
| Lines over 1/0.7 of their size: generated and new shapes | 125 | 150 |
| Lettering left untouched: generated, the new shapes | 42, 39 | 42, 39 |
| Bubble outline pixels erased: generated, the new shapes | 1,940, 3,691 | 1,062, 2,817 |
| Art damage: generated, the new shapes | 0.056%, 0.057% | 0.051%, 0.054% |

Page by page, art damage fell on 70 of the 333 real pages and rose on none. On generated pages it rose on one page of each half and fell on 18 and 17.

**The goals set for 3.1:**
- Real lines under 0.7 of their size at most 10.3%, with no more lines over the outline or art: met (8.9%; 72 lines against 73).
- Lines a bubble could hold at 0.7 set smaller at most 1% on the new shapes: met (0.5%).
- Lines touching their outline no worse: **not met** on the pages never looked at: 2.7% → 3.1% on the new shapes (28 → 32 lines), 3.0% → 3.3% generated (20 → 22). On the pages looked at, the 3 px margin brought both back: 29 → 25 and 14 → 14. Across both halves: 57 → 57 and 34 → 36.
- Art damage and outlines erased no worse on either half: met on both.
- The webtoon cases are on the bench (below). Dark bubbles with coloured lettering aren't fixed: the bubble model's mask of a dark bubble is wrong, and the eraser can't mend that. They move to the learned mask (3.2).

### Smaller
- **The CPU's fill model (AOT) is half the size**: 23 MB → 12 MB. Its weights are stored in half precision and computed in full precision, as LaMa's are. In the area it fills, it is 0.0003 from the full model on a 0 to 1 scale (LaMa's bar was 0.001). The extension is about 190 MB unpacked.

### Development
- **The bench has the webtoon's cases** (`synth-run.mjs --webtoon`): dark bubbles filled with a gradient from near black to a deep colour, with red or white lettering, as in your Naver episode; and bubbles cut by the image's top or bottom edge. On 100 held-out pages with them, 3.0.0 and 3.1.0 alike: in dark bubbles, 51 of 173 lines run past their bubble; of all 789 lines, 88% are found before Claude answers (95% on the other generated pages), and 18.5% keep their lettering untouched (5.2%). That's what the learned mask (3.2) is measured against.
- `scripts/half_weights.py`: the half-precision step, now shared by both fill models.

### Setup guide
- The chapter-link guide was checked against Cloudflare's three changed pages: no step, button name or limit changed (#39).

## [3.0.0] — 2026-11-23

The core, measured. 3.0 is the release of the work since 2.10.0 (2.11 to 2.15 were not released on their own), and the last step of its plan: text that fits its bubble, and the same page on the CPU and on a graphics card.

### Since 2.10.0
- **Sharp on every screen** (2.11): the translation is drawn at the screen's own pixels and drawn again when the window or zoom changes.
- **Clean bubbles and clean art** (2.12, 2.13): a learned eraser continues screentone and art (LaMa on a graphics card), and what Claude reads is either erased or left exactly as drawn. Sound effects and logos stay as drawn.
- **Measured on pages never tuned on** (2.14): every change is checked on 333 real pages from held-out Manga109-s books and on generated pages in seven scripts, never looked at while changing the engine ([docs/QUALITY.md](docs/QUALITY.md)).
- **Text stays in its bubble** (2.15): set to the bubble's shape, off its outline, at the lettering's size; Korean measured on whole syllables.
- **Long chapters no longer fail partway** (2.14.6, 2.14.7): a page frees all it used, however it ends.
- Each step's details are in its section below.

### Pages
- **The same page comes out the same on a graphics card and on the CPU.** The bubble model came in two variants, one per backend, and they drew bubbles a few pixels apart. In your French chapter's page 9, the bubbles came out 12 px apart, and a report replayed here didn't reproduce your screen. One model now serves both: replayed on the CPU, your pages 9 and 20 come out as on your graphics card (page 9 within 1 px, page 20 exactly). The extension is 43 MB smaller (about 200 MB unpacked). [ADR 0020](docs/adr/0020-one-bubble-model.md)
  - The cost: on a device without a graphics card the bubble model is slower. A generated page took 5.5 s through the whole engine against 4.7 s. Chrome, Brave and Edge with WebGPU, and Safari 26 for the web app, don't pay it.
- **Text a fraction larger where its bubble holds it.** Font sizes now go in quarter pixels. Whole pixels are 5–7% apart at dialogue sizes, and many lines sat a pixel under what their bubble held.
- **The margin off the outline is kept above and below the text too.** It was kept only beside it, so a line near a bubble's top or bottom curve could sit on the outline. Each row's width is now the narrowest over every pixel row it spans, not its width at the middle.
- **A box fit is judged by its letters' real ink**, descenders and accents included. Box fits judged inside could touch a bubble's bottom curve.
- **Text can be centred in its bubble** when the original lettering stood off the bubble's middle, if it fits larger there.

**Measured on pages never looked at** (held-out halves, both versions measured again on the same bench, 2.15.0 → 3.0.0):

| | 2.15.0 | 3.0.0 |
|---|---|---|
| Lines touching their outline: generated (671 lines in bubbles) | 29 (4.3%) | 20 (3.0%) |
| Lines touching their outline: the new shapes (1,026 lines in bubbles) | 49 (4.8%) | 28 (2.7%) |
| Text past its bubble: generated (810 lines) | 9 (1.1%) | 10 (1.2%) |
| Text past its bubble: the new shapes (1,165 lines) | 12 (1.0%) | 11 (0.9%) |
| Lines a bubble could hold at 0.7 of their size, keeping clear of the outline, set smaller: generated | 5 (0.6%) | 5 (0.6%) |
| The same, the new shapes | 17 (1.5%) | 16 (1.4%) |
| Lines under 0.7 of their size: generated | 109 (13.5%) | 111 (13.7%) |
| Lines under 0.7 of their size: the new shapes | 171 (14.7%) | 172 (14.8%) |
| Lines under 0.7 of their size: real pages (Manga109-s, 333 pages) | 13.0% | 11.1% |
| Lines over 1/0.7 of their size: generated and new shapes | 134 | 125 |
| Real pages: lines found before Claude answers | 96.9% | 97.1% |
| Real pages: lettering the independent detector still sees after erasing | 1.76% | 1.66% |
| Real pages: art damage (pixels changed away from any text) | 0.118% | 0.115% |
| Real pages: sound effects changed | 0.29% | 0.25% |

On generated pages the erasing is close to 2.15.0 but not the same, because the bubble model changed: lettering left 94 → 96 lines of 810, and 94 → 96 of 1,165. Art damage is down 5% on the new shapes but up 4.5% on the other half, and outline pixels erased are down 19% and up 14%. That rise is one page, where a bubble came out differently and the eraser took part of the art. Without that page, both are a little lower. Held-out pages are never looked at; on a looked-at real page the same thing happened when part of a big sound effect over a bubble fell inside the new bubble mask. On the real looked-at pages, art damage fell overall (1.36 → 1.22 per thousand pixels).

**Lines over the outline or the art, on real pages.** Measured line by line on the 333 held-out real pages, against 2.14.7: lines with over 3% of their ink on the outline or the art beyond it went 103 (3.8%) → 73 (2.7%). Lines under 0.7 of their size went 10.3% → 11.1% (2.15.0: 13.0%). 2.15.0's changelog put the size it lost down to lines that ran over the outline and counted as full size. That holds for few of them: of the 75 lines small now and full size in 2.14.7, 5 lay over the outline or art. The cost is the margin. On the real pages looked at, the same build with no margin sets 7.9% of lines small, against 9.0% for 2.14.7 and 10.7% with the margin, and still puts fewer lines over the art than 2.14.7 (32 against 45).

**The goals set for 3.0:**
- Lines a bubble could hold at 0.7 of their size but set smaller, at most 1%: met on generated pages (0.6%), not on the new shapes (1.4%), counting the lines that would fit only by touching the outline apart. Counting them in, as when the goal was set: 2.1% and 3.3%.
- Bubble outlines erased and art damage no worse: on real pages, met (art damage 0.118% → 0.115%). On generated pages, one of two halves is worse, through one page (above).
- Real lines set under 0.7 of their size no worse than 10.3%: not met (11.1%). The margin off the outline costs that (above).
- Done: the engine's contract checked in CI, its numbers in one file and per stage, letter sizes across gaps (Korean), the eraser's growth following the outline, text sized to its room, the same page on the CPU and a graphics card, only chapter pages translated.

You chose to ship 3.0 with the size goals restated (23 Nov): they count with the margin kept, since text that touches its outline isn't what you want. The two left over move to 3.1: lines that follow a slanted bubble (most of the new shapes' 1.4%), and size won back without giving up the margin.

### Development
- **The real-page bench says which lines sit over the outline or the art** (`overArt`, and `perLine` to compare two builds line by line). It has no bubble outlines, so before 2.15 a line run over the outline into the art counted as full size.
- **Lines a bubble could hold at 0.7, keeping clear of the outline** (`smallAvoidableClear`), apart from those that fit only by touching it. `--why` refits each such line with one cause removed at a time (the true letter size, no margin, the true bubble, its centre line) and records each touching line's fit.
- **`gpu.test.mjs` requires the same page on both backends**: the same bubbles (mask IoU 0.98 or more) and the page's regions and placements within 2 px, on every fixture page, in CI.
- `scripts/vendor-segment.mjs` vendors one bubble model; `quantize-segment.py` keeps the static variant for measuring.

### Store
- **Ready to publish publicly**: the listing text, the five screenshots (made again with this engine) and the steps for this release (`store/LISTING.md`, `store/RELEASE-CHECKLIST.md`). The store zip loads in Chromium as built, and asks for no permission 2.10.0 didn't have.
- **Privacy policy:** a line Claude gives back untranslated is sent once more, as text, to translate it (since 2.14.0; now written down).

## [2.15.0] — 2026-11-22

### Fixed
- **Translations stay inside their bubble or caption.** In your French chapter (MangaDex), text crossed the borders it belongs inside:
  - **Page 6:** two captions drawn as one L-shaped box. Each translation spread over both boxes and past them.
  - **Page 9:** a two-lobe bubble. A translation ran past the bottom curve.
  - **Page 20:** a narrow bubble's lines ran out at the top and bottom, and a slanted bubble's text crossed the slant.

  Three causes, all fixed:
  - A translation's room included the whole box of the lettering it replaces. In a curved or slanted bubble that box's corners lie past the outline. The room is now the bubble's inside and the erased lettering within it, never past the outline. The box's own fit is used only when its letters stay inside, margin included (at most 3% into it).
  - When nothing fitted even at the smallest size, lines could run past the box's top and bottom. Now only a little past its sides.
  - Two captions' lettering merged into one paragraph was cut across its rows. Now each line takes its own lines of it. Where a caption's border runs across one region, each line keeps to its side of the border.
  - Testing page 6 in your browser this morning, Claude's box for the first of the two middle captions covered only its first line. That line by line split then gave the caption a one-line room, and its text came out at 16 px. A paragraph merged from several captions is now split by its lettering instead: a line belongs with the line above it when it follows closely and overlaps it across half its width or more. Claude's boxes only decide which item gets which whole caption. Both your reports of page 6 (yesterday's and today's, with different boxes) now give 26 and 29 px.
  - When the lines of one bubble are evened out, none is pulled below 0.7 of its size. A rounding took one to 0.67.

  One margin now keeps text off the outline: 0.15 letter sizes from the outline's ink (below). Before, a second margin came on top, so text in narrow bubbles came out smaller than it needed to. Where the room's centre is far from the lettering's, the text is also tried centred on the lettering, and takes whichever fits larger.

  A bubble's outline is now found from its ink, not only from the bubble model's mask, which is smoother than a burst's spikes. Lettering counts as room only where the bubble encloses it, not in the gaps between a burst's spikes or in a cloud's notches.
- **Lines no longer touch caption borders, bubble outlines or a burst's spikes.** Testing this release in your browser, lines on page 6 came within 1–2 px of a caption's border, and on page 9 against a burst's spikes. Your Naver run showed the same in oval bubbles. The margin was measured from the bubble model's mask, which is smooth and often reaches onto the outline. Two changes:
  - The margin is now measured from the outline's ink, where the ink is known.
  - A box's own fit must keep that margin too, not merely stay inside the outline.
  - Testing page 6 again after these, the two middle captions' lines still came within about 3 px of their borders. The margin wasn't the cause. When two translations' boxes overlap, they're trimmed apart after each one's room is read, and the text was centred on the trimmed box. On page 6 that put it 8 px off its room's centre line, toward the border. Text now stays on its room's centre line. Replayed, those lines clear their borders by 5–6 px.
  - Where the "bubble" is light art around text drawn over it, the art's lines are no outline. Read as one, they set such text at half its size. That text is set to its own box, as before 2.15. Whether the bubble holds its lettering is now judged on the lettering's lines, not their upright box: a slanted bubble's box sticks out past the slant at its corners, and such bubbles were taken for art.
- **Text sits where its room is widest.** On page 6, the room under the two middle captions' lettering narrowed at the bottom. The text was centred on the lettering, so it came out at 17 and 20 px with room to spare above. A text block now stays centred on its lettering when it fits there. Otherwise it moves to where the room is widest for it. Replayed, those captions now come out at 26 and 29 px.
- **A hyphenated word can end a line after its hyphen.** In page 9's right lobe, "remote-controlled" was one word too wide for the lobe, so the whole translation came out at 19 px. A line may now break after a hyphen between letters ("remote-" / "controlled", "peut-" / "être"), with no hyphen added. As with hyphenation, each side keeps at least 3 letters. Replayed, the two lobes now come out at 25 and 30 px (19 and 22 px in your test).
- **The lines of one bubble come out at about one size.** In page 9's two-lobe bubble, the two translations came out at 31 and 20 px, where the letterer used one size. Now they're 30 and 25 px: lines of one bubble whose lettering was one size stay within 20% of each other's size.
  - No line goes under 0.7 of its own lettering's size to match another.
  - A shout beside a whisper (lettering more than 20% apart) keeps both sizes.
- **Claude's "large" and "small" no longer scale a size measured on the page.** Each line's size is measured on the lettering it replaces. Claude's size label scaled it again, so "HA HA HA!" on page 20 came out 1.3 × too large. The label now only adjusts a size guessed for lines with no lettering under them.
- **Korean is drawn at its own size.** Your Naver reports had Korean lines set smaller than drawn. The letter size of a row is the band of rows dense with ink, and a Hangul syllable's lower part (a final consonant, a vowel's stem) is a few thin strokes, so the band stopped above it. Lines Claude read as Hangul are now measured on whole syllables: the rows holding at least 10% of the peak, counting letter-sized marks only.
  - On generated Korean pages (94 lines): 0.88 of the true size before (median), with 14 lines under 0.7. Now 0.95, with none under 0.7.
  - Replaying your report: small lines such as "So cute, honestly." were tiny before, and are now at the lettering's size.

**Measured on pages never looked at while making these changes** (held-out halves; both versions measured again on tonight's bench, 2.14.7 → 2.15.0):

| | 2.14.7 | 2.15.0 |
|---|---|---|
| Text past its bubble: generated pages (150 pages, 810 lines) | 19 (2.3%) | 9 (1.1%) |
| Text past its bubble: the new shapes (150 pages, 1,165 lines) | 52 (4.5%) | 12 (1.0%) |
| Lines touching their outline (within a tenth of a letter): generated (671 lines in bubbles) | 74 (11.0%) | 29 (4.3%) |
| Lines touching their outline: the new shapes (1,026 lines in bubbles) | 200 (19.5%) | 49 (4.8%) |
| Lines a bubble could hold at 0.7 of their size, set smaller: generated | 21 (2.6%) | 14 (1.7%) |
| Lines a bubble could hold at 0.7 of their size, set smaller: new shapes | 27 (2.3%) | 36 (3.1%) |
| Lines under 0.7 of their size: generated | 107 (13.2%) | 109 (13.5%) |
| Lines under 0.7 of their size: new shapes | 160 (13.7%) | 171 (14.7%) |
| Lines under 0.7 of their size: real pages (Manga109-s, 333 pages, 2,752 lines) | 10.3% | 13.0% |
| Lines over 1/0.7 of their size: generated and new shapes | 186 | 134 |
| Korean lines under 0.7 of their size: generated (99 lines) | 14 | 10 |

By shape, text past its bubble went from 27 to 2 lines in slanted bubbles, from 7 to 3 in narrow ones, and from 6 to 1 in two-lobe bubbles.

The first 2.15.0 build you tested sat between the two: text past its bubble 12 and 21 lines, touching 70 and 138, under 0.7 on real pages 14.5%.

On your chapters (replaying your reports through 2.15.0):
- **French chapter (2.14.7 report):** 0 of 70 lines past their room.
- **Naver episode (your 2.15.0 run tonight):** all 121 images translated, none failed. In 2.14.5's report 12 had failed. Lines past their room: 19 of 168 in your run, 10 now. The other 10 sit in dark red bubbles: on pages like 84 and 102, the red Korean under them isn't erased either. 2.14.7 does the same on these pages, so this is on the list for after 3.0.

**The cost is size.** Text kept inside its bubble, off its outline, has less room than text allowed over the outline. On real pages, lines under 0.7 of their size went from 10.3% to 13.0%. The real-page bench has no outline to measure crossing against, so before this release it counted lines as full size when they ran over the outline into the art. On a real page checked by eye, four lines that crossed into the art in 2.14.7 stay inside in 2.15.0, smaller.

**Goals set for this release:**
- Text past its bubble ≤ 1%: met on the new shapes (1.0%). On generated pages it's 1.1%, 9 lines, mostly in bursts, where the bubble model's mask doesn't follow the spikes.
- Lines a bubble could hold at 0.7, set smaller ≤ 1%: not met (1.7% and 3.1%).
- Real lines under 0.7 of their size, no worse: not met (10.3% → 13.0%; see above).

Size inside tight bubbles is on the list for after 3.0.

- **The Report button could export the page before.** A reader that shows the next page in the same image left the extension holding the previous page's translation. A report taken there held the previous page under the current page's address (your page 6 and 9 reports). Only an image still showing the page it translated is exported now.

### Added
- **The debug report shows how much of each line lies outside its room** ("outside" per line, in the extension's and the web app's reports), so text past its bubble shows in a report without anyone having to spot it.

### Development
- **The bench has the shapes that broke** (`synth.mjs --readers`): two caption boxes one over the other, two-lobe bubbles, slanted bubbles, narrow bubbles. Each line is counted by its shape (lines, past the bubble, under 0.7 of its size, over 1/0.7).
- **The bench gives Claude's size labels as Claude gives them** (`bench/labels.mjs`, from your reports), counts oversize lines ("big"), and gives each item Claude's source text.
- **A Gytakusub loaded unpacked reloads itself when `dev-reload.txt` in its folder changes** (`extension/devreload.js`, git-ignored marker). A test run that switches the folder's code writes the file, and the browser runs the new code without anyone clicking Reload on the extensions page. A store install never looks for the file.
- **`replay-report.mjs`** keeps Claude's source text on each item (Korean replays), and `PAGES=06,09` replays only those pages.
- [ADR 0019](docs/adr/0019-text-stays-in-its-room.md): text stays in its room, at the lettering's size.

## [2.14.7] — 2026-11-22

### Fixed
- **A page that fails or is stopped partway no longer leaves memory behind.** 2.14.6 fixed the leak on pages that go well. On a page that went wrong partway, the image engine (OpenCV) still kept whatever the page had made so far, and that adds up the same way. Two cases come up in normal reading:
  - The prefill (the fills done while Claude answers) stops each time the answer comes first. Each stop left the page's colour copy behind: 3 MB for one of your Naver images.
  - A failing learned fill on a graphics card left its window of the page behind, once per area.

  Rarer failures (a model, a page that can't be read) left more. Now each part of the engine frees what it made however it ends, and every page is freed however it ends: answered, scrolled away from, cancelled, or failed. The extension and the web app both do this.
- **If OpenCV still runs out, the next page starts a fresh OpenCV.** Before, every page after it failed until the extension restarted. The error now says it ran out ("its memory at 1024 MB, all it can have"). A page already under way finishes on the OpenCV it started with.

Pages come out the same, pixel for pixel: the identity set (93 real pages, 90 generated) renders identically with 2.14.6 and 2.14.7.

### Development
- **A test that makes pages fail at every point they can** (`tests/fail-paths.test.mjs`, [ADR 0018](docs/adr/0018-a-page-leaves-nothing-in-opencv.md)). It records every OpenCV object with the engine line that made it (`tests/opencv-audit.mjs`), then runs pages through the engine and fails them one point at a time: each of 166 engine lines' OpenCV calls made to throw as OpenCV does, each checkpoint as a stop, and each model run. After each of the 191 failures, nothing may be left alive.
  - The pages cover the engine's paths: a page at its own size, a page analysed smaller, LaMa's fill with the page around each area, the OpenCV text detector, and the analysis without models.
  - With 2.14.6's engine, 162 of the 191 left objects alive. With 2.14.7's, none do.
- **`engine/owner.js`:** each engine function passes the OpenCV objects it makes through an owner, which frees them however the function ends. `releasePage(job)` is new at the engine's door.

## [2.14.6] — 2026-11-22

### Fixed
- **Long chapters no longer fail partway with a number for an error.** In your Naver webtoon report, images 110 to 121 of the episode failed, each with only a number ("Gytakusub Error: 6686152"). The image engine (OpenCV) gets at most 1 GB of memory, and what a page leaves in use stays in use until the extension's worker restarts. Each page left about 7 MB of it in use: when the eraser copied an area out of the page, the view it copied through was never freed, and a view keeps the whole page it came from. Four places did this: the outline check added in 2.14.5, the textured-area fill (twice), and the learned fill's look at the page around an area. They now all go through one helper that frees the view.
  - The 109 pages your report holds, replayed one after another: the memory stays at 128 MB the whole way. Before, it reached 512 MB by page 56.
  - Pages come out the same, pixel for pixel.
- **An engine failure now says what failed.** OpenCV reports its errors as a bare number. The engine now turns that into a message naming OpenCV and how large its memory had grown, so a report shows whether it ran out.

### Development
- **A test that fails when a page leaves memory behind** (`tests/memory.test.mjs`). It runs a generated page through the engine's own entry points (the analysis, the fills done while Claude answers, the finish) again and again, and fails if the memory in use grows. It covers a page analysed at its own size, one analysed smaller (full-size patches), a two-slice webtoon strip, and the learned fill of both kinds (with a stand-in model). Without the fix it fails: 22 MB more after three runs.

## [2.14.5] — 2026-11-22

### Fixed
- **A bubble's outline no longer goes missing next to its text.** The eraser grows past the lettering by a third of the letter size, to take outlined lettering's outline. The area the bubble model marks as the bubble includes the bubble's own outline, so wherever the text ran close, the outline was erased too.
  - Each bubble now finds its outline: ink of the outline's colour joined to the bubble's edge.
  - On a plain bubble, the growth leaves the outline alone, and the bubble is filled with its plain colour. Before, the outline left in place made the bubble count as textured, and the fill smeared the leftover ink into it.
  - On held-out generated pages, bubble outline pixels erased: 3,902 → 1,701. Art damage −8%. Lettering left is unchanged; one line more counts as "lettering stays", 40 of 810 against 39. On the 333 held-out real pages, art damage fell 2% and nothing else changed.
- **Covers and thumbnails at a chapter's end are no longer translated as pages.** In your MangaDex report, the series' covers at the end of the chapter (addresses under `/covers/`) were sent to Claude as three more pages. The extension now drops images whose address names them a cover, thumbnail, logo or ad. This is the rule the web app's chapter mode already used (`notpage.js`, kept the same as the fetcher's by a test).

### Development
- **Found, not shipped: Claude's size label scales a size twice.** Claude labels each line "small", "normal" or "large". The label multiplies the letter size even when that size was measured on the lettering the line replaces, which already carries it. In your reports this affects about 1 line in 5 (13% labelled large, 8% small). The bench never labels sizes on real pages, so it can't measure a change yet. The next step is to simulate the labels as Claude gives them.
- **Report checks, CPU against graphics card.** A replay on the CPU differs from your run for more than one reason. Node decodes and resizes the page with other code than Chrome, so the pixels already differ before any model runs. A replay that says which of the two caused a difference has to run in the browser.

## [2.14.4] — 2026-11-22

The second step of 3.0: the bench now says where text size is lost, stage by stage. Pages come out exactly as in 2.14.3.

### Development
- **Where text size is lost** ([docs/QUALITY.md](docs/QUALITY.md)). Each line set under 0.7 of its size is fitted again, so the bench can say which stage made it small:
  - **The room's width holds most of them.** The line is refitted in a room a quarter wider and a room a quarter taller. On the held-out real pages, 59% of the small lines grow only in the wider room, 32% in either, 6% only in the taller room. These are long English words across bubbles drawn for a column or two of Japanese.
  - **The size estimate costs little.** On generated pages, with the true letter size, 11.2% of lines are set small, against 11.8%. Korean is the exception: 30 → 23 of 197 lines. The engine measures some Korean lines at half their height, because the parts of a syllable are stacked with a gap only the vertical strokes cross.
  - **Most small lines can't be helped by any layout.** A line alone in its bubble was wrapped into the bubble's true interior at 0.7 of its size, with no margin from the outline and the best line breaks. For 72% of them even that doesn't fit: the translation is too long for that bubble at that size. The other 39 of 1,615 lines (2.4%) could have fitted. This is what the engine can still win.
  - The real pages have no true bubble shapes, so only the first split is measured there.
- **Two changes tried and dropped.** Both were measured on the looked-at generated pages:
  - **Squeezing the letters to 85% of their width in narrow rooms.** Lines set small went 10.6% → 9.7%, but text running past its bubble went 8 → 12 lines. In a bubble, only fits to the bubble's shape were squeezed; squeezing every fit gave 7.8% small lines and 32 past their bubbles.
  - **Measuring a line's height across gaps that strokes cross** (Hangul syllables, capitals' bars). Korean lines set small went 16 → 11 and Latin dialogue was measured closer to its true size. But the eraser grows by the letter size, so with truer sizes it took more:
    - bubble outline pixels erased +15% (Korean ×3.8);
    - art damage +7%.

    The measure and the eraser's growth have to change together, the growth following the outline's own thickness. That is now part of 3.0.
- **Art damage on printed and slanted lettering is mostly the eraser's mask.** Over tone or an object's surface, the mask takes the line's whole box, not only its letters, so any fill changes those pixels. Filled by the model the extension runs on the CPU (`--fill aot`, new in both bench scripts) instead of Telea, the damage fell by 13–26% on three such pages, at four to six times the time.
- **QUALITY.md now counts the whole looked-at half of the real pages**: 321 pages, up from 176. The held-out numbers are unchanged.

## [2.14.3] — 2026-11-22

The first step of 3.0, "Measured core": the engine gets one public entry point and one file for its numbers. Pages come out exactly as in 2.14.2.

### Development
- **One entry point to the engine.** The extension's service worker and the web app's worker now reach the engine only through `engine/index.js`. Any thread can load `engine/contract.js` without the models: it holds how a page is cut for the model and how the model's answer is checked. `prompt.js` re-exports it, and the engine no longer imports `prompt.js`. CI checks this boundary (`scripts/check-engine-contract.mjs`), so a stage can be replaced without touching a caller.
- **The engine's numbers in one file.** `engine/tuning.js` holds 251 values by stage: layout, eraser, analysis, detector, screentone fill, learned fill, page. Each has its unit and what it bounds. Unless a line says otherwise, a value was set by hand before the bench existed. A test checks that each is a number the engine reads. Not moved: what belongs to a model (its input sizes, the bubble model's thresholds), and the rule-based analysis used only when no text detector loads.
- **The bench can vary them.** `GYT_TUNE='{"LAYOUT":{"adoptMaxLetter":5}}'` changes values for one run, to see which ones a result hangs on (docs/QUALITY.md).
- **Checked: nothing changed.** 176 real pages, 60 generated pages and 30 with printed and slanted lettering came out identical to 2.14.2: every count, and every pixel of each erased page.
- **Generated pages with printed and slanted lettering** (`--printed`): lettering printed on tilted objects, sometimes white on a dark emblem, and free text slanted up to 0.4 rad. Your Portuguese chapter left lettering there, and the bench had neither. On 300 such pages (2.14.2), lines whose lettering stays: bubbles under 1%, printed on objects 18–20%, free text 22–25%, slanted 33–40%. These are the cases 3.0 works on.
- **Report checks set apart what the replay can't reproduce.** A line placed differently in the replay than in your report (6 of 77 in the Portuguese chapter, run on your graphics card) is listed as "replay differs", not counted as a failure of the engine.

### Web app
- The offline cache now holds every engine module. It lacked four (the detector, the bubble model's code, the model runtime's loader, and the rule-based analysis), which loaded only from the network.

## [2.14.2] — 2026-11-21

The first release measured on pages it was never tuned on, and more of each line's lettering erased.

### Pages
- **Lettering split into two pieces is erased whole.** The detector sometimes finds one line of large lettering as two pieces: a title and its small reading beside it, or two columns of one shout. Claude's line was tied to one piece, and the other stayed on the page next to the translation. Now any lettering under a translated line's box is erased with that line, unless another line claims it. This covers free text only, and never a sound effect or a line left as drawn. The translation stays where it was.
- **Marks that run past the detector's box are erased in plain bubbles.** A long vowel mark (えーー), a wave dash or the end of a column could run past the box the text detector drew. It was then taken for art and left. In a bubble whose surface is one colour, every mark wholly inside the bubble that reaches the lettering is now erased. A long, thin mark counts only if it runs along its own line, never if it's an arc of the outline. Bubbles over tone or art keep the old rule: there, the same sweep also erased strands of hair and foliage.
- **Measured on pages never tuned on** (see Development):
  - **Real pages:** 333 pages from the 44 held-out Manga109-s books, which nobody looked at while making this change.
    - Lettering the independent detector still sees after erasing: 57 → 50 of 2,839 pieces (2.0% → 1.8%). Better on 6 pages, worse on 1.
    - Lines found: unchanged. Sound effects changed: unchanged.
    - Pixels changed away from any text: 0.119% → 0.121% of a page (+1.7%), most of it on one page.
  - **Generated pages:** 150 held-out pages in seven scripts.
    - Lines whose lettering was left untouched: 44 → 39 of 810. Better on 5 pages, worse on none.
    - Changes away from the text: +5.6%. Bubble outlines: unchanged.
  - **The extra change to the art** is, as far as I can tell, the fill around the lettering now erased. The bench can't separate that from harm to the art.
  - **A broader version was tried and dropped.** On the books looked at, it removed three times as much leftover lettering (36 → 23 lines of 1,514) but changed 13% more pixels away from text: hair and foliage that the bubble model took for bubbles.

### Development
- **The quality bench** (`tests/bench/`, [docs/QUALITY.md](docs/QUALITY.md), [ADR 0017](docs/adr/0017-measured-on-pages-never-tuned-on.md)). From now on, engine changes are measured on pages they were never tuned on, against answers the engine's rules can't bend:
  - **Real pages:** 654 Manga109-s pages, four spreads from each of its 87 books. Researchers boxed every line and outlined every sound effect. The books are split by a hash into a half that's looked at and a half that's only counted.
  - **Generated pages:** seven scripts (Japanese, Chinese, Korean, English, Spanish, Portuguese, Vietnamese), drawn with and without their lettering, so every glyph, bubble and letter size is known exactly.
  - **An independent detector** (ogkalu's comic-text-and-bubble-detector, not part of Gytakusub) checks what is left after erasing.
  - Claude's answers are simulated from the marked boxes.
  - `bench/report.mjs` writes the numbers into QUALITY.md, and into the README from 3.0.
- **2.14.1 checked the same way.** Against 2.14.0: no measure worse. Lines set under 0.7 of their size went 10.7% → 10.1% on the real pages looked at, and 31% → 24% for Japanese on generated pages.
- **The first numbers show where the engine is weak:** free text over art (on generated pages, 29% of its lines are left partly unerased, against 0.4% of bubble lines), and small English from Japanese, Chinese and Korean.
- **Legal:** Manga109-s may not be redistributed. Its pages stay on the machine running the bench (`tests/bench/data/`, ignored by git), and only the list of pages used is committed. Its terms ask that published results name it and cite its papers; QUALITY.md does.
- Tests:
  - lettering a translated line's box holds, that no other line claims, is erased with it (and never a region another line names, or one the box only grazes);
  - a long vowel mark run past the detector's box in a bubble is erased with its column;
  - black lettering in a white outline over dark art, found only on Claude's box, is erased letter and outline.

### Web app
- All of the above (same engine).

## [2.14.1] — 2026-11-21

Fixes from your Portuguese chapter read with 2.14.0, and text set to the bubble's shape (the start of the 2.14 step's layout goal).

### Pages
- **A line left as drawn keeps its lettering.** Page 5's "AH..." (given back as drawn) was erased, and its part of the bubble left empty. Claude's box for it lay a few pixels beside the lettering, a piece too small to anchor a translation to, so the two were never matched. A line left as drawn now keeps the piece of lettering its box lies on, or failing that the one nearest it within a letter, among all of the bubble's lettering.
- **Capitals stacked in a narrow bubble are measured right.** The text detector took "O QUE / QUER / DIZER / COM / ISSO?" for one column, and its width (62 px) was taken for the size of letters 14 px tall. The eraser, which grows by that size, ate into the bubble's outline (grey smudges), and the translation was aimed at it and ran to the outline. A column whose rows of ink are far shorter than it is wide, each with several marks across it, is a stack of rows, and the height of those rows now sets the size. Real columns keep their width, including ones with "…" down them and glyphs made of bars (テ).
- **Text follows the bubble's shape.** Each line can be as wide as the bubble is at its height, at least a fifth of a letter clear of the outline, instead of all lines keeping to one rectangle inside it. The shape is used where it gives larger text than the rectangle. In ovals the text comes out larger and in fewer lines. On 15 of your reports, lines set under 0.7 of their original size went from 173 to 157 of 1,714 (10.1% → 9.2%), and lines under 12 px on a page 1,000 px wide from 25 to 22. The goal for the 2.14 step is under 3%: most of what is left is English set in Japanese bubbles that are tall and narrow, or in two narrow columns of one bubble (one per line Claude gave).
- **No extra call to Claude for names with a hyphen or links.** "S-SENPAI?", "P~HAAAH!!", "HARU-CHAN." and "HTTPS://BIT.LY/…" given back as drawn count as one word (no space in them), and stay as drawn straight away. On that chapter they made 5 pages wait for a second call.
- Measured on 15 of your debug reports (the 14 used for 2.14.0 and the Portuguese chapter, replayed with their saved answers; they stay local): lettering left (40 of 1,690) and translations drawn over unerased lettering unchanged; lines drawn under 0.6 of their original size in bubbles 101 → 91. 582 areas changed. I compared about 140 of them by eye (from 7 of the 15 reports, and every one outside Claude's boxes): in most the text is larger and in fewer lines, and the outline smudges and the empty "AH..." are gone. I found none worse; some ovals now have a single short word on their top line ("I / need to / polish my…"), where the shape narrows.

### Debug report
- **Lines dropped as sound effects or logos are listed** (`timing.dropped`, with their original and translation). On page 7, "ESTRANHO..." ("Strange...") and on page 8 "Tão num encontro?" ("Are they on a date?") were not translated, and the report couldn't tell whether Claude skipped them or labelled them sound effects. The next report will show which. If it's the label, the prompt is next.
- Why areas filled ahead were filled again, from your report: all 17 misses were `"area"`. While Claude answers, every piece of lettering found is erased ahead. After the answer, sound effects and lines left as drawn are not erased, so the areas around them differ (my reading of the code; it fits the 10 pages concerned). It costs about 0.2–0.5 s per such area on your graphics card, and that chapter's pages finished in 2 s at most. Left as it is.

### Web app
- All of the above (same engine, text fitting and prompt).

### Development
- `layout-score.mjs` fits text as `draw()` does (the shape too); the audit and `layout-score.mjs` replay lines given back as drawn (`same`).
- The accessibility test shows its page 280 px wide (the narrowest translated) for the readable view: at 330 px the larger text no longer came out under 9 px.
- Tests: a line left as drawn keeps its small piece of lettering (Claude's box grazing it, or missing it); stacked rows measured as rows, and real columns (square glyphs, glyphs in pieces, an ellipsis, bars) keeping their width; a line's room in an oval row by row; text set to an oval larger than in its rectangle, every line inside; links and hyphenated names as one word; dropped lines listed.

## [2.14.0] — 2026-11-21

Fixes from the Kamen Rider W chapter read with 2.13.1, and long strips in the web app shown part by part.

### Pages
- **No more half-minute wait on a page with a huge sound effect.** 2.13.1's debug report showed the cause, and it was not the graphics card (its fills on that page took 0.4–0.5 s). It was the quick eraser (Telea) that covers a textured area until its fill is done. It looks around each pixel over 0.3 of the letter size, and its time grows about with the square of that reach: for the sound effect of 125 px letters, over most of the page, it reached 38 px and took 35.6 s here (about 31 s in your report: the page's fills ahead started 31 s late). It runs on the thread that also takes Claude's answers, so Claude's time read 35 s on that page and 34 s on the page before it. Its reach is now 6 px at most, what dialogue up to 20 px letters always had: erasing that area takes 3.2 s here instead of 36.7 s. Where the area is filled afterwards (LaMa, or AOT without a graphics card), the reach doesn't show; replayed with neither, the 106 areas it changed came out about the same (crude either way; compared by eye).
- **A line Claude gives back untranslated is asked again.** Claude now gives every line's original text along with its translation (the "Also transcribe the original text" option is gone; it is always on). A line whose translation is its original, word for word, isn't drawn as given:
  - a single word ("Ah!", a name) stays as drawn;
  - a longer line is asked again, as text, in one short call for the page. Translated this time, its translation is drawn; given back the same again, it is already in your language and stays as drawn, rather than being erased and lettered again with the same words.

  On the Kamen Rider chapter, "No hay nada que no pueda crear!" came back in Spanish on both readings, and its English credits page was lettered again over itself. Each answer is longer by the originals' text (not measured; Options → What translating costs shows it per page). Pages translated before are asked again once (the cache key changed).
- **Fewer words broken with a hyphen.** A word is split only when it has 8 letters or more, with 3 letters at least on each side: "CY-CLONE!", "TRIG-GER!" and "ex-pect-ed..." are no longer cut, and the line is set a little smaller instead.
- Measured on 14 of your debug reports (the 13 from 2.13.1's notes and the 2.13.1 chapter, replayed with their saved answers; they stay local): lettering left (38 of 1,520 lines) and translations drawn over unerased lettering unchanged. The new line breaks set 12 more lines under 0.6 of the original lettering's size (100 against 89 of the lines in bubbles), "As I expected..." in a narrow bubble the smallest at half; in return words like "Kam-abakka King-dom" stay whole, and "Pa-thet-ic——!!" no longer runs out of its bubble. All 145 changed areas were compared by eye with 2.13.1. I found none worse in a way that matters; the one I'd call a loss is that "As I expected...". The replay can't show the originals and the re-ask (those reports' answers have no originals); tests cover them, and your next report will show them.

### Debug report
- **Why an area filled ahead is filled again.** While Claude answers, the textured areas are filled ahead. In your 2.13.1 report, 14 pages needed fills after the answer and had some done ahead; on 6 of them none of those done ahead was used, and every area was filled again. I could not make that happen here. Each fill done again now says whether that same area was filled ahead with a different stretch of page around it (`fill.runs[].miss: "around"`) or not at all (`"area"`). Not fixed.

### Options
- "Also transcribe the original text" is gone (always on, above).

### Web app
- All of the above (same engine, prompt and text fitting).
- **A long strip shows part by part.** A tall screenshot is translated in parts, as the extension does it: each part is analysed and sent to Claude at once, and drawn as soon as it is finished ("translating… 2 of 3 parts done"). The app waited for the whole strip before.

### Development
- ADR 0016 (lines given back as drawn).
- `npm run audit`: `GYT_PAGES=03,07` replays only those pages.
- Tests: Telea's reach; the fill's miss reason; every line's original asked for; lines given back word for word (one word, re-asked and translated, re-asked and the same, a failed re-ask); a line given back keeps its lettering; the hyphenation rule; a long strip in the web app, part by part (browser test).

## [2.13.1] — 2026-11-20

Fixes from the first two chapters read with 2.13 (a romance chapter and Kamen Rider W).

### Pages
- **Hand-drawn capitals are measured right.** Where their ink sits in a few heavy rows (thick bars at the foot of the letters, an "S" beside a dash), letters about 18 px tall were measured at 4–7 px. Their lettering was then taken for art and partly left on the page ("QUE", "SEI DE", "EU" under the English), and the translation came out tiny. The letters' own height now sets the size when the old measure is under 40% of it. Whether a line is lettering at all, and which lines group together, is still decided on the old measure, so a face's eyes don't become a bubble and furigana stays with its line.
- **Huge sound effects no longer set the size of a bubble's text.** On a page whose only lettering found was its sound effects, their size (125 px) was used for a bubble whose own lettering measured small: "There you are!" came out in 64 px letters, broken as "e / you / ar- / e!" and spilling out of the bubble. Such a bubble's size is now held to a quarter of the bubble across.
- **A word is never cut letter by letter while a smaller size would fit.** The smallest size a line may take (a share of the original lettering's size) now gives way first when even that doesn't fit the box.
- **Not fixed: that page's 36 s wait.** While Claude answers, the engine fills a page's textured areas ahead; once the answer is in, it finishes the fill under way and stops. On that page the two areas filled ahead took 33.7 s together (the bubble's, sized from the 125 px letters, and the sound effects' block, most of the page), where your graphics card normally takes 0.2 s a fill. Why is not known, so nothing about it changes here: the debug report below now records what is needed to find out. (The bubble's area is its usual size again, from the fix above.)

Measured on 13 of your debug reports (the 11 from 2.13 and the two read with it, replayed with their saved answers; they stay local): lettering left under translations 45 → 38 of 1,401 lines; translations drawn over unerased lettering 28 → 24; words cut letter by letter gone from the 5 pages that had them. All 188 areas whose render changed were compared by eye with 2.13.0. I found none worse; a few only changed size.

### Debug report
- **A timeline of each page.** When it started (`timing.start`), Claude's own time (`timing.claude`; "model" is that plus any wait for a fill under way), and each textured area's fill (`fill.runs`, and `fill.preRuns` for the fills done ahead): how, how big, when it started, its whole time and the model's own run in it. On that page the report gave only the 33.7 s total: not which fill, nor whether the model or something around it was slow, nor what else ran meanwhile.

### Web app
- All of the above (same engine and text fitting).
- Housekeeping: an unused constant removed (`FETCHER_VERSION`).

### Development
- `tests/letter-size.test.mjs`: the letter measure on drawn capitals, an "S" beside a dash, a lowercase line and a stray outline; a bubble's size bound; the fit's floor giving way. `inpaint.test.mjs`: the model's run time is reported.

## [2.13.0] — 2026-11-20

Clean art, first part. Third step of the 3.0 plan: what Claude reads is erased, or left exactly as drawn.

### Pages
- **"…" and "!" stay as drawn.** A line whose translation has no letters (only dots, marks or "♪") reads the same in any language. It was erased and drawn again, and dots too small to find came out doubled. In a bubble with other lines it keeps its lettering, and the other lines' text keeps off it.
- **Sound effects and logos are left alone.** Claude was told to leave sound effects out but returned them anyway (at least 16 lines in 7 of 11 reports), and they were drawn over the unerased original. It now labels them, with series logos, magazine marks, scan credits and page numbers, and those are dropped. Chapter titles, blurbs and captions are still translated. Pages translated before are asked again once (the cache key changed).
- **Lettering the detector missed is looked for again.** When nothing was found under a translated line, the detector looks at just Claude's box, zoomed in, and what it finds is erased like any other lettering. Big shouts beside a bubble and small print are found this way. The debug report records it (`timing.look`).
- **Two lines given one bubble's number are sorted by their boxes.** The line lying on another bubble's lettering goes to that bubble, and a shout boxed outside the bubble takes the lettering under its box, instead of both translations crowding one bubble while the other's original stayed.
- **No more white flecks around bubbles.** Lettering found by its colour in a bubble is now taken only when it lies wholly inside the bubble; tone and art just past the outline were painted with the bubble's white.
- **Art and screentone are filled by LaMa on a graphics card.** A LaMa model finetuned on manga continues screentone under removed lettering where the previous model (AOT) left a blurred ghost of the letters. On a black-and-white chapter, with lettering drawn over real stretches of its pages, its fill came out closer to what was there in 10 of 12 areas (SSIM 0.47 → 0.59); on a colour chapter the two were about even. It sees the 512 px of page around each area. Without a graphics card AOT stays (LaMa costs several times as much). The debug report shows which one ran, with its load and first runs (`fill.model`).
- The extension is about 103 MB larger (the LaMa model).
- On 11 of the owner's chapters (they stay local), replayed with their saved answers: translations drawn over unerased lettering 29 → 16, and lines whose lettering is left 31 → 24 of 1,095 (not counting 10 that only the replay of old reports gets wrong). Most of what remains is what the new labels drop (drawn over: 6 sound effects and 5 logos, marks or page numbers; left: 11 logos and 2 sound effects), which shows only on a chapter read with them. Every changed area was compared by eye with 2.12.0.

### Web app
Everything above reaches the web app too (it runs the same engine), and it catches up with 2.12.1:
- **LaMa on a graphics card**, iPhone included. Downloaded the first time a page needs it (103 MB, once; the browser keeps it). If the tab dies twice while it loads or first runs (a phone out of memory), the app keeps to AOT on that device; the debug report says which.
- **The translation is text too.** It was only a picture: now it lies invisibly over the drawing, so screen readers read it, Find in page finds it and it can be selected and copied. Selecting it doesn't flip the page to its original.
- **A page survives the engine dying.** When the engine stops with an error (a phone short of memory), the next page starts a fresh one; the page it was working on is done again on it, with Claude's answer kept rather than asked for (and paid) again. Pages failed until Redo before.
- The Originals toggle is announced as a switch.
- The models are no longer copied into the app's offline cache on every visit (the browser's own cache keeps them, once).
- Changes to the shared strings and the version now redeploy the web app (2.12.1 changed only those, and was not deployed).

### Development
- `npm run audit`: overlapping bubbles are matched by overlap (the centre rule matched a neighbour), lines drawn without erasing are listed, and lines left as drawn are not counted.
- `scripts/lama-static.py` makes `vendor/lama.onnx` from the pinned upstream export (`node scripts/vendor-inpaint.mjs lama`): fixed at 512 px, it loads in under 2 s instead of ~16 s. The GPU test runs it on WebGPU against the CPU.
- ADR 0015.

## [2.12.1] — 2026-11-20

The overlay without a mouse, and pages that survive the extension's background restarting.

### Extension
- **Pages ask again when the extension's background restarts.** Chrome stopped the background in the middle of a chapter (a report: the last two pages failed with "message channel closed", and worked when you pressed Translate). A page it had in progress is now asked again by itself, twice at most; one Claude had already answered comes from the cache.
- **The translations are text the browser can read.** They're drawn on a canvas, which screen readers, find in page and the browser's own translation can't see. Each line is now also a transparent button over the drawn one, grouped per image ("Translated text"); the canvas is hidden from screen readers so nothing is read twice.
- **Keyboard:** Tab reaches an image's lines (one stop per image), the arrow keys move between them without turning the page, Enter opens the editor.
- **The editor is a real dialog** (a modal `<dialog>`): the keyboard stays in it, Esc or a click outside closes it, and the focus goes back to where it was. Ctrl+Enter saves; Enter in the glossary fields adds the term instead of saving the line.
- **The readable view** (a small line shown at a readable size) also appears for the line the keyboard is on, and on a long press (touch) for any line, with an Edit button. It stays while the pointer moves onto it, and Esc puts it away until the pointer goes to another line (WCAG 1.4.13).
- **The popup's and Options' toggles are switches** for screen readers (`role="switch"`), not checkboxes.

### Development
- `tests/browser/a11y.mjs` (21 checks): the accessibility tree, the keyboard, the editor, the readable view (focus, hover, Esc, long press) and the switches.
- `tests/browser/startup.mjs` part 4: the worker is stopped while three pages are with Claude; all three finish on their own. 2.12.0 leaves all three failed.

## [2.12.0] — 2026-11-18

Clean bubbles. Second step of the 3.0 plan: a robust core before new features.

### Extension
- **Auto-translate starts on the first load.** A page asked the extension for its settings once; when that answer failed or came too late (the extension's background still starting), the page kept its defaults until reloaded: no auto-translate, and the button's raw label ("content_btn_translate"). It now asks again until it has them, and the background reloads its own words when reading them failed.
- **A reload doesn't pay for its pages twice.** When a page goes away (reload, next chapter), its pictures not yet sent to Claude are dropped; one already on its way is waited for by the reloaded page instead of asked again.
- **On the graphics card, pages ask Claude side by side.** Pages off screen were held back while the page on screen was in progress, so a chapter's questions went out one at a time, up to 20 s apart. The hold is for the CPU, where the models block everything else, and now applies only there.
- **Only pages are translated.** An image counted by the size of its file, so a site's logo (shown 182×50), a cover thumbnail and reaction emoji (42×42) were translated, paid for and counted as pages. The logo, first on the page, also took the slow first fill below ahead of the chapter. Images now count by the size they're shown at (280 px each way, as before).
- **A tall image goes part by part.** A chapter served as one image (800×17055 px in a report) was analysed, sent and drawn whole: about a minute before anything showed, and all of it paid for at once. Each of the slices the engine already reads it in is now a part with its own place in the queue, its own question and its own drawing, the part on screen first; auto-translate takes the parts near the screen as you scroll, as it does pages. The count, the button and the debug report treat the image as one page.
- **The button follows its image.** It was placed only when the pointer entered an image: on a tall image it stayed behind as the page scrolled, and a wider label ran past the image's edge.
- **The inpainting model's trial run is at full size.** In three reports from Windows, the first learned fill of 128 px or more took 14–20 s after each start of the extension's background, though the model loaded in 0.3–0.4 s and the 72 px trial run took under 0.1 s. Counted on Dawn here, the model makes 3 of its 33 GPU programs only from 128 px up; whether those are the 14–20 s on Windows isn't known yet. The trial run is now at 768 px, beside the queue, once a page has an area that needs the model and the pages near the screen are analysed; only pages that need it wait for it. The report records the load, the trial run and a second one (`fill.model`: a long first and short second run means the cost was the first run) and a page's wait (`timing.modelWait`).
- **The background stays up while you read.** Chrome stops an extension's background after 30 s without an event, and the models went with it: reports 12 minutes apart each paid the load and the slow first fill again. While auto-translate is on and the tab is in front, the page sends a word every 20 s, for 10 minutes after its last translated page.
- **Screentone fills at full size are about 2× faster overall, 5–9× on the slowest areas** (2 areas of a mangadex page: 1.6 s and 3.7 s, now 0.3 s and 0.4 s), with the same result to the pixel on 42 areas of two reports. The fill skips copies that can't land on known pixels.

### Pages
- **Pages appear as soon as the translation arrives.** The texture fills below now run while Claude is answering, not after. On an M4 MacBook they had added up to 1.7 s to each page (0.65 s on average on a black-and-white chapter); a page now waits for nothing but the answer. The page comes out exactly the same.
- **Free text the detector missed or cut short is erased.** When Claude translates a line outside a bubble whose box holds lettering the analysis had set aside (a title too big for dialogue, small print, a line it dropped), that lettering is erased and the translation gets its room. A long caption's box no longer takes the credits beside it. Logos read as a stack of lines and lettering far above dialogue size are left alone. Lettering that can't be erased cleanly (outlined display letters) stays as it was rather than half-erased.
- **Coloured lettering is erased whole.** Blue, orange and pink letters, in bubbles and on plain backgrounds, were found by their dark parts only, so most of each letter stayed. They are now read by colour against the plain surround. Screentone and art still use the old masks.
- **A loose box no longer pulls a line out of its own region.** A line moves to another region only when its box lies mostly on that region and little on its own.
- On seven chapters (they stay local), lines whose Japanese an independent detector still finds after erasing: 66 → 33 of 780; on a colour chapter 18 → 2. Marks left in bubbles: 16 → 6. Every erased area was compared with 2.12.0: none worse, 19 better, 13 newly erased (each checked by eye).
- **No more white clouds on toned bubbles.** The eraser now covers the white outline round lettering, which it used to leave behind and smear over the tone.
- **Screentone is continued dot for dot.** Where a bubble or a panel is screentone, the eraser measures its pattern and copies it into the hole in step with the dots around it. It only does this when the pattern really predicts the surrounding tone; otherwise the next fill takes over.
- **Art and irregular tone are filled by a manga-trained inpainting model** (AOT-GAN), on the graphics card when there is one. On 150 stretches of real pages with lettering drawn over them, the fill came out closer to what was really there in 142 (SSIM 0.45 → 0.62).
- **Narration over art no longer takes the art with it.** Free text is erased line by line. On a cover page where lines of text and strokes of the drawing were read as one block, the faces under it used to be erased too.
- White bubbles are filled with their own white, as before.
- Without a graphics card the inpainting model works at a smaller size (it costs seconds per area on a CPU). The model is loaded only when an area needs it.
- The extension is about 23 MB larger (the inpainting model).

### Web app
- The same eraser, with the same fills ahead of the answer. The model is downloaded the first time a page needs it (white bubbles and screentone don't), then cached; as in the extension, it loads beside the pages' work.
- **Export debug report** (Settings → App): one .zip of the translated pages, with the original images, Claude's answers, the regions, the timings and a render of each. It's the extension's format, so a problem seen on a phone can be replayed. On a phone it opens the share sheet (Save to Files); it holds the page images, so share it privately.

### Development
- `tests/browser/strip.mjs` (in `test:browser:extension`): a reader page with a logo, a cover, emoji and a chapter as one tall image. 2.12.0 as first built fails 7 of its 9 checks.
- `tests/browser/startup.mjs` (in `test:browser:extension`): auto-translate when the first settings reads are turned away, pages left in the worker when the reader leaves (never sent), and a reload while a page is with Claude (asked once). 2.12.0 as first built fails the first and the last.
- `npm run audit -- <report> <out> --rtdetr detector.onnx`: lines whose lettering survives erasing, by comic-translate's text detector as an independent witness; also translations drawn far from their text or shrunk for want of room, and every erased area's marks (`marks.json`) to compare two builds area by area.
- `tests/freetext.test.mjs`: adopting set-aside lettering, which box gets it, the logo and bubble guards, the stamp rule, and blue and orange lettering erased whole. Added to `test:extension`.
- `tests/tone.test.mjs` checks that a page filled ahead of the answer comes out identical, also when the inpainting model isn't loaded yet; the real-browser test checks the fills are done before the answer.
- The debug report's timing adds `wait` (time waiting for the engine), `fill.ready` (areas filled ahead) and `fill.pre`.
- ADR 0014.
- `tests/fill-truth.mjs`: the eraser's fill against known backgrounds on real pages (they stay local).
- `tests/lattice.test.mjs` (the screentone fill), `tests/inpaint.test.mjs` (the learned fill), `tests/tone.test.mjs` (a synthetic page with toned and gradient bubbles and narration on screentone, 2.11 vs 2.12). Added to `test:extension` with a check of the vendored model against its record.
- `tests/residue.mjs`, the marks-left measure behind `npm run audit`: four faults fixed, and areas on a textured surround counted apart, since there it misjudges both ways. See ADR 0013.
- The debug report's timing has `fill`: areas by how they were filled, and the time the texture fills took.
- README rewritten for visitors; how it works moved to `docs/ARCHITECTURE.md`, development to `CONTRIBUTING.md`.
- ADR 0013.

## [2.11.1] — 2026-11-17

### Pages
- **Auto-translate no longer leaves a page untranslated while you're looking at it.** If you scrolled far past a page before Claude was asked, and came back before that cancellation reached the page, the page stayed untranslated until you pressed Translate. Auto-translate now re-checks every page near the screen once scrolling settles, after each page finishes and after a page is put back, instead of only reacting when a page comes into view.

### Development
- `tests/browser/autostall.mjs` plays that race three times: 0/3 pages translated before the fix, 3/3 after. Added to `test:browser:extension`.

## [2.11.0] — 2026-11-17

Sharp on every screen. First step of the 3.0 plan: a robust core before new features.

### Pages
- **The translation is drawn at your screen's own pixels.** It used to be drawn once at the engine's working size (at most 1600 px) and stretched: 2.4× on a 2× laptop screen, 3.6× on a 3× one, so the text looked soft. Now the overlay has one pixel per screen pixel, measured from 390 to 2560 px wide on 1×, 2× and 3× screens.
- **It is drawn again when the window, the zoom or the screen changes**, once the resize settles.
- **The erased areas have the page's own resolution.** Pages bigger than 1600 px used to get softer patches cut from the smaller working copy.
- **Lines too small to read can be read.** In a narrow window, a line drawn under 9 px shows at a readable size beside its bubble while the pointer rests on it.
- Pages far from the screen give their memory back and are drawn again when you scroll back.
- The erasing itself is unchanged: white smudges on toned bubbles and art are still there, just sharper. That is 2.12.0.

### Web app
- **Translated pages are drawn with the original's pixels or the screen's, whichever is more.** They used to be 1600 px at most. A saved page, or one you zoom into, is as sharp as the source, and on a tablet or an unfolded foldable the text is as sharp as the screen. Very long strips are capped at 16 million pixels, iOS Safari's canvas limit.
- **Unfolding a foldable, turning the phone or widening the window redraws pages** that now need more pixels.
- The translation is part of the page image, so it stays exactly where the original lettering was at every size. Checked on a folded phone, a phone sideways, an open foldable and an iPad in both orientations.

### Development
- `tests/browser/screens.mjs`: every size and density in the real extension (47 checks: the overlay's pixels, that it sits exactly on the picture, that each line keeps its size relative to the page, the readable view, releasing far pages); it also takes `--page` (any image), `--ext` (another build) and `--measure-only`.
- `tests/browser/web-screens.mjs`: the web app on phone, foldable and tablet screens (26 checks, unfolding included).
- `tests/fullsize.test.mjs`: full-size erasing lines up with the original and leaves everything outside the mask alone.
- `npm run audit -- report.zip outdir`: the core audit used for the 3.0 plan (erased bubbles with marks left, lines drawn over unerased text, renders and a crop sheet of the worst bubbles).
- The debug report records the overlay's pixel ratio, its pixels and each line's size on screen.
- ADR 0012.

## [2.10.0] — 2026-11-17

The web app's own screens in the reader's language.

### Web app
- **The web app follows the target language**, like the extension, in the same ten languages: the install steps, screenshot mode, the chapter-link setup, the fetcher page, Settings, and its messages and errors. Other target languages keep it in English.
  - Saving another target language in Settings switches it at once, without a reload.
  - On a first visit it guesses from the phone's language, as before.
- GitHub's and Cloudflare's button names stay in English in the setup steps, with a note saying so, because those sites are what the reader has to find them on.
- iPhone and Android menu names are written as the system shows them in each language, as far as I know (not checked on real devices).
- The model menu shows just the names, with what the chosen one is good for underneath, as in the extension's popup.
- Japanese wraps between phrases and Korean between words, as in the extension.
- Two fetcher messages pointed at the wrong setup step ("step 4" for the key, "step 1" to generate it). They now say steps 5 and 2.

### Development
- `web/locales/<locale>/messages.json`: the web app's 181 messages, checked by `scripts/check-i18n.mjs` (now also part of the web test suite).
- `tests/browser/web-i18n.mjs` (83 checks).
- ADR 0010 has a 2.10.0 section.

## [2.9.0] — 2026-11-17

Lettering that works in every listed language, in the extension and the web app.

### Pages
- **Every listed language has its own letters.** Comic Neue had 3 of the 52 Vietnamese letters I tested, and none of the Cyrillic ones. The browser filled the gaps from another font, so a word like "người" came out in two fonts. Two more open-licence comic fonts are bundled:
  - **Comic Relief Bold**: Polish, Turkish, Russian, Ukrainian and other Latin and Cyrillic languages.
  - **Mali Bold**: Vietnamese and Thai.
  
  A page is lettered in the first font that has all its letters, so a word never mixes two fonts. English and the Western European languages keep Comic Neue, at the same sizes as before.
- **Chinese and Japanese translations were drawn at the minimum size** (before 2.8.0 too, for anyone who typed them in). Lines broke only at spaces, and these languages have none. They now break between words (the browser's `Intl.Segmenter`), with the line-start rules readers expect: no line starts with 。、」！？ or a small kana, and none ends with 「 or （. In a test bubble Chinese went from 8 px to 23 px, Japanese to 19 px.
- **Chinese, Japanese and Korean use the system's font for that language** (Hiragino / Yu Gothic / Meiryo, PingFang / Microsoft YaHei, Apple SD Gothic Neo / Malgun Gothic, Noto CJK), so shared Han characters take the right forms.
- **Hyphenation in the target language**: German, French, Spanish, Portuguese, Italian, Dutch, Polish and Ukrainian, as well as English. It only kicks in when a line doesn't fit whole. Vietnamese and other languages without patterns are no longer split by English rules. Russian, Turkish and Indonesian patterns aren't bundled because of their licences (LPPL, GPL-2.0), so those break at spaces only.
- UPPERCASE lettering follows the language (Turkish i → İ, German ß → SS).
- **Thai** joins the target list. Its interface stays English.

### Debugging
- Debug reports say which font a page was lettered in, and whether it was hyphenated.

### Web app
- The same fonts and rules. Its offline cache now includes the language files 2.8.0 added.

### Development
- `scripts/vendor-fonts.mjs` writes each font's characters and cap height into `vendor/lettering-fonts.js`; `scripts/vendor-hyphen.mjs` also writes `vendor/hyphen/*.json`. CI regenerates both.
- `tests/lettering.test.mjs` (24 checks) and `tests/browser/lettering.mjs` (37 checks: seven languages through the real extension).
- ADR 0011: `docs/adr/0011-lettering-per-language.md`.

## [2.8.0] — 2026-11-17

Languages: pick the target from a list, and Gytakusub's own pages speak it.

### Extension
- **Target language is a dropdown** of 19 languages, each shown in its own name ("Tiếng Việt · Vietnamese"), in Settings and on the setup page. "Other…" keeps a box for any other language. Languages typed before 2.8.0 are kept and matched ("vietnamese", "Portuguese", "Chinese"). Thai and right-to-left languages aren't listed, because pages can't be lettered well in them yet; they can still be typed under Other.
- **The interface follows the target language**, for ten languages: English, Vietnamese, Spanish, Portuguese (Brazil), Indonesian, French, German, Chinese (Simplified), Japanese and Korean. That covers the setup page, Settings, the toolbar popup, the buttons and messages on a manga page, and the worker's errors. Other target languages keep the interface in English.
  - It switches at once, in every open page, including the buttons on a page you're reading.
  - Pages declare their language (`<html lang>`), so screen readers read them right. Japanese wraps between phrases and Korean between words.
  - Dates, times and plural forms follow the language.
- **New installs start with the browser's own language** when it's on the list.
- **The popup's model menu shows just the names** (Haiku 5.5, Sonnet 5.5, Opus 5.5), with what the chosen one is good for underneath. The longer labels didn't fit a 340 px popup in every language and font.
- The extension's description and shortcut names are translated too (the browser shows them in its own language).
- The translations were written with AI (Claude) and checked by machine, not yet by native speakers. A **Translation fix** issue form takes corrections.

### Web app
- The target language is the same dropdown, with Other…. Until you save settings, it guesses from the phone's language. The web app's own interface stays English for now (translated in 2.10.0).

### Development
- `scripts/check-i18n.mjs` (in CI): every language has every English message, with the same placeholders, markup and links, no stray `$`, and a description within the manifest's 132 characters.
- `tests/browser/i18n.mjs`: every page in every language (labels right, no keys or English leftovers, nothing clipped or spilling sideways, no console errors), live switching, the worker's and the page overlay's language, the "Other" path and the first-install default. It found two bugs before release: the setup page didn't follow a change made in Settings, and the popup's model menu cut its descriptions off (on CI's wider Linux fonts, in seven of the ten languages, English included).
- ADR 0010 records the choices: `docs/adr/0010-interface-language.md`.

## [2.7.0] — 2026-11-17

Ready for the public Chrome Web Store listing. Everything stays free: each person uses their own Claude key, and nothing costs the developer per user.

### Extension
- **A setup page opens on install.** It says what is read (only pages you translate), what is sent (the page image in slices, your glossary and custom instructions, the chapter's names, and recent lines with Chapter context on), and where (Anthropic's Claude API, with your key, nothing else). Then: "I agree", add your key, allow access.
  - Nothing is translated until you agree; the popup shows only "Set up", and the shortcut opens the setup page.
  - Settings → About shows when you agreed, and Withdraw. After withdrawing, nothing more is sent.
- **Access to websites is asked when you first use it, not at install.** The setup page asks, and so does the popup the first time you turn on Enable here or Auto-translate, or press Translate. You can remove it in Settings → About.
  - Without it, nothing runs on sites, and the popup and any error say how to allow it.
- **Safer image downloads.** Only real images are used (checked by their first bytes: JPEG, PNG, GIF, WebP, AVIF/HEIF, BMP); a login page or anything else is refused. Downloads stop as soon as they pass 25 MB instead of after reading the whole thing.
- **The script that runs inside web pages can no longer get the API key.** It never used it, but it could read it from extension storage, which Chrome opens to it by default. Extension storage is now limited to the extension's own pages and worker, and the page script gets its settings, without the key, from the worker.
- **Auto-translate's spending guard.** On a site with auto-translate on, a page's own scripts (ads included) can add or swap images, and each new one is a Claude request. After 100 pages Claude answered in 10 minutes on one tab, auto-translate pauses with a Continue button that only a real click releases. Pages you ask for yourself are never held. Reading a chapter doesn't get near it.
- **The debug report** downloads the original images only with the debug overlay on, only for a tab, and only when they decode as images, and the page can no longer read the report while it downloads.
- **Fixed: with auto-translate on, the first screen of a chapter stayed untranslated until you scrolled** (2.6.0–2.6.1). Chrome fires a scroll event while a page loads; the pages found right after it waited for scrolling to settle, and nothing checked again until the next scroll. Found while testing the spending guard; `tests/browser/budget.mjs` now waits at the top of a chapter without scrolling.
- Translate visible (and the button on an image) now starts a page auto-translate is holding, instead of skipping it as already queued.
- Without site access, an image the page itself can read (same site) is still translated, through the page.
- The setup page opens on an update only for someone who never saw it (coming from before 2.7.0) or agreed to an older version, not after a deliberate Withdraw. Asking for it again brings the open one forward instead of opening another tab.
- **Settings → About**: version, help (GitHub Issues), privacy policy, setup guide, and "not made by or affiliated with Anthropic". Allow access there waits for the agreement, as on the setup page.
- The popup shows one notice at a time (key first, then access), so it stays within the browser's 600 px popup height.
- **"What translating costs"** (was "Claude usage"), in Settings and in the web app. Only numbers that are measured: what Claude's answers to this browser said they used, at Anthropic's prices.
  - Leads with **your cost per page for each model**. A long page can be several requests (one per slice); a page now counts once all its slices are answered, with their exact cost. Older history has no pages, so no per-page figure is guessed for it.
  - Today and this month show pages; requests, tokens and the rate-limit headroom moved under Details.
  - Points to the Console's monthly spend limit (Billing → Spend limits), the one cap that covers every device.
- **The web app's fetcher allowance** shows a meter against the 100,000 free requests only with Cloudflare's own count. Without it, it shows the requests this device sent, counted as they're sent. It used to add the browser's permission checks by guessing and set this device's number against the whole account's allowance, which other devices also use.
- **Removed: the monthly API credit meter** (plan, amount, renewal date), here and in the web app. It subtracted only this browser's spending from an amount you typed, so with the web app or another browser in use, "left" was always too high, and nothing can correct it: Anthropic has no way for apps to read a balance or a plan's credit. Claude usage still shows this browser's exact tokens and their cost, and now links the Console's Billing page for the balance. Old values are cleaned up.

### Store and support
- Listing text for the public release: setup and access in the description, Homepage and Support URLs, the optional-access justification, what's new, reviewer notes for the setup page (`store/LISTING.md`).
- "Going public" in `store/RELEASE-CHECKLIST.md`: trader status, visibility, rollback, watching issues, policy emails.
- Issue forms: a bug report that warns not to attach manga pages, debug reports or keys (issues are public), and an idea form.
- Privacy policy: the agreement, optional site access, and everything sent with an image.

### Web app
- The chapter-link setup guide was checked against Cloudflare's limits page, which changed on 13 November 2026: still 100,000 requests a day (reset at midnight UTC) and 10 ms CPU on the free plan. No change to the guide (#18).

### Tests
- `tests/browser/setup.mjs`: a new install without access, from the setup page through "I agree" and Withdraw, plus the worker's limits (no key in `GET_SETTINGS`, images only, the no-access message).
- `tests/imagecheck.test.mjs`: image types by their bytes, and the size cap.
- `tests/browser/budget.mjs`: the spending guard (a budget of 3 in the test copy), that a page script can't release it, that Translate visible still works while paused, and that the content script can't read the key from storage.
- The other browser tests use a test copy with access granted at install (`tests/browser/ext-copy.mjs`): a headless browser can't click a permission prompt.

## [2.6.1] — 2026-11-16

### Releases
- **`node scripts/release.mjs` no longer runs the test suite on your computer.** The full suite needs tools only CI installs (Python with numpy, onnx and Pillow for a stand-in model, a software GPU, downloaded models), so releasing 2.6.0 on a Mac stopped at the first test that needed them.
  - It now asks GitHub whether the tests passed for this exact commit on main, and tags only then. If they're still running, it says so; if they failed, it stops.
  - Its quick checks stay: on main, up to date, clean, version and changelog, shared files, syntax.
  - CI still tests the tag again before building the release.
  - The check reads the public check-runs API (no login; `GH_TOKEN` is used when set) in `scripts/ci-status.mjs`, with a test.

## [2.6.0] — 2026-11-16

### Extension
- **The page you're looking at is translated first.** When you scroll fast through a chapter with auto-translate on, the page you stop at no longer waits behind pages you flung past.
  - Auto-translate starts pages once scrolling settles, nearest to the middle of the screen first. A page on screen starts even when all three slots are busy.
  - The worker analyses one page at a time, most wanted first, from distances the page reports while you scroll (`extension/lane.js`). A page's analysis pauses between its model runs when a more urgent page is waiting.
  - While a page on screen is in progress, pages off screen wait (at most 20 s), because their model runs would block the worker's one thread while the page on screen waits for Claude's reply.
  - Pages you scroll far past before Claude is asked are put back and done when you return, so **they cost no tokens**. A page Claude was already asked about finishes and is cached. Pages you ask for yourself (Translate visible, the button on an image) are never put back.
  - Measured with a new browser test (14 pages, fast scroll to the end, a model taking 2.5 s per answer, CPU only): the page on screen was ready about **12 s** after the stop instead of 30 s, and Claude was asked about **3** pages instead of 8.
- **Options: the side nav stays on screen** while the page scrolls, and marks the section you're reading (or the one you picked in it). It was meant to stick already, but as a grid item it stretched to the full page height, so it scrolled away. The browser test now checks both.

### Store listing
- **Five screenshots instead of three** (`store/assets/`, upload them in the dashboard):
  - 1–3 re-rendered with the current engine;
  - 4 is new: a Japanese page with vertical and horizontal lettering, a dark bubble and screentone, before and after;
  - 5 is new: the real popup and the Claude usage panel (`tests/browser/store-shot.mjs`, demo data, a site named `reader.example`).
- **Screenshot 3 said something no longer true:** "found by pixels, not by a model". Since 2.0.0, bubbles and text are found by open-source models running in the browser. Its top line now says no other server sees your pages, instead of "nothing is stored". Screenshot 1 no longer says the artwork is untouched: narration on screentone can be smudged where it was erased.
- **The screenshot script tags each line with the bubble around its original text,** as Claude does, not by matching the bubble's outline. Two overlapping bubbles had been left untranslated in screenshot 1.
- **Screenshot 4 uses real translations of its Japanese text.** The generated test page pairs Japanese and English lines at random, which the tests don't mind.
- The close-up no longer has an empty strip at its right edge.

### Releases
- **Store uploads use the Chrome Web Store API V2.** Google planned to support the old v1.1 API, which `scripts/cws-publish.mjs` used, only until 15 October 2026. The script now uploads, waits while the store processes the package, checks its version, and submits for review, with V2's endpoints and fields. A test runs it against a fake API.
- **No stored key for the upload.** The release workflow signs in to Google with Workload Identity Federation: GitHub vouches for the release run, and Google gives a 15-minute token to a service account that only this repo's release workflow (from `main` or a version tag) may use. One-time setup: `scripts/cws-google-setup.sh` in Google Cloud Shell, then three GitHub variables (store/RELEASE-CHECKLIST.md § Automating updates). The refresh-token way remains as a fallback.
- Fixed in the checklist: it said to leave the Google app in "Testing", where Google expires refresh tokens after 7 days. The fallback now says to publish it ("In production").

## [2.5.0] — 2026-11-10

### Extension and web app
- **Claude usage monitor.** See what translating costs, in the extension and in the web app:
  - **Extension:** the popup shows "≈$… today" next to the model, and Options has a new **Claude usage** section.
  - **Web app:** Settings has a **Claude usage** group, and the toolbar shows today's cost while you translate.
  - **What it shows:** today and this month, one row per model (requests, tokens in and out, estimated cost), and the rate-limit headroom from Claude's last answer when the browser can read it.
  - **Where the numbers come from:** the token counts in Claude's own answers, so they're exact for what that browser sent. The cost is an estimate from Anthropic's published prices, checked weekly against the pricing page. The panels say so and point to the Claude Console for the exact bill.
  - Usage stays on the device for 62 days and is never sent anywhere. **Clear usage history** removes it. Each browser, and the installed app on iPhone, keeps its own records.
  - Exact account-wide numbers need Anthropic's Admin API, which isn't available for individual accounts. See ADR 0007.
- **Monthly API credit at a glance.** Claude Max and Team plans include API credit each month. Pick your plan (or type an amount) and the date it renews, and the usage panels show:
  - "≈$0.41 of $100 used", with a bar;
  - "≈$99.59 left · renews Dec 2 (in 23 days)";
  - the pace: "At this pace (≈$0.06 a day) you'll use ≈$1.70 of it by then", or the day it runs out if that comes first;
  - a badge when it's almost used, will run out early, or is used up.
  
  The popup and the web app's toolbar show "≈$… left" too. Anthropic has no API for the credit balance, so the renewal date comes from the Console's Billing page (Promotional credits). Without a date, the panels assume the 1st of next month and say "probably renews".
- **Speed limit in plain words.** The rate limit now reads like "Speed limit (a minute's worth, refilling as you go): 47 of 50 requests, 36k of 40k input tokens left at 1:22 AM", instead of raw header values.
- **Clearer Claude errors:**
  - the monthly spend cap (with when it resets), a self-set spend limit, a low credit balance, a refused key and an overloaded API are each explained;
  - the extension no longer retries a request the spend cap refused.
- The weekly check now also compares the Claude prices with Anthropic's pricing page and opens an issue when one changed.

## [2.4.0] — 2026-11-10

### Web app and fetcher
- **Live count from Cloudflare.** Optional: add a read-only analytics token and your account ID to the fetcher as two Secrets. The chip and **Your fetcher** then show Cloudflare's own request count for your whole account today. It's the same number in every browser and in the installed app, refreshed every minute while the Chapter link tab is open. Cloudflare adds requests to it a few minutes late, and the panel says so.
  - The fetcher reads the count with Cloudflare's GraphQL Analytics API (`/usage`) and reuses an answer for 30 s. The token never leaves the Worker.
  - When there's more than one Worker on the account, the count is split by Worker.
  - Without the token, the app keeps its own count, now marked as an estimate (≈ and "This device"). It also offers the setup in four steps.
  - **The estimate now counts what Cloudflare counts.** Before each new address the browser asks the fetcher for permission (a CORS preflight), and Cloudflare counts that as a request. The app counted only the page itself, so it showed about half of Cloudflare's number. It now counts both, and errs high rather than low; a browser test checks it against every request the fetcher receives.
  - A fetcher older than 2.4.0 still works; the panel says to Sync fork for the live count. The app's minimum fetcher stays 2.1.0, so nobody is forced to update.
- `wrangler.toml` keeps variables set in the dashboard when Workers Builds redeploys (`keep_vars = true`).
- The weekly guide check also watches the three Cloudflare pages the live-count setup relies on.

## [2.3.1] — 2026-11-10 (the first GitHub Release since 2.0.0: it carries 2.2.0, 2.2.1 and 2.3.0, which were not released on their own)

### Project
- **Fixed: the release build's zip step**:
  - The 2.2.0 release failed with "zip error: Could not create output file (dist/…)". The release workflow kept the package's path in an environment variable named `ZIP`, added in 2.0.0's release fixes. Info-ZIP's `zip` reads `$ZIP` as extra command-line options, so it took that relative path as the archive name while working in a temporary folder.
  - The variable is now `PACKAGE`, and `scripts/build-zip.sh` clears `ZIP` and `ZIPOPT` and uses absolute paths.
  - Pull requests that need the extension suite also build the store package the same way, on the same runner image, so a broken package shows up before a tag.

## [2.3.0] — 2026-11-10

### Web app
- **Fetcher allowance at a glance:**
  - A status chip under the chapter form shows today's requests against Cloudflare's free 100,000 a day. It turns red with *almost used up* from 80 %, and says when it starts again once it runs out.
  - Tapping the chip opens **Your fetcher**. There a meter shows the count, with the chapters opened and the reset time in your own time zone. Three short facts follow: it's free (when it runs out, the fetcher just stops until the reset), it's shared with your other devices and anyone you gave the link, and where to see the exact count in Cloudflare.
  - The count is what *this device* sent. A Worker can't read its account's usage without an extra Cloudflare API token, which would add setup steps for everyone.
- **Clearer failures:**
  - When Cloudflare answers with its daily-limit page (1027) or its "exceeded resource limits" page (1102), the message says so.
  - When a connected fetcher doesn't answer at all, the message names both likely causes: the allowance is used up (with the reset time), or the page needed more than 10 ms of work.
- **Your fetcher** is laid out like Settings: a back button, sections with dividers, and *Disconnect* marked as destructive.
- Small buttons are 44 px tall on touch screens.
- Fixed: an element hidden with the `hidden` attribute could still show when its class set a display style.

## [2.2.1] — 2026-11-10

### Project
- **Pull request rules**, checked in seconds by a new workflow (`pr-checks.yml`) and written down in `CONTRIBUTING.md` with a pull request template:
  - **Every pull request carries a version.** It raises `extension/manifest.json` and adds its dated section here (`scripts/check-version.mjs`).
  - **A pull request that changes UI has screenshots in its description** (`scripts/check-screenshots.mjs`, which lists the files that count). The check runs again when the description is edited.
  - The checks use the base branch's copy of the scripts, so a pull request can't change the rules it is checked against.
- `scripts/release.mjs` no longer bumps the version. It checks and tests, then tags the version main is at.
- **CI runs only the tests a change needs:**
  - **Pull requests:** tested once, as pull requests. Before, each push to a pull request branch ran the full 20-minute suite twice, once as a push and once as a pull request.
  - **Cancelling:** a newer push cancels the older run.
  - **Choosing suites:** `scripts/ci-changes.mjs` picks from the changed files. Documentation alone runs none. Web app or fetcher changes run the web suite (about 4 min). Anything else runs both, including the extension suite (about 18 min). A raised version number alone doesn't count.
  - **Full runs:** every push to `main` and every release still run everything.
  - **One check:** a single `test` check sums up the suites that ran, so it can be required on `main`. This follows GitHub's advice to skip jobs rather than whole workflows for required checks.

## [2.2.0] — 2026-11-09 (tagged, but its release build failed at the zip step, so 2.2.0 has no GitHub Release: 2.3.1 is the first release with these changes. There is no extension 2.1.0. Web app live on GitHub Pages)

### Web app
- **UI overhaul after an audit** against the Web Interface Guidelines, checked at iPhone size (390 px) and desktop (1280 px), dark and light:
  - **Header:** the mode switch gets its own full-width row on phones; on wider screens it's centred in the header.
  - **Tap targets:** at least 44 px everywhere.
  - **Reading width:** pages stay within a 760 px column; two-page spreads only from 1,100 px.
  - **Page actions** (Original, Redo, Save) and the status moved into a bar under each page instead of floating over the art.
  - **Modes:** each keeps its own pages. Once pages are on screen, the screenshot drop zone shrinks to its buttons.
  - **Settings:** a full-screen sheet on phones and a centred panel on wider screens, with a Close button, grouped sections and Save pinned at the bottom.
  - **Setup wizard:** a numbered vertical stepper, with Back/Next under the open step.
  - **Install guide:** in-app, per platform (iPhone/iPad steps, the install button where the browser offers one, a QR code on computers). On a phone that hasn't installed the app, it comes before the key prompt.
  - **Accessibility:** visible keyboard focus, the tablist pattern with arrow keys, toasts and progress announced to screen readers, key fields without autocorrect, a theme colour for light and dark, and reduced motion respected.
- Fixed in the fetcher setup guide: Cloudflare's create screen calls the root directory **Path**, under *Advanced settings*; the guide said *Root directory*, the name the docs and the Worker's Settings → Build use.

### Extension
- **Popup and Options page redesigned** with the same look as the web app (`extension/ui.css`), checked in dark and light and in narrow windows:
  - **Popup:** the master switch says On/Off; when off, the popup shows a short note instead of greyed-out buttons. *Translate visible images* shows your actual shortcut (it can be changed at `chrome://extensions/shortcuts`), and hide/show is an eye button. The site switches sit under *On \<site\>*, and the model and chapter context under *Translation*. The missing-key notice has an *Add key* button.
  - **Options:** sections for Claude API, Translation, Sites, Lettering & speed and Troubleshooting, listed at the side on wide windows. Every toggle is a switch with a short description. *Save* is pinned at the bottom with its message beside it, and the page shows *Unsaved changes*, saves on Ctrl/Cmd+S and asks before you leave unsaved edits. Settings changed in the popup appear here when nothing is unsaved.
  - *Clear cache* asks first, because it also drops your edited lines.
- Fixed: the debug-overlay option's label broke into columns on the Options page, and the popup's *Options* button was disabled while Gytakusub was off.

## [2.1.0] — 2026-11-09 (web app and chapter fetcher, live on GitHub Pages; the browser extension is unchanged and stays 2.0.0, so there is no store package or GitHub Release for 2.1.0)

### Added
- **Chapter links from any site that needs no login** in the web app, through a **chapter fetcher** you run on your own free Cloudflare account (`fetcher/worker.js`, set up in the browser in about 10 minutes: `fetcher/README.md`). A web page may not read other sites, so chapter mode cannot work without a server; MangaDex's own API documentation requires one. The fetcher:
  - opens the chapter page;
  - finds its page images by reading the reader themes most sites use (MangaThemesia including `ts_reader`, Madara including its encrypted "chapter protector", MangaBox, FoOlSlide, Blogger), other sites' HTML and scripts, and MangaDex through its API;
  - relays the images with the chapter site as referrer.

  It needs an access key (24+ characters) and stores nothing. It refuses IP addresses, local names, odd ports and unchecked redirects, and relays only JPEG, PNG, GIF, WebP and AVIF images up to 40 MB. Your Claude key never passes through it. An independent security review found no critical issue; its medium findings are fixed. `docs/adr/0006-chapter-fetcher.md`.
- **Next chapter / Previous chapter** buttons, kept from the site's own links; the chapter context (names, recent lines) carries over to the next chapter.
- **Deep links:** `?chapter=<link>` fills in a chapter, and a bookmarklet in the fetcher guide sends the chapter you are reading to Gytakusub. It opens on a tap of **Load**, so a link from someone else can't use your fetcher or Claude credits by itself.
- Clear messages when a site can't be read that way: a "checking your browser" wall, a login, pages built by a script, a wrong key, an unreachable fetcher. Each says to use screenshot mode or the extension instead.

- **Guided setup inside the Chapter link tab.** Until a fetcher is connected, the tab shows the setup steps instead of the chapter form, and it unlocks only after the fetcher answers with the user's key and is new enough. The steps:
  1. The app generates a 32-character key.
  2. Fork the repository on GitHub.
  3. On Cloudflare, Create application → GitHub → the fork, with the name `gytakusub` and root directory `fetcher`.
  4. Add the key as the Secret `GYT_KEY`.

  The steps open one at a time: "Step N of 6", Back and Next, and the place is remembered while you're away on GitHub or Cloudflare. They start with the two accounts to create, and every value to type is a tap-to-copy chip. Step 4 says what to check if the build fails. (The first version of this guide used Cloudflare's "Deploy to Cloudflare" button. When the owner tried it, that screen required choosing an existing repository, which a new user doesn't have, so the guide was rewritten around forking.) People given a **connection link** paste it in the box at the top and skip the setup.
  5. **Connect**.

  Each failure is explained: a wrong key, a key not set yet, an outdated fetcher, nothing at that address. A **connection link** sets up another device (the key travels in the `#fragment`, never to a server); someone given a shared address and key starts at step 3.
- **Keeping the guide current:** step 2 names the Cloudflare pages it follows and the date it was checked against them (`fetcher/guide-sources.json`). A weekly workflow (`guide-check.yml`) re-reads those pages, the Deploy link and MangaDex's API, and opens an issue when one changed. Tests tie the in-app links to that list.

### Changed
- The Chapter link tab is always shown. Settings no longer has *Image proxy* or the Advanced chapter-mode switch; the fetcher is set up and managed in the tab.

### Removed
- `web/sources.js` (MangaDex-only adapter, blocked by MangaDex's CORS rule) and `web/worker.js` (image-only proxy), both replaced by the fetcher.

## [2.0.0] — 2026-11-09

A new page engine built on open-source models that run in the browser, and a new licence. 1.0 found bubbles, erased lettering and fitted text with hand-written heuristics that were tuned one reported page at a time; each fix risked the last one. 2.0 finds text and bubbles with learned models (on the graphics card when there is one), does the geometry with [OpenCV](https://opencv.org/) (WebAssembly, bundled), and ships only what passes a test corpus and a measurement on real pages. Nothing leaves the browser except the call to Claude with your own key. Decisions and measurements: `docs/adr/0001`–`0005`. (Developed as 1.1.0 and 1.1.1; never released under those numbers.)

### Added
- **Learned text detection** with PaddleOCR's **PP-OCRv6** detector (Apache-2.0, 9.9 MB), on ONNX Runtime; OpenCV geometry then snaps each box to the ink, merges lines into paragraphs and finds the shape around them. It reads vertical Japanese as well as Latin rows (see "Japanese raw manga" below); `docs/adr/0002`, `0005`.
- **Learned bubble segmentation.** A YOLOv8-seg speech-bubble model (from `kitsumed/yolov8m_seg-speech-bubble`, quantized to int8, 43 MB) returns bubble masks; the engine uses them as bubble interiors and assigns the detected lettering to them. The light-region rules remain for lettering the model leaves outside any mask (it misses some heavily toned bubbles), and a model bubble with no lettering inside is ignored (never stamped, never erased). A bubble the model finds with no detected text gets a second, higher-resolution text pass on its crop before it is dropped. `docs/adr/0004`.
- **Japanese raw manga.** Vertical columns are found, erased and replaced, furigana included: ruby is treated as part of the column it reads (erased with it, never the size reference); a column's letter size is its glyph width; a bubble holding only "……" or "！？" takes the page's letter size; narration set in columns over the art gets a placement wide enough for English rows. On the owner's two raw chapters: original lettering left after erasing 35% → 22%, translations under 12 px 13% → 2%, dialogue recognised as a bubble 94% → 98% (`docs/adr/0005`). A dark bubble whose small white lettering the page-wide pass misses gets a second, closer look.
- **ONNX Runtime Web** (Microsoft, MIT) runs both models; OpenCV's dnn stays as the fallback for the text detector.
- **GPU (WebGPU).** Both models run on the graphics card when the browser offers WebGPU (Chrome/Brave/Edge 124+ in the extension's service worker; Safari 26 for the web app), and on the CPU otherwise or if the GPU fails to start. The bubble model ships in two variants chosen at load time: weight-only int8 for the GPU (no int8 activations, which ORT's WebGPU backend would send back to the CPU node by node) and int8 QDQ for the CPU. Verified in CI on a software GPU: same lines and bubbles as the CPU path on every fixture page. Options → "Use the graphics card" turns it off. Debug reports show where the models ran (`timing.backend`). Every call into the runtime is serialised: the WebGPU build suspends a call while the GPU works, and a second page entering it meanwhile (auto-translate while scrolling) corrupted its memory — "memory access out of bounds" on every page after. If the runtime ever does trap, the worker switches to the OpenCV text detector without the bubble model instead of failing every page.
- **Inpainting instead of painting.** Original lettering is removed with Telea inpainting inside the bubble (outlines untouched) and in a small region for free text, so the bubble's own surface and simple art behind loose text are reconstructed.
- **Hover to peek** (off by default). With Options → "Peek at the original" on, resting the pointer on a translated bubble for a moment shows the original lettering; moving away brings the translation back.
- **Edit a line.** Double-click a translated bubble to correct the text; the correction stays for that page until you Redo. The same dialog can teach the glossary ("original term = translation") for later pages.
- **Bundled lettering font** (Comic Neue Bold, SIL Open Font License) so pages look the same on every machine; Options → "Font family" still overrides it.
- **Hyphenation** at syllable boundaries using Franklin Liang's algorithm (the `hyphen` package, vendored), tried only when an un-hyphenated layout does not fit.
- **Debug overlay** (Options) drawing detected regions and text areas, plus **Export debug report** in the popup: one `.zip` with the original image, the debug render and the JSON for every translated page on the tab (the hover bar's **Report** does one page). `tests/replay-report.mjs` replays such a zip through the engine offline.
- **Real-browser tests.** The actual extension and the web app run in headless Chromium against a mock Claude API on every push; detection, layout and erase are asserted against ground truth on fourteen synthetic pages (Spanish, Italian, Japanese, including vertical Japanese with furigana); the GPU path runs on a software GPU. A release is built only after this whole suite passes on the tagged commit.

### Changed
- **Licence: GNU AGPL v3** (1.0.x was MIT). The bubble model is GPL-3.0 per its card and AGPL-3.0 under Ultralytics' terms; publishing the whole extension under the AGPL keeps the store build compliant. The licence text and `THIRD_PARTY.md` ship inside the package, and Options links to the source.
- A numbered stamp (tag) returned by the model is authoritative for where a line goes. 1.0 only trusted a tag if the model's pixel box also fell inside the bubble, so a drifted box silently moved the text into the wrong panel until a Redo got luckier. The one exception: when the model's box sits squarely inside a *different* detected shape, the number was misread (a corner stamp can land beside a neighbour's text) and the box decides — measured as 9 of 437 tagged lines in the user's exports, all of them wrong tags.
- **Anchored layout.** Each translation takes the largest rectangle of its bubble around the lettering it replaces — never another speaker's line, a smaller region inside the shape, or the far side of a joined bubble's waist — and stays centred on that lettering. Previously a shared bubble was cut into horizontal lobes and a single translation took the roomiest rectangle anywhere in the shape, so text drifted away from where the original was and, when a light background passed as a bubble, landed over other bubbles. One invariant holds whatever the shape analysis does: a translation never gets less room than the lettering it replaces (that area is erased and inside the bubble by definition), so text cannot come out smaller than the original for lack of space. Measured on 230 real pages from the user's exports: translations rendered below 0.7× the original letter size 15.3% → 9.5%, words broken letter by letter 68 → 37, lines over their own lettering 86% → 96% (`docs/adr/0003-anchored-layout.md`).
- **Toned bubbles.** A bubble shaded with screentone or a gradient used to offer only its flat light fragment as text area, so the translation came out tiny. The usable interior is now what the outline encloses (grown from the light region over tone dots, mid-greys and lettering, bounded by structural ink); hairline gaps are sealed, open tail tips are cut off, and a leak through a wide opening keeps the old interior. Dark bubbles are unchanged.
- Text fitting keeps words whole and lets a line run slightly past its box before it ever breaks a word letter by letter; the smallest size it will go to is 35% of the original (was 45%).
- Erasing reaches most of a letter beyond each detected line along its direction, catching the last glyph the detector sometimes stops short of.
- An image the site refuses to serve to the extension (hotlink protection, "Could not fetch image (403)") is fetched again by the page itself when it may (same-origin or CORS); an image that still fails is not retried on every scroll, and the same error is not toasted again within a minute. Failed images are listed in the debug report (`summary.failed`).
- The service worker now returns a cleaned page plus text placements; the content script only draws text. Content scripts no longer carry the engine (a few KB instead of hundreds).
- Text fitting tries every size without hyphens first and hyphenates only when nothing else fits, instead of hyphenating eagerly at line ends.
- Minimum Chrome version stays 116; the extension's CSP now allows `wasm-unsafe-eval` (WebAssembly; no remote code, no `eval`).
- **The model answers in a fixed JSON schema** (the API's structured output, `output_config.format`): its reply is constrained to valid JSON of the expected shape, so a page can no longer fail on malformed JSON (one did on the owner's One Piece chapter: "Expected ',' or ']' … at position 1998"). An answer that cannot be used now says why — refused, cut off at the token limit, empty — with the API's stop reason, instead of "Empty model response". If the API rejects structured output, the extension falls back to the plain request for the session.
- The popup and the Options page read and write the settings themselves instead of asking the service worker, and Options' Save stays off until the settings are loaded.

### Fixed
- Translations displaced from, or oversized for, a correctly detected bubble on the first render (the tag/box issue above).
- Text spilling into a neighbouring bubble; inconsistent sizes across a page; erased line art on banner pages; partially erased lettering when the model's box was too small (all made moot by the new engine, and covered by the corpus tests).
- Text boxes were mapped back to the page with one scale for both axes although the detector's input is rounded to multiples of 32 on each: boxes sat up to ~2% of the page width to the right of the text. Invisible on most Latin rows (the snapping to the ink absorbed it), it put boxes between the columns of vertical Japanese.
- "memory access out of bounds" on every page after a while with auto-translate (concurrent calls into the WebGPU runtime; see GPU above).
- The popup opened with default settings (master switch off, the first model, site toggles off) and lagged while pages were being translated. It asked the service worker for the settings, and the worker runs the page engine on its one thread: measured in the browser test, one such request waited 10.4 s during a page's analysis. The popup now shows the stored settings in about 0.25 s whatever the worker is doing; the Options page could even save its empty form over the settings if Save was clicked before they arrived.
- Two translations that share one paragraph of the original (a narration column and its parenthesis, merged by the detector) no longer leave the second with a sliver of the bubble and tiny text: the paragraph is cut between them.
- A panel's light background with loose lettering on it is no longer taken for a speech bubble the size of the panel (with the bubble model running, the rule-based fallback now stops at 8% of the page): the lettering becomes loose text, placed where it is.

### Validated on real pages
The rule-based detector (now the fallback) was first reworked against the real exports (850 px JPEG pages with 8 px Latin capitals; Japanese pages): line grouping from glyph components only, width-aware letter counts, evidence rules for lettering (alignment, letters per row, height clustering, density). Scored with the model's own answer as witness (`tests/score-reports.mjs`), tuned on one export and validated on two untouched ones: dialogue recognised as a bubble rose from 49% to 83% (hold-outs 64→88%, 49→84%) with coverage and false regions unchanged. The eraser now ships only the inpainted patches (≈10% of the bytes of a full page), and every result carries per-stage timings.

The learned bubble model, on 270 pages of the owner's exports at the time (`docs/adr/0004`): dialogue recognised as a bubble 92.4% → 98.0%. The PP-OCRv6 detector and the vertical-text work on top of it (`docs/adr/0005`): on 242 Spanish/English pages coverage 95.6% → 97.0% and dialogue as a bubble 98.1% → 98.4%, with words broken letter by letter 40 → 10; on 28 Japanese raw pages dialogue as a bubble 94.3% → 98.4%, lettering left after erasing 35% → 22%, translations under 12 px 13% → 2%.

### Known limitations
- Package size: about 117 MB unpacked, a 78 MB download (runtime 29 MB, bubble model 43 MB CPU + 28 MB GPU variant, text detector 9.9 MB, OpenCV 6 MB). The web app downloads one bubble-model variant, about 75–90 MB on first use.
- On the CPU (no WebGPU) a page takes about 3 s to analyse before the model call; pages translated while scrolling fast queue behind each other.
- The text detector reports sound effects and signs that the model then leaves untranslated: more numbered stamps per page (≈1.2 unused regions per page on Latin-script pages, 2.2 on Japanese raws), which costs prompt tokens.
- Telea inpainting smooths screentone and hatching behind narration set on the art (a visible smudge where the letters were). Bubbles are unaffected.

## [1.0.0] — 2026-11-08

First release: Brave/Chrome extension and web app. Local bubble detection with set-of-mark prompting, in-place typesetting, per-site enable and auto-translate, chapter context, bring-your-own Claude API key.
