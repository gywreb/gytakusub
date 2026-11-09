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

**Chapter link:** paste a chapter's address from any site that needs no login → **Load**; pages translate as you scroll, and **Next chapter ›** opens the next one. This goes through your own **chapter fetcher**, a free Cloudflare Worker you set up once: the Chapter link tab walks you through it (a key, a fork on GitHub, a Worker on Cloudflare, Connect) and stays locked until it works ([`../fetcher/README.md`](../fetcher/README.md)). A web page may not read other sites, so the fetcher opens the chapter and relays its pages. Sites behind a "checking your browser" wall, behind a login, or that build their pages with a script can't be read that way; the app says so, and screenshot mode still works for them. A bookmarklet (in the fetcher guide) opens the chapter you're reading in Gytakusub. On a wide screen (tablet, foldable inner display, laptop) pages show as right-to-left two-page spreads; switch it off in Settings.

**What it costs:** Settings → **Claude usage** shows today's and this month's Claude tokens and estimated cost per model, and the rate-limit headroom from Claude's last answer when the browser can read it. The toolbar shows today's cost while you translate. These are this browser's own records, from the token counts in Claude's answers and Anthropic's published prices. The exact bill is in the Claude Console (Usage, Cost).

## Hosting

Any static host works. This repo deploys `web/` to GitHub Pages from `main` via GitHub Actions — enable it once under *Settings → Pages → Build and deployment → Source: GitHub Actions*. The app is then at `https://<user>.github.io/gytakusub/`.

## Chapter fetcher

Chapter link mode needs it; screenshot mode never does. Setup, limits and how it finds pages: [`../fetcher/README.md`](../fetcher/README.md).

## Files

```
index.html / style.css / app.js   UI
translator.js                      main thread: Claude call, settings, drawing text on the cleaned page
engine-worker.js                   Web Worker running the shared page engine (text and bubble models, OpenCV analysis, erase, layout)
fetcher-client.js                  calls your chapter fetcher (../fetcher/worker.js): chapter pages, images, errors explained
claude-usage.js                    this browser's Claude usage log (usage.js) in localStorage
engine/, vendor/, prompt.js, usage.js, text.js, fonts/, LICENSE, THIRD_PARTY.md   shared with ../extension — copied by `node scripts/sync-shared.mjs`, not committed
sw.js, manifest.webmanifest        PWA shell
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
