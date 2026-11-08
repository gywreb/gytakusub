// Gytakusub – content script. Injected only on sites the user enabled (or on
// demand from the popup / hotkey). Finds large images (manga pages), offers a
// hover button, asks the background worker for a translation, then paints an
// overlay canvas via the shared typesetting engine.

(() => {
  "use strict";
  if (window.__gytLoaded) return;
  window.__gytLoaded = true;

  const G = globalThis.GyT;
  const MIN_W = 280, MIN_H = 280; // px, natural or rendered
  const MAX_CANVAS_EDGE = 2500;
  const MAX_PARALLEL = 3;

  /** @type {Map<HTMLImageElement, {status:string, src:string, canvas?:HTMLCanvasElement, hidden:boolean, result?:any, error?:string, objectFit?:string}>} */
  const entries = new Map();
  let settings = { enabled: true, autoSites: [], enabledSites: [], uppercase: false, fontFamily: "", excludedSites: "" };
  let allHidden = false;
  let hoverImg = null;

  // ---------- UI lives in a closed shadow root: page CSS/JS can't reach it ----------

  const host = document.createElement("div");
  host.id = "gyt-host";
  host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .root { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
    canvas.overlay { position: fixed; pointer-events: none; }
    .bar { position: fixed; display: flex; gap: 4px; padding: 4px; border-radius: 8px; background: rgba(17,24,39,.85);
      backdrop-filter: blur(4px); box-shadow: 0 2px 8px rgba(0,0,0,.35); font: 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      color: #fff; opacity: 0; transition: opacity .12s; pointer-events: none; }
    .bar.visible { opacity: 1; pointer-events: auto; }
    .bar button { all: unset; cursor: pointer; padding: 6px 9px; border-radius: 6px; background: rgba(255,255,255,.08); color: #fff;
      font: 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; white-space: nowrap; }
    .bar button:hover, .bar button:focus-visible { background: rgba(255,255,255,.2); outline: 2px solid #93c5fd; outline-offset: 1px; }
    .bar button[disabled] { opacity: .5; cursor: default; }
    .bar .status { padding: 6px 4px; opacity: .8; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;
      background: rgba(17,24,39,.92); color: #fff; font: 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); pointer-events: none; max-width: 80vw; }
  `;
  const root = document.createElement("div"); root.className = "root";
  const bar = document.createElement("div"); bar.className = "bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Gytakusub");
  const btnTranslate = document.createElement("button"); btnTranslate.setAttribute("aria-label", "Translate this image");
  const btnToggle = document.createElement("button"); btnToggle.setAttribute("aria-label", "Show or hide translation");
  const status = document.createElement("span"); status.className = "status";
  bar.append(btnTranslate, btnToggle, status);
  const toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite"); toastEl.hidden = true;
  shadow.append(style, root, bar, toastEl);

  const mount = () => { if (document.documentElement && !host.isConnected) document.documentElement.append(host); };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });

  let toastTimer = null;
  function toast(msg, ms = 3500) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  }

  // ---------- settings ----------

  async function loadSettings() {
    try {
      const s = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
      if (s && !s.error) settings = s;
    } catch { /* background not ready yet */ }
    applyAutoMode();
    if (!settings.enabled) { bar.classList.remove("visible"); hoverImg = null; }
  }
  chrome.storage.onChanged.addListener(() => loadSettings());

  const hostname = location.hostname;
  const siteExcluded = () => settings.excludedSites.split(/[\s,]+/).filter(Boolean).some((p) => hostname === p || hostname.endsWith("." + p));
  const active = () => settings.enabled && !siteExcluded();
  const autoOn = () => active() && (settings.autoSites || []).includes(hostname);

  // ---------- image discovery ----------

  const srcOf = (img) => img.currentSrc || img.src || "";

  function isEligible(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    const r = img.getBoundingClientRect();
    const bigNatural = img.naturalWidth >= MIN_W && img.naturalHeight >= MIN_H;
    const bigRendered = r.width >= MIN_W && r.height >= MIN_H;
    return (bigNatural || bigRendered) && !!srcOf(img);
  }

  function viewportDistance(img) {
    const r = img.getBoundingClientRect();
    return Math.abs(r.top + r.height / 2 - window.innerHeight / 2);
  }

  function visibleImages(marginFactor = 0.5) {
    const vh = window.innerHeight, vw = window.innerWidth;
    const out = [];
    for (const img of document.images) {
      if (!isEligible(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.bottom < -vh * marginFactor || r.top > vh * (1 + marginFactor)) continue;
      if (r.right < 0 || r.left > vw) continue;
      out.push(img);
    }
    return out;
  }

  // ---------- hover bar ----------

  let hideTimer = null;
  function showBar(img) {
    hoverImg = img;
    refreshBar();
    bar.classList.add("visible");
    positionBar();
    clearTimeout(hideTimer);
  }
  function positionBar() {
    if (!hoverImg) return;
    const r = hoverImg.getBoundingClientRect();
    bar.style.left = Math.max(4, Math.min(window.innerWidth - bar.offsetWidth - 4, r.right - bar.offsetWidth - 8)) + "px";
    bar.style.top = Math.max(4, r.top + 8) + "px";
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { bar.classList.remove("visible"); hoverImg = null; }, 350);
  }
  function refreshBar() {
    const e = hoverImg ? entries.get(hoverImg) : null;
    const st = e?.status;
    btnTranslate.textContent = st === "working" ? "Translating…" : st === "queued" ? "Queued…" : st === "done" ? "↻ Redo" : "Translate";
    btnTranslate.disabled = st === "working" || st === "queued";
    btnToggle.style.display = st === "done" ? "" : "none";
    btnToggle.textContent = e?.hidden || allHidden ? "Show" : "Hide";
    status.textContent = e?.error ? "⚠ " + e.error : st === "done" && e.result ? `${e.result.items.length} lines` : "";
    status.style.display = status.textContent ? "" : "none";
  }

  document.addEventListener("mouseover", (ev) => {
    if (!ev.isTrusted) return;
    const t = ev.target;
    if (t === host) { clearTimeout(hideTimer); return; }
    if (active() && isEligible(t)) showBar(t);
    else if (hoverImg) scheduleHide();
  }, true);
  bar.addEventListener("mouseleave", scheduleHide);

  // Only real user clicks may spend tokens (a page script can't synthesize isTrusted).
  btnTranslate.addEventListener("click", (ev) => { if (ev.isTrusted && hoverImg) enqueue(hoverImg, entries.get(hoverImg)?.status === "done"); });
  btnToggle.addEventListener("click", (ev) => {
    if (!ev.isTrusted || !hoverImg) return;
    const e = entries.get(hoverImg);
    if (e) { e.hidden = !e.hidden; refreshBar(); layout(); }
  });

  // ---------- queue (nearest-to-viewport first, limited parallelism) ----------

  const queue = [];
  let running = 0;

  function enqueue(img, force = false) {
    if (!active()) { toast("Gytakusub is off on this site"); return; }
    const e = entries.get(img);
    if (e && (e.status === "working" || e.status === "queued")) return;
    entries.set(img, { ...(e || { hidden: false }), status: "queued", src: srcOf(img), error: undefined });
    queue.push({ img, force });
    refreshBar();
    pump();
  }

  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      queue.sort((a, b) => viewportDistance(a.img) - viewportDistance(b.img));
      const job = queue.shift();
      if (!job.img.isConnected) { entries.delete(job.img); continue; }
      running++;
      translateImage(job.img, job.force).finally(() => { running--; pump(); });
    }
  }

  // ---------- translation ----------

  // Bundled lettering font (fonts/ComicNeue-Bold.ttf, declared web-accessible).
  // Loaded once per page; render waits for it so the first page isn't typeset
  // in a fallback face. Failure is non-fatal: the fallback stack is used.
  let fontReady = null;
  function ensureFont() {
    if (fontReady) return fontReady;
    fontReady = (async () => {
      if (typeof FontFace === "undefined" || !document.fonts) return false;
      try {
        const face = new FontFace("Gytakusub Comic", `url(${chrome.runtime.getURL("fonts/ComicNeue-Bold.ttf")})`, { weight: "700", style: "normal" });
        await face.load();
        document.fonts.add(face);
        return true;
      } catch (e) { console.warn("Gytakusub: bundled font unavailable, using fallback", e); return false; }
    })();
    return fontReady;
  }

  const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  const loadImage = (dataUrl) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Could not decode image")); im.src = dataUrl; });

  async function translateImage(img, force = false) {
    const entry = entries.get(img) || { status: "idle", hidden: false };
    entry.status = "working"; entry.error = undefined; entry.src = srcOf(img);
    entries.set(img, entry);
    refreshBar();
    try {
      const src = entry.src;
      const msg = { type: "TRANSLATE", force };
      if (/^(blob|data):/i.test(src)) {
        const blob = await (await fetch(src)).blob(); // only the page can read its own blob: URLs
        msg.dataUrl = await blobToDataUrl(blob);
      } else {
        msg.url = src;
      }
      const res = await chrome.runtime.sendMessage(msg);
      if (!res) throw new Error("No response from background worker");
      if (res.error) throw new Error(res.error);
      if (srcOf(img) !== src) { entries.delete(img); return; } // image changed while we worked
      entry.result = res;
      await render(img, entry);
      entry.status = "done";
      watchLayout();
    } catch (e) {
      entry.status = "error";
      entry.error = e.message || String(e);
      toast("Gytakusub: " + entry.error, 6000);
      console.warn("Gytakusub", e);
    }
    refreshBar();
  }

  async function render(img, entry) {
    await ensureFont();
    const src = await loadImage(entry.result.imageDataUrl);
    const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(src.naturalWidth, src.naturalHeight));
    const W = Math.max(1, Math.round(src.naturalWidth * scale));
    const H = Math.max(1, Math.round(src.naturalHeight * scale));

    const work = document.createElement("canvas");
    work.width = W; work.height = H;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    wctx.drawImage(src, 0, 0, W, H);
    const pixels = wctx.getImageData(0, 0, W, H);

    const canvas = entry.canvas || document.createElement("canvas");
    canvas.className = "overlay";
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    G.typeset(ctx, pixels, entry.result, W, H, { fontFamily: settings.fontFamily, uppercase: settings.uppercase, debug: !!settings.debugOverlay });
    if (settings.debugOverlay) console.info("Gytakusub debug", { src: entry.src, W, H, natural: [src.naturalWidth, src.naturalHeight], items: entry.result.items, bubbles: entry.result.bubbles.map((b) => ({ id: b.id, box: b.box })) });

    if (!entry.canvas) { entry.canvas = canvas; root.append(canvas); }
    entry.objectFit = getComputedStyle(img).objectFit;
    layout();
  }

  // ---------- overlay positioning (event-driven, not a permanent rAF loop) ----------

  function contentRect(img, objectFit) {
    const r = img.getBoundingClientRect();
    if ((objectFit === "contain" || objectFit === "scale-down") && img.naturalWidth && img.naturalHeight) {
      const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
    }
    return r;
  }

  function layout() {
    for (const [img, e] of entries) {
      if (!e.canvas) continue;
      if (img.isConnected && srcOf(img) !== e.src) { // reader swapped this <img> to another page
        e.canvas.remove();
        entries.delete(img);
        if (io) { io.unobserve(img); io.observe(img); }
        continue;
      }
      const r = img.isConnected ? contentRect(img, e.objectFit) : null;
      const show = r && r.width > 0 && r.height > 0 && !e.hidden && !allHidden;
      e.canvas.style.display = show ? "block" : "none";
      if (!show) continue;
      e.canvas.style.left = r.left + "px";
      e.canvas.style.top = r.top + "px";
      e.canvas.style.width = r.width + "px";
      e.canvas.style.height = r.height + "px";
    }
    if (hoverImg && bar.classList.contains("visible")) positionBar();
  }

  let rafPending = false, activeUntil = 0, watching = false, idleTimer = null;
  function scheduleLayout() {
    activeUntil = performance.now() + 400; // keep following for a moment after the last event (smooth scrolling)
    if (rafPending) return;
    rafPending = true;
    const tick = (now) => {
      layout();
      if (now < activeUntil) requestAnimationFrame(tick); else rafPending = false;
    };
    requestAnimationFrame(tick);
  }
  function watchLayout() {
    if (watching) return;
    watching = true;
    window.addEventListener("scroll", scheduleLayout, { capture: true, passive: true });
    window.addEventListener("resize", scheduleLayout, { passive: true });
    idleTimer = setInterval(layout, 500); // catches layout changes that fire no event (lazy loads, SPA reflows)
    scheduleLayout();
  }

  // ---------- bulk / auto ----------

  function translateVisible() {
    if (!active()) { toast("Gytakusub is off on this site"); return; }
    const imgs = visibleImages().filter((i) => !["done", "working", "queued"].includes(entries.get(i)?.status));
    if (!imgs.length) { toast("No untranslated images on screen"); return; }
    toast(`Translating ${imgs.length} image${imgs.length > 1 ? "s" : ""}…`);
    for (const img of imgs) enqueue(img);
  }

  let io = null, mo = null;
  function applyAutoMode() {
    const on = autoOn();
    if (on && !io) {
      io = new IntersectionObserver((recs) => {
        for (const r of recs) {
          if (!r.isIntersecting || !isEligible(r.target)) continue;
          const e = entries.get(r.target);
          if (!e || (e.status === "done" && srcOf(r.target) !== e.src) || e.status === "error") enqueue(r.target);
        }
      }, { rootMargin: "200% 0px" });
      const observeAll = () => { for (const img of document.images) if (isEligible(img)) io.observe(img); };
      observeAll();
      mo = new MutationObserver(observeAll);
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
      document.addEventListener("load", onImgLoad, true);
    } else if (!on && io) {
      io.disconnect(); io = null;
      mo?.disconnect(); mo = null;
      document.removeEventListener("load", onImgLoad, true);
    }
  }
  function onImgLoad(ev) { if (io && isEligible(ev.target)) io.observe(ev.target); }

  // ---------- messages from background / popup ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "PING": sendResponse({ ok: true }); break;
      case "TRANSLATE_VISIBLE": translateVisible(); sendResponse({ ok: true }); break;
      case "TOGGLE_OVERLAYS": allHidden = !allHidden; layout(); refreshBar(); sendResponse({ hidden: allHidden }); break;
      case "GET_STATE": {
        let done = 0, working = 0;
        for (const e of entries.values()) { if (e.status === "done") done++; if (e.status === "working" || e.status === "queued") working++; }
        sendResponse({ done, working, hidden: allHidden, host: hostname, autoOn: autoOn(), excluded: siteExcluded() });
        break;
      }
      default: return false;
    }
    return false;
  });

  loadSettings();
})();
