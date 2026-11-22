# ADR 0018: A page leaves nothing behind in OpenCV's memory

Status: accepted (2.14.7). Date: 2026-11-22. Part of the 3.0 plan (a robust core).

## Context

OpenCV.js keeps every object it hands out (a Mat, a view of one, a vector of them) in its own
memory until the object is deleted. That memory is capped at 1 GiB and never shrinks while the
worker lives, and one worker translates every page of a reading session. Whatever a page leaves
behind adds up. In 2.14.5, a Naver episode failed from image 110 of 121, each image after with a
bare number for its error.

The engine deleted each object by hand where its work was done. That missed objects in two ways:

- A view whose copy was taken was never deleted (fixed in 2.14.6). A view keeps its whole parent
  alive.
- Whenever something threw between a make and its delete, the delete was skipped. With 2.14.6's
  engine, 162 of the 191 failure points below left objects alive. Two of them are common:
  - A page's prefill is stopped each time Claude's answer comes first, and each stop left the
    page's colour copy behind.
  - A failing LaMa run left its window of the page behind, once per area.

## Decision

1. **Every OpenCV object has an owner** (`engine/owner.js`).
   - Each engine function that makes OpenCV objects passes each one through an owner as it is made.
     The owner frees them when the function returns or throws.
   - An object handed back to the caller is let go of (`own.keep`), and the caller's owner takes it
     on.
   - An analysis owns its masks and label maps until its `dispose()`.
   - Deleting early, to keep the peak low, is still fine.
2. **A page is released however it ends.**
   - `finishPage` frees the job whether it succeeds or fails.
   - `releasePage(job)` frees a page dropped before its finish.
   - The extension's worker calls it in a `finally` around the whole page. The web app's worker
     calls it after every finish and drop, and the web app drops a page on any failure before its
     finish.
3. **Tested by failing on purpose.** `tests/opencv-audit.mjs` records every OpenCV object with the
   engine line that made it. `tests/fail-paths.test.mjs` then fails each page at every point it can,
   one point at a time:
   - every engine line's first OpenCV call, made to throw as OpenCV throws;
   - every checkpoint, as a stop;
   - every model run, as a failure.

   After each failure, nothing may be left alive. `tests/memory.test.mjs` checks the same on pages
   that go well, through the engine's entry points.
4. **If OpenCV still runs out,** the failure says so: "its memory at 1024 MB, all it can have". The
   next page then starts a fresh OpenCV. A page already under way finishes on the OpenCV it began
   with (`job.cv`), and that one is let go of once no page holds it.

## Consequences

- New engine code follows the owner pattern. A path the failure test reaches but that leaves
  something alive fails CI, and the message names the line that made the object.
- The failure test covers these cases:
  - a page at its own size;
  - a page analysed smaller;
  - LaMa's fill with the page around each area;
  - the OpenCV text detector;
  - the analysis without models.

  It does not cover the learned fill's warm-up, which runs once per worker and owns its two
  objects.
- The fresh start is tested in Node. It relies on the browser collecting the old module once
  nothing refers to it, which Node can't show.
