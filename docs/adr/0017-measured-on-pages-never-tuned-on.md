# ADR 0017: Changes are measured on pages never tuned on

Status: accepted (2.14.2). Date: 2026-11-21. Part of the 3.0 plan ("on any series").

## Context

From 2.11 to 2.14.1, engine changes were found on the owner's debug reports and checked on the same
reports: replays of 13 to 15 chapters. A rule that fixed what those chapters showed could fit them
and fail on the next series, and the replay could not tell. The owner should not have to read manga
to supply test pages, and the check has to cover every source script, not only Japanese.

## Decision

1. **Two answer keys the engine's rules cannot bend**, measured by `tests/bench/` ([QUALITY.md](../QUALITY.md)):
   - real pages: Manga109-s, every line boxed by researchers and every sound effect outlined; 654
     pages, four spreads from each of its 87 books;
   - generated pages in seven scripts, drawn with and without their lettering, so every glyph,
     bubble inside and letter size is known exactly.
   An independent detector (comic-text-and-bubble-detector, not part of Gytakusub) checks what is
   left on real pages after erasing.
2. **Held-out halves.** The books are split by a hash of their names, and the generated pages by
   seed. A change is examined on one half and kept only if it holds on the other, which is counted
   and never looked at.
3. **Claude is simulated** from the marked boxes (moved and resized as Claude's are), so the numbers
   measure the engine, not a model's reading on the day.
4. **The owner's debug reports stay the final check**, not the tuning set.
5. **Legal:** Manga109-s may not be redistributed: its pages stay on the machine running the bench
   (`tests/bench/data/`, ignored by git), and published numbers name it and cite its papers.
   Generated pages only in the repository, pull requests and screenshots.

## Consequences

- The README and QUALITY.md show the held-out numbers, written by `tests/bench/report.mjs`.
- Running it takes about an hour on two cores (Telea fills; no graphics card). A change to one rule
  can be checked on the half looked at first (about 20 minutes).
- Rules found on a report are still welcome, but ship only with held-out numbers no worse.
- The numbers have limits ([QUALITY.md](../QUALITY.md#limits-of-these-numbers)): Telea instead of
  the inpainting model, Japanese-only real pages, simpler generated art, a simulated Claude.
