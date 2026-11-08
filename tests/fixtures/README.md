Put manga page PNGs here for the e2e scripts (not committed).

## Browser tests (`npm run test:browser`)

`tests/browser/run.mjs` loads the real extension into headless Chrome (Playwright,
`chrome` channel), points it at a mock Claude API (`mock-api.mjs`) and translates
`demo-page.png` three times: first render, forced Redo, and from the warm cache.
It asserts that every tagged translation lies inside its own detected bubble and
that the three renders are identical. `--bad-boxes` makes the mock return correct
tags with drifted pixel boxes — the real-world failure where the model reads the
stamps right but places badly. Screenshots and the debug log land in `--out`.

## Procedural pages (`npm run demo` → `gen-NN.*`)

`make-pages.py` lays out eight deterministic pages mixing Latin (Spanish,
Italian) and Japanese (vertical and horizontal) lettering, light and dark
bubbles of three shapes, caption boxes, free narration straight on screentone,
and large sound effects the engine must ignore. Each page has `*.truth.json`
(regions: box, kind, shape, items, lang, dark) and `*.items.json` (a stand-in
model answer). `engine.test.mjs` runs detection, layout and erase assertions
over every page; `node engine-viz.mjs <png> <out.png> --trace` shows what the
analyser saw and why it rejected what it rejected.

`fixtures/real/` is git-ignored: put your own pages there for local tuning.
