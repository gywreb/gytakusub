# Gytakusub

Translate manga / manhwa / comic pages **in place**, on any website, using your own Claude API key.
No backend, no account, no credits — the extension talks to the Claude API directly from your browser.

## Install (Brave / Chrome / Edge)

1. Unzip this folder somewhere permanent.
2. Open `brave://extensions` (or `chrome://extensions`), turn on **Developer mode**.
3. **Load unpacked** → pick the `gytakusub` folder.
4. Click the extension icon → **Options** → paste your API key (from console.anthropic.com → API keys) → **Test** → **Save**.
5. Reload any manga tab that was already open.

Repeat steps 1–3 on each device. Settings, glossary and (optionally) the API key sync through your browser's sync.

## Use

| Action | How |
|---|---|
| Translate one page | Hover the image → **Translate** |
| Translate everything on screen | `Alt+T`, or popup → *Translate visible* |
| Hide / show translations | `Alt+Shift+T`, or hover → **Hide** |
| Make a site "yours" (hover button + shortcuts) | Popup → *Enable on \<this site\>*. Elsewhere the extension stays dormant until you use the toolbar button or `Alt+T`. |
| Translate automatically while scrolling | Popup → *Auto-translate while scrolling here* (per-site; implies enabled) |
| Switch everything off | Popup → master switch (badge shows "off") |
| Redo a page (e.g. after editing the glossary) | Hover → **↻ Redo** |
| Peek at the original lettering | Rest the pointer on a translated bubble for a moment (Options → *Peek at the original* to turn off) |
| Correct a line / teach the glossary | Double-click a translated bubble → edit → **Ctrl+Enter**; or fill "original term = translation" → *Add* |

## How it works

1. The background worker fetches the image bytes itself (so cross-origin CDNs like MangaDex's work) and downsizes to ≤1600 px (tall webtoon strips are sliced into ~1800 px pieces).
2. **Local text and bubble detection** (`engine/analyze.js` on OpenCV.js, no ML model): glyph-sized ink components grouped into lines and kept when they look like one font; the flat light or dark shape around them is a bubble if lettering is all it contains. Each region gets a numbered red stamp on the copy sent to Claude. Also handles Japanese vertical text, dark bubbles, captions and loose narration.
3. Claude is asked, per text item, *which numbered region it is in* (set-of-mark prompting — far more reliable than asking a language model for coordinates). The tag decides placement; the pixel box only orders speakers inside a joined bubble or places text the detector missed. Names it finds and the last ~40 translated lines in the tab are fed back into later requests for continuity.
4. The background worker **inpaints the original lettering away** (`engine/erase.js`, Telea; outlines and art untouched) and computes where each line goes (`engine/layout.js`: the largest rectangle inside the bubble shape, joined bubbles split at the waist). The content script lays a transparent canvas over the image showing the cleaned page and typesets the translation into those rectangles (`text.js`), sized from the original lettering, hyphenating only when nothing else fits.
5. Results are cached per image URL for the browser session, up to 3 pages translate in parallel, nearest to the viewport first.

## Cost

Roughly 1,500–2,000 input tokens per page plus a few hundred output tokens. Haiku is the default; switch to Sonnet in the popup for dense or stylised Japanese.

## Known limitations (v0.1)

- The content script is injected only on enabled sites or on demand, so the first "Translate visible" on a new site takes a moment longer.
- Only `<img>` elements are handled. Readers that draw pages into a `<canvas>` or CSS `background-image` are not yet supported.
- Sites that require a `Referer` header to serve images may return 403; the error shows in the hover bar.
- Overlays are positioned over the image's on-screen rectangle; if the image sits inside a scrolling sub-panel the overlay can spill past the panel edge.
- Claude's boxes are approximate. The flood fill corrects this for closed bubbles; for text over artwork the box may be slightly off.
- Text is horizontal English only; no vertical typesetting, no font export.
- Detection thresholds (`detectBubbles` in `bubble.js`) are tuned on a handful of pages; coloured webtoons with tinted bubbles may need `lightThreshold` lowered.

## Files

```
manifest.json   MV3 manifest
background.js   fetch → slice → Claude → cache; keyboard commands
bubble.js       pure helpers: bubble flood-fill, bubble painting, text fitting (unit-tested in Node)
content.js      image discovery, hover bar, overlay rendering & positioning, auto mode
content.css     injected styles (all prefixed gyt-)
popup.*         quick actions + model / auto toggles
options.*       API key, glossary, prompt, appearance, excluded sites
```
