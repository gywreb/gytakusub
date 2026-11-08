Put manga page PNGs here for the e2e scripts (not committed).

## Browser tests (`npm run test:browser`)

`tests/browser/run.mjs` loads the real extension into headless Chrome (Playwright,
`chrome` channel), points it at a mock Claude API (`mock-api.mjs`) and translates
`demo-page.png` three times: first render, forced Redo, and from the warm cache.
It asserts that every tagged translation lies inside its own detected bubble and
that the three renders are identical. `--bad-boxes` makes the mock return correct
tags with drifted pixel boxes — the real-world failure where the model reads the
stamps right but places badly. Screenshots and the debug log land in `--out`.
