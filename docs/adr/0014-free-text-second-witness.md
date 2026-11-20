# ADR 0014: Free text by two witnesses, lettering by colour, fills ahead of the answer

Status: accepted (2.12.0). Date: 2026-11-18.

## Context

The owner's test of 2.12 on an M4 MacBook (a colour chapter and a black-and-white one):

- **Speed:** the texture fills ran after Claude's answer, so a page appeared up to 1.7 s later than in 2.10 (0.65 s on average on the B/W chapter).
- **Free text:** on the B/W chapter, 7 of 28 lines outside bubbles were wrong. 4 were never found, so the English was drawn over the Japanese. 3 were found only in part, so half the Japanese stayed.
- **Colour:** most lines of blue, orange or pink lettering kept their Japanese, in bubbles too. The analysis reads lettering by its darkness, and a coloured letter is neither dark nor light enough.

## Decision

1. **Fill while Claude answers** (`page.js prefillPage`). During the API wait, every region is erased and its textured areas are filled into a cache. The cache is keyed by each fill's exact inputs (`erase.js fillKey`). The finish reuses what matches and fills the rest, so the page is identical to one filled without the prefill, only sooner (`tone.test.mjs` checks this).
   - In the extension the prefill runs behind every other lane task.
   - In the web app it waits while another page is analysed or finished.
2. **Claude's box is a second witness for free text** (`layout.js adoptLettering`).
   - The analysis sets lettering aside when it can't be sure it is text: too small or large for dialogue, a stroke spanning the line, no grey contrast.
   - When a translated line's box holds such lettering, the two agree, and it is erased. It joins the free-text region the line was tagged to, or becomes the line's own region.
   - Each line of set-aside lettering goes to the one box that fits it best (overlap against both sizes), so a long caption's box can't take the credits beside it.
   - Never taken: lettering of a line in a bubble, lettering over 4× the dialogue size, and boxes the analysis sliced into three or more guessed lines and then rejected (a logo).
   - Adopted lettering is erased all or nothing. If under 60% of its ink is taken (outlined display lettering), it stays as it was.
3. **Lettering by colour against a plain surround** (`erase.js`). Where 9 in 10 pixels around a text window lie within 40 of their median, lettering is what stands more than 64 away from it in any channel, whatever its colour.
   - The window also takes in the detector's own line box, which the analysis may have narrowed to a coloured letter's dark core.
   - In a plain bubble, marks wholly inside the interior and near the detected lines are lettering too.
   - Screentone and art are never plain, so there the polarity masks alone decide, as before.
4. **A loose box no longer overrides a region number.** It needs at least half of itself on the other region and under a quarter on the stamped one. A box straddling two regions, as boxes round free text often do, is no evidence.

## Evidence

`npm run audit -- <report> <out> --rtdetr detector.onnx` replays a debug report with its saved answers and counts translated lines whose Japanese survives erasing. The witness for that is comic-translate's RT-DETR text detector, independent of ours. Seven chapters (local only), 2.12.0 before this → after:

- Lines with Japanese left: 66 → 33 of 780. On the colour chapter: 18 → 2.
- Marks left in bubbles: 16 → 6.
- Lines with no region: 35 → 12.

Erased areas compared one by one: none worse, 19 better, 679 unchanged, and 13 newly erased (each checked by eye).

A check caught three faults of the first version, now fixed:

- A screentone bubble counted as plain.
- A long caption's box took the credits beside it.
- A logo sliced into lines was erased.

## Not done

- A line Claude numbered wrong still lands in the wrong place.
- A coloured line on art, rather than on a plain surround, is still read by its darkness alone.
- A title the analysis takes for free text is erased as before, and on busy art the fill shows.
