# Gytakusub Web

The phone-friendly version: a static web app (PWA) that runs the same translation engine as the extension. Works in Safari, Brave and Chrome on iOS/Android, and on desktop.

## Install on iPhone (once)

1. Open the app URL in **Safari** (Brave/Chrome on iOS can't add real home-screen apps).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Gytakusub** from the home screen → the Settings dialog appears → paste your Claude API key → **Test key** → **Save**.

The key is stored only in that browser (localStorage). Repeat on the MacBook or another device if you want it there too.

## Use

**Screenshots (any app):** take a screenshot → tap its preview → **Share → Copy** → open Gytakusub → **Paste image**. Or **Choose photos** and pick the screenshot. Tap a page to flip between translated and original; **Save** shares/saves the translated image.

**Chapter link (advanced, off by default):** Settings → Advanced → show "Chapter link" mode. It takes a chapter link from a reader with an adapter in `sources.js` and translates pages as you scroll. On a wide screen (tablet, foldable inner display, laptop) pages show as right-to-left two-page spreads; switch it off in Settings.

## Hosting

Any static host works. This repo deploys `web/` to GitHub Pages from `main` via GitHub Actions — enable it once under *Settings → Pages → Build and deployment → Source: GitHub Actions*. The app is then at `https://<user>.github.io/gytakusub/`.

## Image proxy (only if needed)

Chapter mode fetches page images from the reader's CDN and needs to read their pixels. If a CDN refuses cross-origin reads you'll see a "blocks cross-origin reads" error; deploy `worker.js` as a free Cloudflare Worker (it relays image bytes from an allow-list, sends no spoofed headers) and enter `https://<name>.<you>.workers.dev/?url=` under **Settings → Image proxy**. Screenshot mode never needs this.

## Files

```
index.html / style.css / app.js   UI
translator.js                      pipeline: slice → detect → stamp → Claude → typeset
sources.js                         reader adapters for chapter-link mode
bubble.js, typeset.js, prompt.js   shared engine (copied from ../extension — run scripts/sync-shared.sh)
sw.js, manifest.webmanifest        PWA shell
worker.js                          optional Cloudflare image proxy
```

## Running locally

The engine, vendored libraries (OpenCV.js, hyphen), `prompt.js`, `text.js`, fonts
and icons are shared with the extension and are **not** committed under `web/`.
Copy them in first, then serve the folder (it needs a server because of the
module worker and wasm):

```sh
./scripts/sync-shared.sh
cd web && python3 -m http.server 8080
```

GitHub Pages runs the same sync step before deploying.
