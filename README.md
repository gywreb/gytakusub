# Gytakusub

Translate manga, manhwa and comics **in place** with your own Claude API key — as a browser extension (Brave / Chrome / Edge) and as a phone-friendly web app. No server, no account, no credits: the browser talks to the Claude API directly.

| | `extension/` | `web/` |
|---|---|---|
| Where | Brave / Chrome / Edge on desktop | Any browser, installable as a home-screen app on iPhone/Android |
| Input | Images on sites you enable; hover → Translate, `Alt+T`, or per-site auto-translate | Screenshots (paste / Photos) or a chapter link via a reader adapter |
| Output | Transparent overlay on the page | Translated page images you can save or share |

Both share the same engine: `bubble.js` (local bubble detection, flood-fill, lettering-size estimate), `typeset.js` (painting + text fitting) and `prompt.js` (Claude prompt, API call, response parsing). The copies under `extension/` are canonical; run `scripts/sync-shared.sh` after editing them.

## How it works

1. The page is downscaled (≤1600 px; tall webtoon strips are sliced) and **speech bubbles are detected locally** — closed, flat, light regions containing ink. Each gets a numbered red mark.
2. Claude (vision) is asked, per piece of text, *which numbered bubble it is in* plus a pixel box — set-of-mark prompting, which is far more reliable than asking a language model for coordinates.
3. Marked bubbles are repainted exactly in their own colour and the translation is typeset inside, sized from the original lettering. Bubbles cut by panel borders get a text-zone erase; text over artwork gets a translucent box.
4. Names and the last ~40 translated lines are carried across pages for consistent translation.

## Setup

- **Extension**: see [`extension/README.md`](extension/README.md) (load unpacked, paste API key in Options, then enable the sites you read from the popup).
- **Web app**: see [`web/README.md`](web/README.md). The `main` branch deploys `web/` to GitHub Pages automatically via `.github/workflows/pages.yml` (enable *Settings → Pages → Source: GitHub Actions* once).
- **API key**: platform.claude.com → Settings → API keys. Max/Team plans include monthly API credits that cover this.

## Releasing

Store listing copy, permission justifications and the submission checklist live in `store/`. `scripts/build-zip.sh` builds the upload; pushing a tag `vX.Y.Z` (matching `extension/manifest.json`) attaches it to a GitHub Release.

## Development

```sh
cd tests && npm install
npm test                                   # unit tests (bubble detection, text fitting, JSON parsing)
npm run detect -- path/to/page.png         # see what the detector finds (writes page1-marks.png)
npm run e2e:extension -- page.png out.png items-page1.json   # full render through content.js with a mocked model
npm run e2e:web -- page.png out.png        # full render through the web pipeline
```

Tests use `node-canvas` so the real rendering code runs headless. Put sample pages in `tests/fixtures/` (git-ignored).

## Scope and content

Gytakusub is a reading aid: it translates, on the user's own device, images the user is already viewing, and never downloads, hosts, caches beyond the browser session, or redistributes pages. It is not affiliated with any publisher or reader site. Use it with content you have the right to read.

## Privacy

The only data that leaves the browser is the page image (with numbered marks) sent to `api.anthropic.com` with **your** key, plus optional glossary/context text you configured. No analytics, no third-party server. The optional Cloudflare image proxy (`web/worker.js`) only relays image bytes from allow-listed hosts and never sees the key.

## License

MIT
