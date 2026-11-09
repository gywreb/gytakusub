Put manga page PNGs here for the e2e scripts (not committed).

## Browser tests (`npm run test:browser`)

`tests/browser/run.mjs` loads the real extension into headless Chromium
(Playwright's build; `GYT_CHANNEL=chrome` for an installed Chrome for Testing),
points it at a mock Claude API (`mock-api.mjs`) and translates `demo-page.png`
three times: first render, forced Redo, and from the warm cache. It asserts that
every tagged translation lies inside its own detected bubble and that the three
renders are identical, then checks peek, edit and persistence, and that the
popup and Options show the stored settings within 3 s while the worker is busy.
`--bad-boxes` makes the mock return correct tags with drifted pixel boxes — the
real-world failure where the model reads the stamps right but places badly.
`--segmenter <model.onnx>` ships a stand-in bubble model (`make-fake-seg.py`)
with the test copy; `--gpu --require-gpu` runs the WebGPU path (in CI on Mesa's
software GPU) and fails if the models did not run there. `browser/web.mjs` does
the same for the web app. Screenshots and the debug log land in `--out`.

## Procedural pages (`npm run demo` → `gen-NN.*`)

`make-pages.py` lays out twelve deterministic pages mixing Latin (Spanish,
Italian) and Japanese (vertical and horizontal) lettering, light and dark
bubbles of three shapes, caption boxes, free narration straight on screentone,
and large sound effects the engine must ignore. Each page has `*.truth.json`
(regions: box, kind, shape, items, lang, dark) and `*.items.json` (a stand-in
model answer). `engine.test.mjs` runs detection, layout and erase assertions
over every page; `node engine-viz.mjs <png> <out.png> --trace` shows what the
analyser saw and why it rejected what it rejected.

`make-ruby-page.py` draws `ruby-00`: vertical Japanese columns with furigana
beside them, for the ruby tests (the furigana is erased with its column and is
never the letter-size reference).

The generated PNGs and JSON are committed so CI and every machine test the
same pages (regenerating needs Pillow and a Noto CJK font; `GYT_NO_CJK=1`
produces a different, Latin-only set and is only for machines without the font).

`fixtures/real/` is git-ignored: put your own pages there for local tuning.

## Scoring on real pages (`npm run score -- report1.zip report2.zip …`)

`score-reports.mjs` runs the detector on the original pages inside "Export
debug report" zips and scores it with the model's own answer as the witness of
where text is: *coverage* (items whose position falls in a detected region),
*dialogue recognised as a bubble* (the metric that decides whether text is
typeset in the bubble or squeezed into a line footprint), and *waste*
(regions with no text). `--engine <dir>` scores another checkout's engine for
a baseline; `--misses` names the rule that rejected the region around each
missed item. Tune on some reports, validate on the rest: a change ships only
if the hold-out numbers do not get worse.

`layout-score.mjs` (`npm run score:layout -- …zip`) measures the rendered
result on the same pages: translation size relative to the original lettering
(and in pixels on a 1000 px page), words broken letter by letter, overflow, and
how much original lettering is left inside the model's item boxes after
erasing.
