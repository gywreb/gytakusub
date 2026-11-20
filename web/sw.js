// Gytakusub Web – service worker: cache the app shell so it opens instantly
// (and offline for screenshot mode). Translation requests always go to the network.
const CACHE = "gytakusub-v14";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./translator.js", "./lama-guard.js", "./fetcher-client.js", "./fetcher-worker.js", "./fetcher-guide.json", "./lib/qrcode.mjs", "./prompt.js", "./usage.js", "./i18n.js", "./languages.js", "./_locales/en/messages.json", "./locales/en/messages.json", "./claude-usage.js", "./text.js", "./engine-worker.js", "./engine/page.js", "./engine/cv.js", "./engine/analyze.js", "./engine/erase.js", "./engine/tone.js", "./engine/inpaint.js", "./engine/layout.js", "./report.js", "./version.js", "./vendor/hyphen-en.js", "./vendor/lettering-fonts.js", "./vendor/opencv.js", "./vendor/opencv_js.wasm", "./manifest.webmanifest", "./icons/icon48.png", "./icons/icon192.png", "./icons/icon512.png", "./icons/apple-touch-icon.png", "./fonts/ComicNeue-Bold.ttf", "./fonts/ComicRelief-Bold.ttf", "./fonts/Mali-Bold.ttf"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== "GET") return; // API + images: network
  // the models (vendor/*.onnx, up to 103 MB): the browser's own HTTP cache keeps one copy and checks it
  // against the server; copied in here as well, each visit wrote it again (v14 drops those copies)
  if (url.pathname.endsWith(".onnx")) return;
  e.respondWith(
    fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
