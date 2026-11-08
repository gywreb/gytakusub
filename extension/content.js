// Gytakusub – content script. Runs on every page.
// Finds large images (manga pages), offers a hover button, asks the background
// worker for a translation, then paints an overlay canvas: bubble interiors are
// re-filled in their own colour and the translation is typeset inside them.

(function () {
  "use strict";
  if (window.__gytLoaded) return;
  window.__gytLoaded = true;

  const G = globalThis.GyT;
  const MIN_W = 280, MIN_H = 280; // px, natural or rendered
  const MAX_CANVAS_EDGE = 2500;
  const MAX_PARALLEL = 3;

  /** @type {Map<HTMLImageElement, {status:string, src:string, canvas?:HTMLCanvasElement, hidden:boolean, result?:any, error?:string, objectFit?:string}>} */
  const entries = new Map();
  let settings = { enabled: true, autoSites: [], uppercase: false, fontFamily: "", excludedSites: "" };
  let allHidden = false;
  let hoverImg = null;

  // ---------- DOM scaffolding ----------

  const root = document.createElement("div");
  root.id = "gyt-root";
  const bar = document.createElement("div");
  bar.id = "gyt-bar";
  const btnTranslate = document.createElement("button");
  const btnToggle = document.createElement("button");
  const status = document.createElement("span");
  status.className = "gyt-status";
  bar.append(btnTranslate, btnToggle, status);

  function mount() {
    if (!document.documentElement) return;
    document.documentElement.append(root, bar);
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });

  let toastTimer = null;
  function toast(msg, ms = 3500) {
    let t = document.getElementById("gyt-toast");
    if (!t) { t = document.createElement("div"); t.id = "gyt-toast"; document.documentElement.append(t); }
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.style.display = "none"), ms);
  }

  // ---------- settings ----------

  async function loadSettings() {
    try {
      const s = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
      if (s && !s.error) settings = s;
    } catch { /* background not ready yet */ }
    applyAutoMode();
    if (!settings.enabled) { bar.classList.remove("gyt-visible"); hoverImg = null; }
  }
  chrome.storage.onChanged.addListener(() => loadSettings());

  const host = location.hostname;
  function siteExcluded() {
    return settings.excludedSites.split(/[\s,]+/).filter(Boolean).some((p) => host === p || host.endsWith("." + p));
  }
  function active() { return settings.enabled && !siteExcluded(); }
  function autoOn() { return active() && (settings.autoSites || []).includes(host); }

  // ---------- image discovery ----------

  const srcOf = (img) => img.currentSrc || img.src || "";

  function isEligible(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (img.closest("#gyt-root, #gyt-bar")) return false;
    const r = img.getBoundingClientRect();
    const bigNatural = img.naturalWidth >= MIN_W && img.naturalHeight >= MIN_H;
    const bigRendered = r.width >= MIN_W && r.height >= MIN_H;
    return (bigNatural || bigRendered) && !!srcOf(img);
  }

  function viewportDistance(img) {
    const r = img.getBoundingClientRect();
    const cy = r.top + r.height / 2, vc = window.innerHeight / 2;
    return Math.abs(cy - vc);
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
    bar.classList.add("gyt-visible");
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
    hideTimer = setTimeout(() => { bar.classList.remove("gyt-visible"); hoverImg = null; }, 350);
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
    const t = ev.target;
    if (t === bar || bar.contains(t)) { clearTimeout(hideTimer); return; }
    if (active() && isEligible(t)) showBar(t);
    else if (hoverImg) scheduleHide();
  }, true);
  bar.addEventListener("mouseleave", scheduleHide);

  btnTranslate.addEventListener("click", () => { if (hoverImg) enqueue(hoverImg, entries.get(hoverImg)?.status === "done"); });
  btnToggle.addEventListener("click", () => {
    if (!hoverImg) return;
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

  function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  }

  async function translateImage(img, force = false) {
    const entry = entries.get(img) || { status: "idle", hidden: false };
    entry.status = "working"; entry.error = undefined; entry.src = srcOf(img);
    entries.set(img, entry);
    refreshBar();

    try {
      const src = entry.src;
      const msg = { type: "TRANSLATE", force };
      if (/^(blob|data):/i.test(src)) {
        // Only the page can read its own blob: URLs; hand the bytes over.
        const blob = await (await fetch(src)).blob();
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
      ensureLoop();
    } catch (e) {
      entry.status = "error";
      entry.error = e.message || String(e);
      toast("Gytakusub: " + entry.error, 6000);
      console.warn("Gytakusub", e);
    }
    refreshBar();
  }

  function loadImage(dataUrl) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Could not decode image")); im.src = dataUrl; });
  }

  async function render(img, entry) {
    const src = await loadImage(entry.result.imageDataUrl);
    const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(src.naturalWidth, src.naturalHeight));
    const W = Math.max(1, Math.round(src.naturalWidth * scale));
    const H = Math.max(1, Math.round(src.naturalHeight * scale));

    // Work canvas: pixel access for bubble refinement and lettering-size estimates.
    const work = document.createElement("canvas");
    work.width = W; work.height = H;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    wctx.drawImage(src, 0, 0, W, H);
    const pixels = wctx.getImageData(0, 0, W, H);

    // Overlay canvas: transparent, only bubbles get painted.
    const canvas = entry.canvas || document.createElement("canvas");
    canvas.className = "gyt-overlay";
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    G.typeset(ctx, pixels, entry.result, W, H, { fontFamily: settings.fontFamily, uppercase: settings.uppercase });

    if (!entry.canvas) { entry.canvas = canvas; root.append(canvas); }
    entry.objectFit = getComputedStyle(img).objectFit;
    layout();
  }

  // ---------- overlay positioning ----------

  // Where the image's pixels actually are inside its box (object-fit aware).
  function contentRect(img, objectFit) {
    const r = img.getBoundingClientRect();
    if ((objectFit === "contain" || objectFit === "scale-down") && img.naturalWidth && img.naturalHeight) {
      const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
    }
    return r;
  }

  let loopRunning = false;
  function layout() {
    for (const [img, e] of entries) {
      if (!e.canvas) continue;
      // The reader swapped this <img> to another page: drop the stale overlay.
      if (img.isConnected && srcOf(img) !== e.src) {
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
    if (hoverImg && bar.classList.contains("gyt-visible")) positionBar();
  }
  function ensureLoop() {
    if (loopRunning) return;
    loopRunning = true;
    const tick = () => { layout(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  // ---------- bulk / auto ----------

  function translateVisible() {
    if (!active()) { toast("Gytakusub is off on this site"); return; }
    const imgs = visibleImages().filter((i) => !["done", "working", "queued"].includes(entries.get(i)?.status));
    if (!imgs.length) { toast("No untranslated images on screen"); return; }
    toast(`Translating ${imgs.length} image${imgs.length > 1 ? "s" : ""}…`);
    for (const img of imgs) enqueue(img);
  }

  let io = null;
  let mo = null;
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
      mo = new MutationObserver(() => observeAll());
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
      case "TRANSLATE_VISIBLE": translateVisible(); sendResponse({ ok: true }); break;
      case "TOGGLE_OVERLAYS": allHidden = !allHidden; layout(); refreshBar(); sendResponse({ hidden: allHidden }); break;
      case "GET_STATE": {
        let done = 0, working = 0;
        for (const e of entries.values()) { if (e.status === "done") done++; if (e.status === "working" || e.status === "queued") working++; }
        sendResponse({ done, working, hidden: allHidden, host, autoOn: autoOn(), excluded: siteExcluded() });
        break;
      }
      default: return false;
    }
    return false;
  });

  loadSettings();
})();
