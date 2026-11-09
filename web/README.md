# Gytakusub Web

The phone-friendly version: a static web app (PWA) that runs the same translation engine as the extension. Works in Safari, Brave and Chrome on iOS/Android, and on desktop.

## Install on iPhone (once)

1. Open the app URL in **Safari** (Brave/Chrome on iOS can't add real home-screen apps).
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Gytakusub** from the home screen → the Settings dialog appears → paste your Claude API key → **Test key** → **Save**.

The key is stored only in that browser (localStorage). Repeat on the MacBook or another device if you want it there too.

The first page after opening the app takes longer: the browser downloads and compiles the engine and its two models (about 75–90 MB, depending on whether the GPU or CPU variant of the bubble model loads; kept in the browser cache afterwards) — use Wi-Fi the first time. Pages are analysed on the graphics card where the browser offers WebGPU (Safari 26, Chrome), on the CPU otherwise.

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
translator.js                      main thread: Claude call, settings, drawing text on the cleaned page
engine-worker.js                   Web Worker running the shared page engine (text and bubble models, OpenCV analysis, erase, layout)
sources.js                         reader adapters for chapter-link mode
engine/, vendor/, prompt.js, text.js, fonts/, LICENSE, THIRD_PARTY.md   shared with ../extension — copied by `node scripts/sync-shared.mjs`, not committed
sw.js, manifest.webmanifest        PWA shell
worker.js                          optional Cloudflare image proxy
```

## Running locally

The engine, the vendored libraries and models (OpenCV.js, ONNX Runtime Web, the
text detector, the bubble model, hyphen), `prompt.js`, `text.js`, fonts and
icons are shared with the extension and are **not** committed under `web/`.
Copy them in first, then serve the folder (it needs a server because of the
module worker and wasm):

```sh
node scripts/sync-shared.mjs
cd web && python3 -m http.server 8080      # or: npx http-server web -p 8080 -c-1
```

GitHub Pages runs the same sync step before deploying.
