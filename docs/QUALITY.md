# How well Gytakusub works, and how it is measured

Gytakusub's engine is a set of rules and models: where the lettering is, what to erase, how large
to letter. Rules written while looking at a few chapters can fit those chapters and fail on the
next series. So every change is measured on pages its rules were never tuned on, against answers
the engine's rules cannot bend.

## Results

<!-- results:start (written by `node tests/bench/report.mjs`; don't edit by hand) -->
### Real pages (Manga109-s)

| Books | Pages | Lines | Found before Claude answers | Lettering still seen | Set under 0.7 of its size | Art damage | Sound effects changed |
|---|---|---|---|---|---|---|---|
| held out | 333 | 2,752 | 97.1% | 0.9% | 8.9% | 0.04% | 0.15% |
| looked at | 321 | 2,572 | 96.7% | 0.9% | 9.4% | 0.04% | 0.17% |

### Generated pages

| Script | Pages | Lines | Found before Claude answers | Lettering left untouched | Set under 0.7 of its size | Size measured outside 0.6–1.6× | Text past its bubble | Touching its outline | Art damage |
|---|---|---|---|---|---|---|---|---|---|
| all | 300 | 1,615 | 95.1% | 1.1% | 11.0% | 2.7% | 0.8% | 2.7% | 0.014% |
| Japanese | 76 | 419 | 95.7% | 1.0% | 25.8% | 0.7% | 0.6% | 4.2% | 0.019% |
| Chinese | 38 | 178 | 95.5% | 0.0% | 25.3% | 1.1% | 0.0% | 2.9% | 0.016% |
| Korean | 38 | 197 | 95.9% | 1.0% | 8.1% | 3.6% | 0.0% | 0.0% | 0.010% |
| English | 38 | 199 | 93.5% | 2.5% | 1.0% | 5.0% | 0.6% | 2.4% | 0.005% |
| Spanish | 38 | 223 | 95.5% | 0.9% | 1.8% | 2.7% | 2.2% | 2.2% | 0.012% |
| Portuguese | 36 | 194 | 94.8% | 0.5% | 0.0% | 2.1% | 0.0% | 2.4% | 0.005% |
| Vietnamese | 36 | 205 | 94.1% | 1.5% | 1.5% | 5.4% | 2.2% | 2.8% | 0.023% |

### Where text size is lost

What holds each line set under 0.7 of its size small: the same line fitted again in a room a quarter wider, and a quarter taller (`bench/limits.mjs`).

| Pages | Lines set small | Width (a long word across a narrow room) | Height | Either | Not the room |
|---|---|---|---|---|---|
| Real, held out | 8.9% | 52.9% | 5.7% | 37.3% | 5.3% |
| Real, looked at | 9.4% | 56.2% | 6.2% | 35.5% | 4.1% |
| Generated | 11.0% | 68.5% | 1.1% | 24.7% | 5.6% |

On generated pages, where every letter size and bubble is known exactly:

- **The size estimate:** with the true letter size, 10.5% of lines are set small, against 11.0%.
- **The translation's length:** of the lines set small that are alone in their bubble, 85.2% could not be set at 0.7 of their size in that bubble however they were laid out, with no margin from the outline. The rest (18 lines) could have been; 4 of them (0.2% of all lines) keeping their letters clear of the outline, as the engine does since 2.15. The others fit only by touching it.
- Not judged: 19 small lines that share their bubble with another line, and 37 over the art.
<!-- results:end -->

Since 4.0 the generated pages here are filled with AOT, as the extension fills them on a CPU (`--fill aot`); with Telea, the bench's fill before, the same 300 pages left 1.4% of lines untouched and damaged 0.017% of the art.

### The learned text mask against the rules

A setting, on by default since 3.4 (ADR 0022, 0026): a model trained on comic text finds the lettering to erase on free text and in bubbles whose surface isn't plain. The numbers above are with it on. Here, on pages never looked at, are the rules alone (the setting off) against the mask. It changes only what is erased: the other numbers stay as they are.

| Pages | Lines | Lettering left untouched (real: still seen) | Free text left untouched | Art damage | Bubble outline pixels erased | The mask's time a page, one CPU thread (median) |
|---|---|---|---|---|---|---|
| Real, held out | 2,752 | 1.69% → 1.09% | not measured | 0.098% → 0.045% | not measured | 4.2 s |
| Generated, held out | 810 | 5.2% → 2.7% | 24.5% → 10.8% | 0.051% → 0.020% | 1,062 → 950 | 4.2 s |
| The new shapes, held out | 1,165 | 3.3% → 1.8% | 22.3% → 10.1% | 0.054% → 0.025% | 2,817 → 1,437 | 6.7 s |
| Webtoon, held out | 789 | 18.5% → 5.6% | 20.5% → 8.0% | 0.053% → 0.048% | 2,635 → 5,026 | 6.7 s |
| Lettering at the image's cut, held out | 979 | 10.5% → 3.9% | 23.7% → 10.8% | 0.053% → 0.022% | 1,157 → 1,779 | 4.7 s |

On the webtoon pages, lines in dark bubbles left untouched went from 59.5% to 15.6% (`darkStays`); the mask also erases more of the outlines of dark bubbles the bubble model misses (ADR 0022). On the pages with lettering at the image's cut, lines in the bubbles cut there left untouched went from 37.9% to 10.1% (`cutStays`), their glyph pixels left as drawn from 33.7% to 7.3% (`cutSamePx`). Since 3.2.1 the rules erase lettering the image's edge cuts too (ADR 0023): those lines left untouched with the setting off 37.9% → 30.8% (none left in white bubbles), with it on 10.1% → 5.9%. On a graphics card (a real episode, WebGPU) the mask took 37 ms a page (median of the 47 pages it ran on), 352 ms the most.

Since 3.5 the mask also looks inside a translated line's box where nothing was found, and erases what it finds there (ADR 0027). The table above is from before it. Against 3.4 on pages never looked at, the mask on in both:

| Pages | Lettering left untouched (real: still seen) | Free text left untouched | Dark-bubble lines left untouched | Art damage |
|---|---|---|---|---|
| Real, held out | 1.09% → 0.85% | not measured | — | 0.0448% → 0.0456% |
| Generated, held out | 2.7% → 2.3% | 10.8% → 8.6% | — | 0.0197% → 0.0198% |
| Webtoon, held out | 5.6% → 3.5% | 8.0% → 6.8% | 15.6% → 8.1% | 0.0482% → 0.0486% |
| The new shapes, held out | 1.8% → 1.6% | 10.1% → 8.6% | — | 0.0253% → 0.0253% |
| Lettering at the image's cut, held out | 3.2% → 2.7% | 10.8% → 8.6% | — | 0.0218% → 0.0219% |

Art damage rises only on pages where a line is newly erased, and each such line costs about what any erased line does (`synth-run.mjs --line-damage`).

Since 3.6 the mask also looks across the box Claude gave for a free-text line, a piece of it mostly inside that box counts as the line's lettering however thick, and the mask is one fine-tuned on generated pages (ADR 0029). Against 3.5 on pages never looked at, the mask on in both:

| Pages | Lines left untouched (real: lettering still seen) | Free text left untouched | Dark-bubble lines left untouched | Art damage | Bubble outline pixels erased |
|---|---|---|---|---|---|
| Real, held out | 0.85% → 0.88% | not measured | — | 0.0456% → 0.0433% | not measured |
| Generated, held out | 2.3% → 1.6% | 8.6% → 5.0% | — | 0.0198% → 0.0157% | 950 → 581 |
| Webtoon, held out | 3.5% → 1.9% | 6.8% → 3.4% | 8.1% → 3.5% | 0.0486% → 0.0192% | 5,043 → 836 |
| The new shapes, held out | 1.6% → 1.1% | 8.6% → 4.3% | — | 0.0253% → 0.0219% | 1,437 → 1,063 |
| Lettering at the image's cut, held out | 2.7% → 2.0% | 8.6% → 5.0% | — | 0.0219% → 0.0161% | 1,779 → 639 |

On real pages one more line is still seen in all (8 pages more, 5 fewer). The mask's time a page on one CPU thread rose from 3.1 s to 4.3 s (median, real pages held out), as the boxes are masked too.

**4.0's free-text gate, read as the app fills.** The bench filled textured areas with Telea, which the app never uses where a learned fill runs. Telea pulls dark lines around an erased line back into the lettering's shape: of the 8 free-text lines left on the plain pages looked at, 3 had every unchanged pixel inside the eraser's mask (`synth-run.mjs --why-left`, `masked`). Since 4.0 the gate is read with AOT, the app's CPU fill (`--fill aot`; LaMa on a graphics card fills better still), with Telea beside it. Free text left untouched, held out, 3.5 → 3.6:

| Pages | AOT | Telea |
|---|---|---|
| Generated (the gate's set, at most 5%) | 8.6% → 4.3% | 8.6% → 5.0% |
| Webtoon | 6.8% → 3.4% | 6.8% → 3.4% |
| The new shapes | 9.4% → 4.3% | 8.6% → 4.3% |
| Lettering at the image's cut | 9.4% → 5.0% | 8.6% → 5.0% |

With AOT, art damage is lower with 3.6 on all four (one page worse, on the new shapes). The free-text lines left on the pages looked at are the same 5 on the plain pages and the new shapes (4 on webtoon), from three causes of one or two lines each: free text over a shape the light-region rules call a bubble, lines never found, and a fill that still comes back like the lettering ([ADR 0030](adr/0030-four-point-oh-as-measured.md)).

## What is measured

### Real pages: Manga109-s

[Manga109-s](https://huggingface.co/datasets/hal-utokyo/Manga109-s) holds 87 Japanese manga books
by professional authors. Researchers boxed every line of text on every page, and drew the outline
of every sound effect (the COO annotations). The bench takes four spreads from each book (a fixed
random choice), and each half of a spread as a page: 654 pages with text.

The books are split in two by a hash of their names. **Held-out books are only ever counted**:
their pages are never looked at, and no rule is changed because of them. **Books looked at** are
where failures are examined. A change is kept only if it holds on the held-out half.

### Generated pages

Pages drawn by `tests/bench/synth.mjs` in seven scripts: Japanese, Chinese and Korean (vertical
and horizontal), English, Spanish, Portuguese and Vietnamese. They have panels of art (screentone,
gradients, hatching, shapes, lines), bubbles of several shapes (ovals, clouds, bursts, tall ones,
narration boxes), free text over the art with an outline, two speakers in one bubble, lines of
only marks ("…"), sound effects, and colour pages. Every page is drawn twice, with and without its
lettering, so the exact answer is known: every glyph's pixels, each bubble's inside and outline,
and each line's letter size. Seeds below 100000 may be looked at; seeds from 100000 are held out.

### Claude's part

Claude is not called. Its answer is simulated from the marked boxes: one line per marked line, the
box moved and resized by up to 15% (one in ten by up to 40%), as Claude's boxes are, and tagged
with the region found there. An English stand-in for the translation, about as long as a
translation is (2.3 times the characters of Japanese or Chinese, 2 times Korean, about the same
for Latin scripts). So the numbers measure Gytakusub, not Claude's reading.

`--reader strong|weak` (generated pages, 3.3) makes the answer a reader that errs would give, in
the answer's own form (boxes in pixels, marks as stamp numbers), and passes it through the answer
contract as a real answer goes (`bench/reader.mjs`). The strong reader makes the errors Haiku made
on the owner's reports, at their measured rates: a line left out (3.2%), the mark of another region
(1.3%), no mark for a line in a stamped region (5.4%), a box on no lettering (1.9%). The weak reader
makes them three times as often, and the errors other readers make: dialogue labelled a sound
effect, two lines given as one or one as two, the same line twice, a line for a region with no
lettering, every box in another convention (half its answers), an answer cut off (one in twenty).
Its numbers are mine until 5.0's reading check measures real models. Every generated row counts
`delivered`: lines whose lettering was erased and whose translation sits inside their own bubble
(or over their own free text).

### The measures

| Measure | Real pages | Generated pages |
|---|---|---|
| Found before Claude answers | the marked line lies in a region the engine found on its own | same |
| Lettering still there | an independent detector (below) sees text inside the marked line on the original, and still sees it after erasing | over a quarter of the pixels where the lettering stood out from the art are as the lettering drew them |
| Set under 0.7 of its size | the translation's letters under 0.7 of the original lettering's size, as the engine measured it | the same, against the exact size |
| Size measured outside 0.6–1.6× | — | the engine's measure of the lettering against the exact size |
| Text past its bubble | — | over 3% of a translation's ink outside the bubble's inside |
| Touching its outline | — | any of a bubble line's letters within a tenth of a letter (2 px at least) of the bubble's edge |
| Art damage | pixels changed by more than 40 levels away from every marked line (grown by 6 px) | the same, away from every line's footprint |
| Sound effects changed | pixels changed inside the sound effects' outlines | — |
| What holds a small line small | the line fitted again in a room a quarter wider, and a quarter taller: the width, the height, either, or neither (not the room) | same |
| Small with the true size | — | the line fitted again with the exact letter size: what the engine's measure of the lettering costs |
| Could fit at 0.7 | — | a small line alone in its bubble, wrapped into the bubble's true interior at 0.7 of its size, each line as wide as the interior at its height, no margin from the outline: when even that fails, the translation is too long for the bubble at that size, whatever the layout |
| Could fit at 0.7, clear of the outline | — | the same in the interior less the touching distance (a tenth of a letter, 2 px at least): a line that fits at 0.7 only by touching its outline is not counted, since the engine keeps a margin off it (2.15) |
| Over the outline or art | over 3% of a translation's ink on pixels dark in the original page away from every marked line (grown by 6 px): the bubble's outline or the art past it (the real pages have no outlines to measure against) | — |

The independent detector is [comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector)
by ogkalu (RT-DETR-v2, Apache-2.0), trained by others on about 11,000 manga, webtoon, manhua and
western comic images. It is not part of Gytakusub.

## Limits of these numbers

- **Textured areas are filled by Telea unless `--fill aot` is given**, and the extension never
  fills with Telea where a learned model runs (AOT on the CPU, LaMa on a graphics card). Art damage
  and the look of fills over art are worse with Telea than in use, and Telea can pull dark lines
  back into an erased line's shape, which counts as the line left. 4.0's free-text numbers are read
  with `--fill aot`, which on 3 generated pages now takes about Telea's time (28 s against 27 s).
  Most of the damage that remains is the eraser's mask, which takes a line's whole box over tone or
  an object's surface, not only its letters; any fill then changes those pixels.
- **"Set under 0.7 of its size" counts lines the bubble can't hold at that size.** English runs 2.3
  times the characters of Japanese, and a tall, narrow bubble made for one column has no row wide
  enough for a long English word at the original size. "Could fit at 0.7" separates those.
- **Manga109-s is Japanese print manga**, mostly from the 1970s to the 2010s. Webtoons,
  colour manhwa and Latin-script scanlations are only in the generated pages, which are simpler
  than real art.
- **The models' training data is not known to us.** The bubble model or the independent detector
  may have seen some Manga109 pages.
- **Claude is simulated**: real answers miss lines, tag the wrong region or box loosely more often
  than the stand-in does. Reports from real reading (the debug report) remain the final check.

## Running it

The real pages need Manga109-s, which may not be redistributed: request access on Hugging Face,
download it to your machine, and never commit any of it. The independent detector is
`detector-v4-s_int8.onnx` from [ogkalu/comic-text-and-bubble-detector](https://huggingface.co/ogkalu/comic-text-and-bubble-detector),
saved as `tests/bench/models/comic-text-and-bubble-detector.onnx` (or named in `GYT_WITNESS`).
`tests/bench/models/`, `runs/` and `data/` are ignored by git.

```sh
cd tests
HF_TOKEN=… python3 bench/manga109-fetch.py bench/data/m109            # once: the pages in bench/manga109-pick.tsv
node bench/manga109.mjs bench/data/m109 bench/runs/m109.jsonl --pick bench/manga109-pick.tsv
node bench/synth-run.mjs bench/runs/syn.jsonl 0 150                     # generated, looked at
node bench/synth-run.mjs bench/runs/syn-held.jsonl 100000 150           # generated, held out
node bench/report.mjs --real 'bench/runs/m109*.jsonl' --generated 'bench/runs/syn*.jsonl'
```

`--dump <dir>` writes each looked-at page's render and details for examining failures. A run can
be stopped and started again: pages already counted are skipped. `--max N` stops after N pages
(node's memory grows over a long run; a loop that restarts it is in the bench's header).
`--printed` adds lettering printed on objects and slanted free text to the generated pages;
`--readers` the bubble shapes the owner's chapters showed; `--webtoon` dark bubbles with coloured
lettering and bubbles cut by the image's edge, as a webtoon episode has them; `--cut-lettering`
bubbles the image's edge cuts at their lettering, through its nearest row or just short of it. Both benches erase
with the learned text mask, as the product does since 3.4; `--rules` erases with the rules alone
(the setting off). Each row has `textMask` and `maskMs`, the mask's time on one CPU thread.

`bench/detectors.mjs` measures what a candidate detector finds, not what the engine makes of it:
a text detector's lines against today's line finding, on generated pages or a debug report, and
a bubble model's bubbles by kind (dark, light, cut by the image's edge), masks or boxes, the model
named in `GYT_SEGMENT`. ADR 0024 has what it measured for 3.3.

The numbers the engine decides with are in `extension/engine/tuning.js`. `GYT_TUNE` changes some
for one run, to see what a result hangs on; a name that is not a tuning value stops the run:

```sh
GYT_TUNE='{"LAYOUT":{"adoptMaxLetter":5}}' node bench/synth-run.mjs bench/runs/syn-adopt5.jsonl 0 150
```

Manga109-s is used under its terms, which ask that work using it cite: J. Baek, A. Miyai,
S. Onohara, H. Ikuta, K. Aizawa, *Manga109-v2026: Revisiting Manga109 Annotations for Modern Manga
Understanding*, Culture × AI Workshop at ICML 2026; K. Aizawa, A. Fujimoto, A. Otsubo, T. Ogawa,
Y. Matsui, K. Tsubota, H. Ikuta, *Building a Manga Dataset "Manga109" with Annotations for
Multimedia Applications*, IEEE MultiMedia 27(2), 2020; Y. Matsui, K. Ito, Y. Aramaki, A. Fujimoto,
T. Ogawa, T. Yamasaki, K. Aizawa, *Sketch-based Manga Retrieval using Manga109 Dataset*, Multimedia
Tools and Applications 76(20), 2017; J. Baek, Y. Matsui, K. Aizawa, *COO: Comic Onomatopoeia
Dataset for Recognizing Arbitrary or Truncated Texts*, ECCV 2022.
