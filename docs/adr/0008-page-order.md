# ADR 0008: The page on screen first

Status: accepted (2.6.0). Date: 2026-11-16.

## Context

With auto-translate on, scrolling fast through a chapter made the page you stopped at wait. The README listed it as a known limitation, and the user picked it for 2.6.0.

What happened, from the code and a measurement:
- The content script queued pages as they came within two screens (an IntersectionObserver with a 200% margin) and ran three at a time, nearest first. But it chose only when a slot freed up, and the three slots were taken by the first pages, which you had already scrolled past.
- In the service worker, every model run goes through one lock, first come first served (`engine/ort.js`; it must stay serial, see `tests/concurrency.test.mjs`). With three pages in progress their runs interleave, so all three finish late.
- The engine's model runs are synchronous WebAssembly on the worker's one thread. While one runs (1.5–4 s each on a CPU), nothing else in the worker moves: not another page's network reply, not its storage writes.
- Every page picked up was eventually sent to Claude, including pages you only flew past.

Measured with `tests/browser/queue.mjs` (14 pages, a fast scroll to the end, a mock model taking 2.5 s per answer, CPU only), before this change: the page on screen was ready **29.8 s** after the stop, three pages from the top of the chapter finished before it, and Claude was asked about **8** pages.

## Decision

**Content script (`content.js`):**
- Pages carry a job id. Auto-translate starts pages only once scrolling has settled (250 ms): a page flashing past is not one you're looking at.
- Nearest to the middle of the screen first; a page on screen starts even when the three slots are busy.
- While you scroll (every 150 ms at most), the worker gets each running page's distance and whether it is on screen, and is told to cancel auto-translated pages that are now more than two screens away. Waiting pages that far away leave the queue. The IntersectionObserver picks them up again when you come back.
- Pages you asked for yourself (Translate visible, the button on an image) are never put back.

**Service worker (`background.js`, `lane.js`):**
- A **lane** gives the engine to one page at a time and, when it frees up, takes the waiting page with the smallest distance (read live, so scrolling reorders the waiting pages).
- The engine's analysis awaits a `checkpoint` between its model runs (`engine/page.js`, optional, so the web app is unchanged). There the page hands the lane over if a more urgent page is waiting, and stops if it was cancelled.
- A page is cancelled only until Claude is asked. After that its tokens are spent, so it finishes and is cached.
- While a page on screen is in progress, pages off screen are **held** (they don't start, and a running one pauses at its next checkpoint), for at most 20 s from when the page on screen started. Without the hold, the page on screen's own reply from Claude waited for gaps between other pages' multi-second model runs: its model step took 4–7.7 s against the mock's 2.5 s. The 20 s cap keeps a slow or stuck answer from stopping the pages around it.
- Layout, erasing, the user's edits and encoding run in the lane too, at the page's priority, so nothing after the model call waits behind the next page's analysis.

**After:** the same test gives about **12 s** (11.5–12.7 s over five runs), the page on screen finishes first, and Claude is asked about **3** pages, the ones near where you stopped. The test now checks these: the page on screen before any other page picked up after the stop; no page flung past is fetched, analysed or sent; one Claude call per translated page; nothing still queued two minutes after the stop.

## Alternatives considered

- **Only reorder the content script's queue.** That doesn't help: the delay is in slots held by pages behind you and in the worker's lock order.
- **Cancel a page's analysis immediately.** A WebAssembly model run can't be interrupted. Checkpoints between runs are the finest point available.
- **Run the engine off the service worker's thread** (an offscreen document hosting a Web Worker, as the web app already does with `engine-worker.js`). That is the real fix for the shared thread: replies and storage would no longer wait for model runs, and the hold would be unnecessary. It changes the extension's architecture (offscreen document lifetime, WebGPU in a worker, messaging), so it is left for its own change.

## Consequences

- Look-ahead pages (two screens around where you stopped) start after the page on screen is done, or after 20 s.
- On the CPU, the page you stop at can still wait for one model run already in progress, a few seconds.
- The web app shares the engine but not this queue: it still takes the nearest page whenever one of its two slots frees up (`web/app.js`), as the extension did before. Its engine runs in a Web Worker, so the shared-thread part does not apply to it.
- Timing keys in the debug report changed: `layout` and `encode` are now one `finish` (layout, erase, edits, encode).
