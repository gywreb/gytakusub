# 0025. One answer contract

Status: accepted (3.3.0)

## Context

Claude answers each slice of a page with lines: a mark (the number of the stamped region it's in), a box, a kind, the original and the translation. The engine took the answer's shape on trust. It repaired a few of Claude's errors, each where it was first seen. `normalizeItems` dropped marks outside the slice's range. The layout let a box overrule a misread mark and dropped a mark the box had drifted far from (ADR 0003). `checkCopies` asked again about lines left in the original language. Lettering under a translated line's box was adopted. Nothing checked how the boxes were written. An answer cut off by `max_tokens` failed the whole page.

5.0 brings readers that err in other ways: Gemini's documented boxes are `[y_min, x_min, y_max, x_max]` on a 0–1000 grid. The bench's answers were exact except for their boxes, so a reader's errors had never been measured.

## Measured: Haiku's errors on real pages

The source is the owner's debug reports: 826 pages and 3,505 lines Claude translated, all read by Claude Haiku 5.5. The checks are the engine's regions, and the bench's independent witness for text the engine didn't count.

| Error | Rate |
|---|---|
| A mark its own box overrules (the layout's rule: the box mostly on another region, under a quarter on the marked one) | 1.3% |
| A box beside its marked region, mostly one paragraph the engine had split into several regions | 4.6% |
| No mark, for a line whose box is in a region | 5.4% |
| A box on no lettering: neither it nor its region holds text the witness sees | 1.9% at most |
| Text in a bubble the witness sees that no line names | 3.2% at most |

These are the bench's **strong reader** (`bench/reader.mjs`). The **weak reader** makes them three times as often, plus errors Haiku's answers didn't show:

- dialogue labelled a sound effect
- two lines given as one, or one as two
- the same line twice
- a line for a region with no lettering
- every box in another convention (half its answers)
- an answer cut off (one in twenty)

The weak reader's numbers are mine until 5.0's reading check measures real models. A reader's answer goes through the contract in its own form: pixels, stamp numbers, or the JSON text when it was cut.

A new count on generated pages: a line is **delivered** when its lettering is erased and its translation sits inside its own bubble, or over its own free text.

## Decision

1. **Every answer is checked in one place**, `engine/contract.js` `checkAnswer`, by the extension and the web app alike, before the layout sees it:
   - items that aren't a list give none;
   - **the way the boxes are written** is judged by what the analysis found: each of 12 ways (pixels, fractions or a 0–1000 grid; x or y first; a size or corners) is tried on every box. A box counts once when it holds found lettering (a text line half inside it, or its centre on one) and again when its centre lies in its marked region. The contract's way stands unless another counts at least two boxes and a quarter more. A box or two off their lettering is a reader's ordinary error, not another way of writing. Regions stand in for lines only when no line was found: a region can be a whole bubble or block of free text, where a box written any way can land by chance;
   - the same line twice (its words and translation, in the same place) is kept once;
   - **a line labelled a sound effect whose mark and box both put it in a speech bubble is dialogue.** The prompt asks for sound effects drawn as part of the artwork. Lettering in a speech bubble is something a character says, and labelled "sfx" it was left as drawn (2.14.1 found one such line lost).
2. **An answer cut off, or whose JSON breaks partway, keeps its complete items** (`parseAnswer`). Before, the page failed.
3. Every repair is listed in the debug report (`timing.answer`). A line left as a sound effect now carries its mark and box there too, so a report shows whether it sat in a bubble.
4. The layout's checks stay where they are: they weigh the answer against the page's geometry, not the answer's own form.

## Measured

Generated pages: decisions on the looked-at half (seeds 0–99, 0–39 webtoon). The held-out half was only counted.

**Haiku's real answers (746 report pages, 3,154 lines):** the contract changes none of them. No box way switches, and no line is dropped as a duplicate. Sound-effect labels can't be checked on these reports: they didn't record where such lines were (from 3.3 they do).

| Looked at, plain generated pages (520 lines) | 3.2.3 | 3.3.0 |
|---|---|---|
| Exact answers: delivered | 94.8% | 94.8% (every page the same) |
| Strong reader: delivered | 91.3% | 91.3% (every page the same) |
| Weak reader: delivered | 68.1% | 81.7% |
| Weak reader: lines lost | 166 | 95 (−43%) |

- **Of the weak reader's losses**, 40 lines it left out and 20–28 after a cut aren't in its answer, so nothing in the answer can bring them back.
- **Of the lines its answer carried**, 98 were lost before and 35 after (−64%).
- **Boxes in another way** were read that way in 61 of 64 answers (all 14 on webtoon pages). The 3 missed had 2 to 4 boxes. None was switched wrongly, on generated pages or on the 746 real ones.

**Held out (seeds 100000+, counted only):**

| | 3.2.3 | 3.3.0 |
|---|---|---|
| Exact answers, plain (543 lines): delivered | 94.3% | 94.3% (every page the same) |
| Strong reader, plain: delivered | 91.9% | 91.9% (every page the same) |
| Weak reader, plain: delivered (lost) | 71.5% (155) | 81.8% (99) |
| Weak reader, webtoon (316 lines): delivered (lost) | 62.0% (120) | 68.7% (99) |

- With the weak reader, 50 of 52 answers in another way were read that way, and none was switched wrongly.
- Art damage with the weak reader went 0.25 → 0.32 per thousand (plain), against 0.37 for exact answers on the same pages. On the pages where it rose, it rose to what exact answers cost there: those lines are now erased.
- **One page lost a line** (plain, 4 → 3 delivered). Held out, so not looked at. On the one looked-at page where a line was lost the same way, its boxes, read the right way, put one of them (a box the reader had put off its lettering) on another region, and the box overruled the mark there: the layout's rule (ADR 0003). Read the wrong way, that box had pointed nowhere and the mark stood.

## Not done

- **A line the reader left out isn't asked for again.** On real pages, 27% of pages have a bubble no line names (259 of 958), but at most 3.2% of the bubble text the witness sees is unnamed. Most of those bubbles are sound effects, marks or art, so a second call would cost on a quarter of pages to find little.
- **The rest of an answer that was cut off isn't asked for.** Haiku's answers fit their 8,192 tokens; a reader with less room may not.
- **3 of 64 answers in another way, with 2 to 4 boxes, stay unread.** Lowering the margin would also switch answers whose boxes are merely loose.
- **The gate's "weak reader: lines lost at least halved" is not met:** −36% on held-out plain pages, −18% on webtoon pages, where dark bubbles lose lines whoever reads them (ADR 0024). The gate counted lines no answer carries. Of those the answer carried (looked at), the loss fell by two thirds.
