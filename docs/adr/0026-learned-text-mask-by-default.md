# 0026. The learned text mask, on by default

Status: accepted (3.4.0). Supersedes ADR 0022's "off by default"; the rest of 0022 stands.

## Context

3.2 shipped the learned text mask behind a setting, off by default, as a preview (ADR 0022). Its measurements were already better than the rules on every count, at a cost in time where there's no graphics card. 4.0's first step turns it on by default (roadmap, "4.0: the plan", step 1). Its gate:

- the 3.2 numbers hold with 3.3's engine on held-out pages;
- time is no worse than with the setting on today;
- the web app fits a phone's memory (the owner's iPhone is the check).

## Decision

1. **The setting is on unless the user turns it off**, in the extension (Options) and in the web app (Settings). It's no longer marked as a preview.
2. **It's a new setting, `learnedTextMask`.** Every Options page saved since 3.2 wrote the old preview's `learnedMask: false`, whether or not the user had touched it. Under the old name, the new default would have reached almost nobody. Someone who wants the rules alone turns the new setting off. The old key is left unread.
3. **The engine's default follows:** with no setting given, `preparePage` uses the mask. The benches (`synth-run.mjs`, `manga109.mjs`) and the browser tests run as the product does. `--rules` gives the setting off; `--textmask`, the flag before 3.4, is still accepted and means on.

## Measured

3.3.0 with the setting on, against 3.2.0 with it on, on pages never looked at.

- **The same on every page:** 333 real pages, 150 plain generated pages and 100 webtoon pages.
- **The two other sets differ by what 3.2.1 changed** (lettering the image's edge cuts, ADR 0023):
  - on the 150 pages with lettering at the image's cut, lines left untouched went 38 → 31, those in the bubbles cut there 17 → 10;
  - of the 150 pages with the owner's bubble shapes, one has more art damage (1.1 per thousand pixels). It's held out, so it wasn't looked at.

Against the rules (the setting off, today's default), held out:

| | Rules | Learned text mask |
|---|---|---|
| Real pages (2,839 lines the witness reads): lettering still seen | 1.69% | 1.09% |
| Real pages: art damage | 0.098% | 0.045% |
| Generated (810 lines): lines left untouched | 5.2% | 2.7% |
| Generated: free-text lines left untouched | 24.5% | 10.8% |
| Webtoon (789 lines): lines left untouched | 18.5% | 5.6% |
| Webtoon: lines in dark bubbles left untouched | 59.5% | 15.6% |
| Webtoon: bubble outline pixels erased | 2,635 | 5,026 |

The one count that's worse is the outlines of dark bubbles the bubble model misses. The mask erases more of them (ADR 0022). 4.0's own bubble model (step 3) is for those bubbles.

**Time:** the mask's median per page on one CPU thread is 4.6 s on real pages (90th percentile 14.1 s), 3.6 s on plain generated pages and 5.9 s on webtoon pages. On the owner's graphics card (WebGPU) it was 37 ms a page in 3.2's run. Safari turns WebGPU on by default from iOS 26 ([WebKit](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#webgpu)), so the web app can run the mask on an iPhone's graphics card. Whether it does there, and its memory, isn't measured: a phone can't be measured from here.

## Not measured

- The web app's memory and speed on a phone with the mask loaded. The owner's iPhone is the check before release.
