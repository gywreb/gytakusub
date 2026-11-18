// Gytakusub – content script. Injected only on sites the user enabled (or on
// demand from the popup / hotkey). Finds large images (manga pages), offers a
// hover button, asks the background worker for a translation, then paints an
// overlay canvas via the shared typesetting engine.

(() => {
  "use strict";
  if (window.__gytLoaded) return;
  window.__gytLoaded = true;

  const GyText = globalThis.GyText;
  const MIN_W = 280, MIN_H = 280; // px, natural or rendered
  const MAX_PARALLEL = 3;

  /** @type {Map<HTMLImageElement, {status:string, src:string, canvas?:HTMLCanvasElement, hidden:boolean, result?:any, error?:string, objectFit?:string}>} */
  const entries = new Map();
  // This page's own name for its work in the worker, and a line to it: when the page goes (a reload,
  // the next chapter) the line drops, and the worker drops this page's pages not yet sent to Claude
  // instead of translating them for nobody (and making the next page wait behind them).
  const pageToken = (crypto.randomUUID?.() || String(Math.random()).slice(2));
  let line = null;
  const keepLine = () => {
    if (line) return;
    try { line = chrome.runtime.connect({ name: "gyt-page:" + pageToken }); line.onDisconnect.addListener(() => { line = null; }); }
    catch { line = null; } // the extension was reloaded: this script is an orphan, nothing to keep
  };
  let settings = { enabled: true, autoSites: [], enabledSites: [], uppercase: false, fontFamily: "", excludedSites: "", peekOnHover: false };
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
    .editor { position: fixed; z-index: 1; width: 300px; max-width: calc(100vw - 16px); padding: 10px; border-radius: 10px; background: rgba(17,24,39,.96);
      color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.45); font: 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; pointer-events: auto; }
    .editor textarea, .editor input { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,.1);
      color: #fff; font: 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; white-space: pre-wrap; }
    .editor textarea { min-height: 64px; resize: vertical; }
    .editor textarea:focus, .editor input:focus { outline: 2px solid #93c5fd; }
    .editor .row { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
    .editor .row.gloss input { flex: 1; min-width: 0; }
    .editor .label { opacity: .75; font-size: 12px; margin-top: 10px; }
    .editor button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,.1); color: #fff; font: 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; white-space: nowrap; }
    .editor button.primary { background: #2563eb; }
    .editor button:hover, .editor button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }
    .editor .hint { opacity: .6; font-size: 11px; margin-left: auto; }
    .readable { position: fixed; z-index: 1; max-width: min(320px, calc(100vw - 16px)); padding: 8px 11px; border-radius: 8px; background: rgba(17,24,39,.94);
      color: #fff; font: 15px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; white-space: pre-wrap; box-shadow: 0 4px 16px rgba(0,0,0,.4); pointer-events: none; }
    .readable[hidden] { display: none; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;
      background: rgba(17,24,39,.92); color: #fff; font: 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); pointer-events: none; max-width: 80vw; }
    .pause { bottom: 64px; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 14px; pointer-events: auto; }
    .pause[hidden] { display: none; }
    .pause button { flex: none; padding: 6px 14px; border: 0; border-radius: 6px; background: #fff; color: #111827; font: 600 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; cursor: pointer; }
    .pause button:focus-visible { outline: 2px solid #7cb3ff; outline-offset: 2px; }
  `;
  const root = document.createElement("div"); root.className = "root";
  // The words on the page come from the worker with the settings (GET_SETTINGS: settings.ui, the
  // content_* messages in the reader's language, English underneath); this script can't read the
  // extension's files from inside someone else's page.
  const T = (key, vars = {}) => String(settings.ui?.[key] ?? key).replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all));
  const TN = (key, n, vars = {}) => {
    let rule = "other";
    try { rule = new Intl.PluralRules(settings.uiLang || "en").select(n); } catch { /* "other" */ }
    return T(settings.ui?.[`${key}_${rule}`] != null ? `${key}_${rule}` : `${key}_other`, { n: n.toLocaleString(settings.uiLang || "en"), ...vars });
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const bar = document.createElement("div"); bar.className = "bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Gytakusub");
  const btnTranslate = document.createElement("button");
  const btnToggle = document.createElement("button");
  const btnReport = document.createElement("button");
  const status = document.createElement("span"); status.className = "status";
  bar.append(btnTranslate, btnToggle, btnReport, status);
  const toastEl = document.createElement("div"); toastEl.className = "toast"; toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite"); toastEl.hidden = true;
  const pauseEl = document.createElement("div"); pauseEl.className = "toast pause"; pauseEl.setAttribute("role", "alert"); pauseEl.hidden = true;
  const pauseText = document.createElement("span");
  const pauseBtn = document.createElement("button"); pauseBtn.type = "button";
  pauseEl.append(pauseText, pauseBtn);
  shadow.append(style, root, bar, toastEl, pauseEl);
  /** Labels that don't change with a page's state, in the reader's language (called when settings arrive). */
  function labelControls() {
    btnTranslate.setAttribute("aria-label", T("content_translate_image"));
    btnToggle.setAttribute("aria-label", T("content_toggle_image"));
    btnReport.textContent = T("content_report"); btnReport.title = T("content_report_title"); btnReport.setAttribute("aria-label", T("content_report_aria"));
    pauseBtn.textContent = T("content_continue");
    if (!pauseEl.hidden) pauseText.textContent = TN("content_paused", AUTO_BUDGET);
    editor.el?.remove(); editor.el = null; editor.open = false; // rebuilt in the new language when next opened
  }

  const mount = () => { if (document.documentElement && !host.isConnected) document.documentElement.append(host); };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });

  let toastTimer = null, lastToast = { msg: "", at: 0 };
  /** `once`: the same message is not repeated within a minute (auto-translate retrying a stubborn image). */
  function toast(msg, ms = 3500, once = false) {
    if (once && msg === lastToast.msg && Date.now() - lastToast.at < 60000) return;
    lastToast = { msg, at: Date.now() };
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  }

  // ---------- settings ----------

  // Nothing shows and nothing starts until the worker has answered with the settings and the words:
  // a worker that is starting, or busy finishing another page's work, may answer late or not at
  // all — then the page asks again (0.5 s, 1, 2, 4, 8, then every 10 s) instead of running on
  // defaults (no words: raw message keys on the buttons; no sites: auto-translate off until a reload).
  let ready = false, retry = null, tries = 0;
  let readyWaiters = [];
  const whenReady = () => (ready ? Promise.resolve() : new Promise((r) => readyWaiters.push(r)));
  async function loadSettings() {
    clearTimeout(retry);
    let s = null;
    try { s = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }); } catch { /* the worker is starting or was stopped */ }
    if (!s || s.error || !s.ui?.content_btn_translate) {
      retry = setTimeout(loadSettings, tries < 5 ? 500 * 2 ** tries : 10000);
      tries++;
      return;
    }
    settings = s; tries = 0;
    if (!ready) { ready = true; readyWaiters.forEach((r) => r()); readyWaiters = []; }
    labelControls();
    ensureHyphenation(); // the target language may have changed
    applyAutoMode();
    if (!settings.enabled) { bar.classList.remove("visible"); hoverImg = null; }
  }
  // the worker says when settings change (this script can't read extension storage itself, see background.js)

  const hostname = location.hostname;
  const siteExcluded = () => settings.excludedSites.split(/[\s,]+/).filter(Boolean).some((p) => hostname === p || hostname.endsWith("." + p));
  const active = () => ready && settings.enabled && !siteExcluded();
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
    btnTranslate.textContent = st === "working" ? T("content_btn_translating") : st === "queued" ? T("content_btn_queued") : st === "done" ? T("content_btn_redo") : T("content_btn_translate");
    btnTranslate.disabled = st === "working" || st === "queued";
    btnToggle.style.display = st === "done" ? "" : "none";
    btnToggle.textContent = e?.hidden || allHidden ? T("content_btn_show") : T("content_btn_hide");
    btnReport.style.display = st === "done" && settings.debugOverlay ? "" : "none";
    status.textContent = e?.error ? "⚠ " + e.error : st === "done" && e.result ? TN("content_lines", e.result.items.length) : "";
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

  btnReport.addEventListener("click", (ev) => { if (ev.isTrusted && hoverImg) report(hoverImg); });

  // Diagnostic report: everything needed to reproduce a placement problem in the
  // test harness (tests/replay-report.mjs) — one .zip with the original image,
  // the debug render and the JSON per page.
  function buildReport(img, e) {
    const res = e.result;
    return {
      gytakusub: chrome.runtime.getManifest().version, when: new Date().toISOString(), page: location.href, image: e.src,
      natural: [img.naturalWidth, img.naturalHeight], displayed: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)], objectFit: e.objectFit,
      work: res.work, letter: res.letter, fromCache: res.fromCache, timing: res.timing, engine: res.engine,
      // how the overlay was drawn: the screen's pixel ratio, its pixels, and each line's size on screen (CSS px)
      overlay: { dpr: window.devicePixelRatio || 1, backing: [e.canvas?.width || 0, e.canvas?.height || 0],
        // where the overlay sits on screen and where the image's picture is (CSS px): they must match
        rect: e.canvas ? ["left", "top", "width", "height"].map((k) => +parseFloat(e.canvas.style[k] || "0").toFixed(2)) : null,
        image: (() => { const r = contentRect(img, e.objectFit); return [r.left, r.top, r.width, r.height].map((v) => +v.toFixed(2)); })(),
        lineSizes: (e.sizes || []).map((v) => +(v * img.getBoundingClientRect().width / res.work.W).toFixed(1)) },
      settings: { model: settings.model, targetLang: settings.targetLang, fontFamily: settings.fontFamily, uppercase: settings.uppercase, useContext: settings.useContext },
      // how the page was lettered: the font chosen for its translations, and the language's rules
      lettering: { ...settings.lettering, hyphenation: !!hyphenation.fn, family: GyText.lettering(res.placements.map((p) => p.text), lettering(res)).family },
      regions: res.regions, items: res.items, placements: res.placements,
    };
  }
  // Export: one .zip with, per translated page, the original image, the debug
  // render (clean page + boxes + text) and the report JSON — nothing to capture by hand.
  async function exportReport(imgs) {
    const done = imgs.filter((i) => entries.get(i)?.status === "done" && entries.get(i).result);
    if (!done.length) { toast(T("content_nothing_translated")); return { ok: false }; }
    toast(TN("content_preparing_report", done.length), 20000);
    const files = [];
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const summary = { gytakusub: chrome.runtime.getManifest().version, when: new Date().toISOString(), page: location.href, userAgent: navigator.userAgent, pages: [] };
    let n = 0;
    for (const img of done.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)) {
      const e = entries.get(img), id = String(++n).padStart(2, "0"), res = e.result;
      const rep = buildReport(img, e);
      files.push({ name: `page-${id}.json`, data: new TextEncoder().encode(JSON.stringify(rep, null, 1)) });
      // debug render: the whole cleaned page (from the worker, cached answer, no model call) + boxes + text
      try {
        const msg = /^(blob|data):/i.test(e.src) ? { dataUrl: await blobToDataUrl(await (await fetch(e.src)).blob()) } : { url: e.src };
        const full = await chrome.runtime.sendMessage({ type: "TRANSLATE", wantClean: true, ...msg });
        if (full?.cleanDataUrl) {
          const clean = await loadImage(full.cleanDataUrl);
          const c = document.createElement("canvas"); c.width = res.work.W; c.height = res.work.H;
          const ctx = c.getContext("2d");
          ctx.drawImage(clean, 0, 0, res.work.W, res.work.H); drawDebug(ctx, res);
          await Promise.all([ensureFont(), ensureHyphenation()]);
          GyText.draw(ctx, res.placements, lettering(res));
          const png = await new Promise((r) => c.toBlob(r, "image/png"));
          files.push({ name: `page-${id}.debug.png`, data: new Uint8Array(await png.arrayBuffer()) });
        }
      } catch (err) { rep.debugRenderError = String(err?.message || err); }
      // original bytes, through the background (page CORS does not apply there)
      try {
        const msg = /^(blob|data):/i.test(e.src) ? { dataUrl: await blobToDataUrl(await (await fetch(e.src)).blob()) } : { url: e.src };
        const r = await chrome.runtime.sendMessage({ type: "FETCH_IMAGE", ...msg });
        if (r?.dataUrl) {
          const [head, b64] = r.dataUrl.split(","); const ext = /png/.test(head) ? "png" : /webp/.test(head) ? "webp" : /gif/.test(head) ? "gif" : "jpg";
          const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          files.push({ name: `page-${id}.original.${ext}`, data: bytes });
        }
      } catch (err) { rep.originalError = String(err?.message || err); }
      summary.pages.push({ id, image: e.src, items: res.items.length, regions: res.regions.length });
    }
    // images that failed on this tab (e.g. a site refusing the download): the URL and the error, so the failure is reproducible
    summary.failed = imgs.filter((i) => entries.get(i)?.status === "error").map((i) => ({ image: srcOf(i), size: [i.naturalWidth, i.naturalHeight], error: entries.get(i).error }));
    files.unshift({ name: "summary.json", data: new TextEncoder().encode(JSON.stringify(summary, null, 1)) });
    const zip = makeZip(files);
    const url = URL.createObjectURL(new Blob([zip], { type: "application/zip" }));
    // clicked without being put in the page: a page script watching the DOM could otherwise read the zip
    const a = document.createElement("a"); a.href = url; a.download = `gytakusub-report-${location.hostname}-${stamp}.zip`; a.rel = "noopener";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(TN("content_report_done", done.length, { size: (zip.length / 1e6).toFixed(1) }), 9000);
    return { ok: true, pages: done.length, bytes: zip.length, files: files.map((f) => f.name) };
  }
  function report(img) { return exportReport([img]); }

  // Minimal ZIP writer (store, no compression): local headers + central directory.
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name]);
      parts.push(local, f.data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
      offset += local.length + size;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const out = new Uint8Array(offset + cdSize + end.length);
    let p = 0; for (const c of [...parts, ...central, end]) { out.set(c, p); p += c.length; }
    return out;
  }

  // ---------- queue: the page you're looking at first ----------
  // Pages wait here and run MAX_PARALLEL at a time, nearest to the middle of the screen
  // first; a page on screen starts even when every slot is busy. Auto-translate starts
  // pages only once scrolling has settled: a page flashing past while you fling is not
  // one you're looking at, and starting it would hold a slot. The worker analyses one
  // page at a time in the same order, from the distances reported below while you scroll.
  // A page auto-translate picked up is put back when you scroll far past it before Claude
  // was asked; auto-translate picks it up again when you come back. So the page you stop
  // at doesn't wait behind pages you skipped, and skipped pages cost no tokens. Pages you
  // asked for yourself (Translate visible, the button on an image) are never put back.

  const queue = [];
  const running = new Map(); // job id → job
  let nextJobId = 1, lastScroll = 0;
  const SETTLE_MS = 250;

  /** On screen or within auto-translate's look-ahead (the IntersectionObserver's 200% margin). */
  function nearScreen(img, screens = 2) {
    const r = img.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
    return r.bottom >= -vh * screens && r.top <= vh * (1 + screens) && r.right >= 0 && r.left <= vw;
  }
  const onScreen = (img) => nearScreen(img, 0);
  // a hidden tab's pages wait for the visible tab's
  const priorityOf = (img) => viewportDistance(img) + (document.hidden ? 1e7 : 0);

  function enqueue(img, force = false, auto = false) {
    if (!active()) { toast(T("content_off_here")); return; }
    const e = entries.get(img);
    if (e?.status === "working") return;
    if (e?.status === "queued") { // asking for a page auto-translate is holding makes it yours: it isn't put back or paused
      const job = queue.find((j) => j.img === img);
      if (job && job.auto && !auto) { job.auto = false; job.force ||= force; pump(); }
      return;
    }
    entries.set(img, { ...(e || { hidden: false }), status: "queued", src: srcOf(img), error: undefined, failures: e && e.src === srcOf(img) ? e.failures : 0 });
    queue.push({ id: nextJobId++, img, force, auto });
    refreshBar();
    pump();
  }

  /** A page that was waiting or cancelled goes back to untranslated, keeping its overlay settings. */
  function putBack(img) {
    const e = entries.get(img);
    if (!e) return;
    if (!e.result && !e.canvas && !e.hidden) entries.delete(img); else e.status = "idle";
    scheduleReconcile();
  }

  // Auto-translate is a state, not an event: every page near the screen that isn't translated,
  // in progress or waiting should be waiting. The IntersectionObserver below only says when a
  // page *enters* that zone, so a page put back while already inside it (cancelled because you
  // scrolled far away, the cancellation landing after you came back) got no second event and
  // sat untranslated until you pressed Translate (before 2.11.1). So once scrolling settles,
  // after each page finishes and after a page is put back, the pages near the screen are
  // checked again. Pages that failed keep their rule (tried again when you come back to them).
  let reconcileTimer = null;
  function scheduleReconcile(delay = SETTLE_MS + 20) {
    if (!io) return;
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => {
      const since = performance.now() - lastScroll;
      if (since < SETTLE_MS) { scheduleReconcile(SETTLE_MS - since + 20); return; }
      reconcileAuto();
    }, delay);
  }
  function reconcileAuto() {
    if (!io || !autoOn()) return;
    for (const img of document.images) {
      if (!isEligible(img) || !nearScreen(img)) continue;
      const e = entries.get(img);
      if (!e || e.status === "idle" || (e.status === "done" && srcOf(img) !== e.src)) enqueue(img, false, true);
    }
  }

  // A spending guard: on a site you auto-translate, page scripts (ads included) can add or swap
  // images, and every new image is a Claude request. After AUTO_BUDGET auto-translated pages that
  // Claude answered (not cached, not put back) in AUTO_WINDOW_MS on this tab, auto-translate waits
  // for a real click on Continue. Pages you ask for yourself are never held. Up to MAX_PARALLEL - 1
  // pages already in progress may still finish past it. Reading a long chapter rarely gets near it.
  const AUTO_BUDGET = 100, AUTO_WINDOW_MS = 10 * 60 * 1000;
  let autoSpent = [], autoPaused = false;
  function autoBudgetLeft() {
    const now = performance.now();
    autoSpent = autoSpent.filter((t) => now - t < AUTO_WINDOW_MS);
    return AUTO_BUDGET - autoSpent.length;
  }
  function pauseAuto() {
    autoPaused = true;
    pauseText.textContent = TN("content_paused", AUTO_BUDGET);
    pauseEl.hidden = false;
  }
  pauseBtn.addEventListener("click", (ev) => {
    if (!ev.isTrusted) return; // only you can let it go on, not a script on the page
    autoPaused = false; autoSpent = []; pauseEl.hidden = true;
    pump();
  });

  function pump() {
    for (let i = queue.length - 1; i >= 0; i--) {
      const job = queue[i];
      if (!job.img.isConnected) { queue.splice(i, 1); entries.delete(job.img); }
      else if (job.auto && !nearScreen(job.img)) { queue.splice(i, 1); putBack(job.img); }
    }
    queue.sort((a, b) => priorityOf(a.img) - priorityOf(b.img));
    const sinceScroll = performance.now() - lastScroll, settled = sinceScroll >= SETTLE_MS;
    let waitsForSettle = false;
    for (let i = 0; i < queue.length;) {
      const job = queue[i];
      const room = running.size < MAX_PARALLEL || onScreen(job.img);
      if (room && job.auto && !settled) waitsForSettle = true;
      if (!room || (job.auto && !settled)) { i++; continue; }
      if (job.auto && (autoPaused || autoBudgetLeft() <= 0)) { if (!autoPaused) pauseAuto(); i++; continue; }
      queue.splice(i, 1);
      running.set(job.id, job);
      translateImage(job).finally(() => { running.delete(job.id); pump(); scheduleReconcile(); });
    }
    // An auto page queued just after a scroll (Chrome fires one while a page loads) waits for
    // the scroll to settle; without another scroll nothing would call pump again, and the
    // first screen of a chapter stayed untranslated until you scrolled (2.6.0–2.6.1).
    if (waitsForSettle) { clearTimeout(settleTimer); settleTimer = setTimeout(pump, SETTLE_MS - sinceScroll + 10); }
    refreshBar();
  }

  // While you scroll: new distances for the pages in progress, cancel the auto-translated
  // ones you left far behind (the worker ignores that once Claude has been asked), and let
  // a page that came on screen start.
  let jobsTimer = null, settleTimer = null;
  function reportJobs() {
    jobsTimer = null;
    if (running.size) {
      const update = [], cancel = [];
      for (const job of running.values()) {
        update.push({ id: job.id, distance: priorityOf(job.img), onScreen: !document.hidden && onScreen(job.img) });
        if (job.auto && (!job.img.isConnected || !nearScreen(job.img))) cancel.push(job.id);
      }
      chrome.runtime.sendMessage({ type: "JOBS", page: pageToken, update, cancel }).catch(() => {});
    }
    if (queue.length) pump();
  }
  function scheduleReport() { if (!jobsTimer && (running.size || queue.length)) jobsTimer = setTimeout(reportJobs, 150); }
  function onScroll() {
    lastScroll = performance.now();
    scheduleReport();
    scheduleReconcile();
    clearTimeout(settleTimer);
    if (queue.length) settleTimer = setTimeout(pump, SETTLE_MS + 10); // the page you stopped at may now skip the queue
  }
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", scheduleReport, { passive: true });
  document.addEventListener("visibilitychange", scheduleReport);

  // ---------- translation ----------

  // Bundled lettering fonts (fonts/*, declared web-accessible; vendor/lettering-fonts.js lists
  // them). Loaded once per page; render waits for them so the first page isn't typeset in a
  // fallback face. Failure is non-fatal: the fallback stack is used.
  let fontReady = null;
  function ensureFont() {
    if (fontReady) return fontReady;
    fontReady = (async () => {
      if (typeof FontFace === "undefined" || !document.fonts) return false;
      const loaded = await Promise.all((globalThis.GyFonts || []).map(async (f) => {
        try {
          const face = new FontFace(f.family, `url(${chrome.runtime.getURL(f.file)})`, { weight: String(f.weight), style: "normal" });
          await face.load();
          document.fonts.add(face);
          return true;
        } catch (e) { console.warn(`Gytakusub: lettering font ${f.file} unavailable, using fallback`, e); return false; }
      }));
      return loaded.every(Boolean);
    })();
    return fontReady;
  }

  // Hyphenation for the target language (settings.lettering.hyphen): English's patterns come with
  // this script; others come from the worker, which reads vendor/hyphen/<name>.json. Languages
  // without patterns (and ones typed under Other) are never hyphenated.
  let hyphenation = { name: undefined, fn: null, ready: Promise.resolve() };
  function ensureHyphenation() {
    const name = settings.lettering?.hyphen || null;
    if (name === hyphenation.name) return hyphenation.ready;
    const h = { name, fn: null, ready: null };
    hyphenation = h;
    h.ready = (async () => {
      if (!name) return;
      if (name === "en-us") { h.fn = globalThis.GyHyphen?.hyphenateEn || null; return; }
      try {
        const res = await chrome.runtime.sendMessage({ type: "GET_HYPHENATION", name });
        if (res?.patterns && globalThis.GyHyphen?.create) h.fn = GyHyphen.create(res.patterns);
      } catch (e) { console.warn("Gytakusub: no hyphenation for", name, e); }
    })();
    return h.ready;
  }
  /** How GyText letters this page: the target language's rules, one font for all its lines. */
  const lettering = (res) => ({
    fontFamily: settings.fontFamily, uppercase: settings.uppercase,
    lang: settings.lettering?.lang || null, hyphenator: hyphenation.fn,
    pageTexts: res.placements.map((p) => p.text),
  });

  const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  const loadImage = (dataUrl) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Could not decode image")); im.src = dataUrl; });

  async function translateImage({ id, img, force = false, auto = false }) {
    const entry = entries.get(img) || { status: "idle", hidden: false };
    entry.status = "working"; entry.error = undefined; entry.src = srcOf(img);
    entries.set(img, entry);
    refreshBar();
    try {
      const src = entry.src;
      keepLine();
      const msg = { type: "TRANSLATE", force, page: pageToken, jobId: id, distance: priorityOf(img), onScreen: !document.hidden && onScreen(img) };
      if (/^(blob|data):/i.test(src)) {
        const blob = await (await fetch(src)).blob(); // only the page can read its own blob: URLs
        msg.dataUrl = await blobToDataUrl(blob);
      } else {
        msg.url = src;
      }
      let res = await chrome.runtime.sendMessage(msg);
      if (!res) throw new Error("No response from background worker");
      if (res.error && msg.url && /^(http-(401|403|404|429|5\d\d)|network|no-access)$/.test(res.code || "")) {
        // The site refused the worker's request (it carries no referrer and no
        // cookies — hotlink protection). The page itself is allowed to read the
        // image when it is same-origin or served with CORS headers: try from here.
        try {
          const blob = await (await fetch(src)).blob();
          if (!blob.type.startsWith("image/")) throw new Error("not an image");
          res = await chrome.runtime.sendMessage({ type: "TRANSLATE", force, page: pageToken, jobId: id, distance: priorityOf(img), onScreen: !document.hidden && onScreen(img), dataUrl: await blobToDataUrl(blob) });
          if (!res) throw new Error("No response from background worker");
        } catch (e2) { console.info("Gytakusub: page-side fetch did not help either", e2?.message || e2); }
      }
      if (res.cancelled) { putBack(img); refreshBar(); return; } // scrolled far past before Claude was asked
      if (res.error) throw new Error(res.error);
      if (auto && !res.fromCache) autoSpent.push(performance.now()); // the spending guard counts what Claude answered
      if (srcOf(img) !== src) { entries.delete(img); return; } // image changed while we worked
      entry.result = res;
      await render(img, entry);
      entry.status = "done";
      watchLayout();
    } catch (e) {
      entry.status = "error";
      entry.error = e.message || String(e);
      entry.failures = (entry.failures || 0) + 1;
      toast(/^Gytakusub\b/.test(entry.error) ? entry.error : T("content_error", { error: entry.error }), 6000, true);
      console.warn("Gytakusub", e);
    }
    refreshBar();
  }

  async function render(img, entry) {
    await Promise.all([ensureFont(), ensureHyphenation()]);
    const res = entry.result;
    // the erased areas only; the page's own image shows through everywhere else
    entry.patches = await Promise.all(res.patches.map(async (p) => ({ ...p, img: await loadImage(p.dataUrl) })));
    const canvas = entry.canvas || document.createElement("canvas");
    canvas.className = "overlay";
    entry.img = img; entry.peek = -1;
    entry.objectFit = getComputedStyle(img).objectFit;
    if (!entry.canvas) { entry.canvas = canvas; root.append(canvas); }
    sizeBacking(entry, backingFor(res, contentRect(img, entry.objectFit)));
    drawOverlay(entry);
    if (settings.debugOverlay) console.info("Gytakusub debug", { src: entry.src, engine: res.engine, work: res.work, natural: [res.width, res.height], timing: res.timing, fromCache: res.fromCache, items: res.items, regions: res.regions, placements: res.placements, letter: res.letter });
    layout();
  }

  /** Erased patches + translations on a transparent canvas; while peeking, one bubble's patch is cleared so the original shows through. */
  // The overlay is drawn at the screen's own pixels: its backing store is the image's size on
  // screen × devicePixelRatio (not the engine's working size, which a 2× or 3× screen would
  // stretch and blur), and it is drawn again when that size changes (resize, zoom, another
  // screen). Pages far from the screen give their pixels back and are drawn again on return.
  const MAX_BACKING = 16e6; // pixels per overlay: a 2× full-HD page is ~8M; long strips are capped here
  function backingFor(res, r) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, r.width * dpr), h = Math.max(1, r.height * dpr);
    const k = Math.min(1, Math.sqrt(MAX_BACKING / (w * h)));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), dpr };
  }
  function sizeBacking(entry, b) {
    entry.canvas.width = b.w; entry.canvas.height = b.h; entry.dpr = b.dpr; entry.stale = false;
  }
  function drawOverlay(entry) {
    const { result: res, canvas } = entry;
    if (!canvas.width || !canvas.height) return; // released while far from the screen
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // patches are in the page's own pixels; placements, regions and text in work pixels
    ctx.setTransform(canvas.width / res.width, 0, 0, canvas.height / res.height, 0, 0);
    for (const p of entry.patches) ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
    ctx.setTransform(canvas.width / res.work.W, 0, 0, canvas.height / res.work.H, 0, 0);
    if (settings.debugOverlay) drawDebug(ctx, res);
    const peek = res.placements[entry.peek];
    // the size each line was drawn at (work pixels), for the readable view
    const sizes = [];
    GyText.draw(ctx, peek ? res.placements.filter((p) => p !== peek) : res.placements, { ...lettering(res), sizes });
    if (!peek) entry.sizes = sizes;
    if (peek) { const r = peekRect(peek, res); ctx.clearRect(r.x, r.y, r.w, r.h); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // The area a peek reveals: the bubble when the line sits in one, else the text's footprint.
  function peekRect(p, res) {
    const region = p.tag != null ? res.regions.find((r) => r.id === p.tag) : null;
    const r = region && region.kind === "bubble" ? region.box : p.rect;
    return { x: Math.max(0, r.x - 2), y: Math.max(0, r.y - 2), w: r.w + 4, h: r.h + 4 };
  }

  // ---------- pointer → bubble: peek on hover, edit on double-click ----------

  // Overlays never take pointer events (the reader keeps working underneath), so
  // bubbles are hit-tested from the pointer position instead.
  function hitTest(clientX, clientY) {
    for (const [img, e] of entries) {
      if (e.status !== "done" || !e.canvas || e.canvas.style.display === "none" || !e.result) continue;
      const r = contentRect(img, e.objectFit);
      if (clientX < r.left || clientY < r.top || clientX > r.left + r.width || clientY > r.top + r.height) continue;
      const wx = (clientX - r.left) / r.width * e.result.work.W, wy = (clientY - r.top) / r.height * e.result.work.H;
      const pad = Math.max(4, e.result.letter * 0.5);
      const idx = e.result.placements.findIndex((p) => wx >= p.rect.x - pad && wy >= p.rect.y - pad && wx <= p.rect.x + p.rect.w + pad && wy <= p.rect.y + p.rect.h + pad);
      return { entry: e, img, idx, rect: r };
    }
    return null;
  }

  // Readable view: a line drawn smaller than READABLE_PX on screen (a narrow window, a page
  // shown small) appears at a readable size beside its bubble while the pointer rests on it.
  // The lettering itself can't grow: it has to fit the bubble the artist drew.
  const READABLE_PX = 9;
  const readable = document.createElement("div"); readable.className = "readable"; readable.hidden = true; readable.setAttribute("role", "tooltip");
  shadow.append(readable);
  let readTimer = null, readHit = null;
  /** CSS pixels the hit line was drawn at (Infinity before it was drawn). */
  function onScreenSize(hit) {
    const size = hit.entry.sizes?.[hit.idx];
    return size ? size * hit.rect.width / hit.entry.result.work.W : Infinity;
  }
  function showReadable(hit) {
    const p = hit.entry.result.placements[hit.idx];
    if (!p) return;
    readable.textContent = p.text;
    readable.hidden = false;
    // under the line, or above it when the screen ends first
    const r = hit.rect, k = r.width / hit.entry.result.work.W;
    const box = { left: r.left + p.rect.x * k, top: r.top + p.rect.y * k, width: p.rect.w * k, height: p.rect.h * k };
    const w = readable.offsetWidth, h = readable.offsetHeight;
    const x = Math.min(Math.max(8, box.left + box.width / 2 - w / 2), Math.max(8, window.innerWidth - w - 8));
    let y = box.top + box.height + 6;
    if (y + h > window.innerHeight - 8) y = Math.max(8, box.top - h - 6);
    readable.style.left = x + "px"; readable.style.top = y + "px";
  }
  function hideReadable() { clearTimeout(readTimer); readable.hidden = true; readHit = null; }
  window.addEventListener("scroll", () => { if (readHit) hideReadable(); }, { capture: true, passive: true });

  let peekTimer = null, lastHit = null;
  function setPeek(entry, idx) {
    if (entry.peek === idx) return;
    entry.peek = idx;
    drawOverlay(entry);
  }
  document.addEventListener("mousemove", (ev) => {
    if (!ev.isTrusted || editor.open) return;
    const hit = hitTest(ev.clientX, ev.clientY);
    const small = hit && hit.idx >= 0 && onScreenSize(hit) < READABLE_PX;
    if (!small) { if (readHit) hideReadable(); }
    else if (!readHit || readHit.entry !== hit.entry || readHit.idx !== hit.idx) {
      hideReadable(); readHit = hit;
      readTimer = setTimeout(() => showReadable(hit), 250); // a dwell, as for peeking
    }
    if (!settings.peekOnHover) return;
    const same = hit && lastHit && hit.entry === lastHit.entry && hit.idx === lastHit.idx;
    if (same) return;
    clearTimeout(peekTimer);
    if (lastHit?.entry && lastHit.entry !== hit?.entry) setPeek(lastHit.entry, -1);
    lastHit = hit;
    if (!hit || hit.idx < 0) { if (hit) setPeek(hit.entry, -1); return; }
    peekTimer = setTimeout(() => setPeek(hit.entry, hit.idx), 280); // a dwell, so passing over bubbles doesn't flicker
  }, { capture: true, passive: true });
  document.addEventListener("mouseout", (ev) => { if (ev.relatedTarget) return; hideReadable(); clearTimeout(peekTimer); if (lastHit?.entry) setPeek(lastHit.entry, -1); lastHit = null; }, true); // pointer left the window

  // Editor: double-click a translated line to correct it (and optionally teach the glossary).
  const editor = { el: null, open: false, entry: null, idx: -1 };
  function buildEditor() {
    const el = document.createElement("div"); el.className = "editor"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", T("content_edit_dialog")); el.hidden = true;
    // a fixed template; the only text in it is our own messages, escaped
    el.innerHTML = `<textarea aria-label="${esc(T("content_translated_line"))}" spellcheck="true"></textarea>
      <div class="row"><button class="primary" data-act="save">${esc(T("content_save"))}</button><button data-act="cancel">${esc(T("content_cancel"))}</button><span class="hint">Ctrl+Enter · Esc</span></div>
      <div class="label">${esc(T("content_teach"))}</div>
      <div class="row gloss"><input data-f="from" placeholder="${esc(T("content_original_term_ph"))}" aria-label="${esc(T("content_original_term"))}" /><span>=</span><input data-f="to" placeholder="${esc(T("content_translation_ph"))}" aria-label="${esc(T("content_translation"))}" /><button data-act="gloss">${esc(T("content_add"))}</button></div>`;
    // the reader must not see these keys (its hotkeys), and the page must not see the text
    for (const t of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "dblclick", "wheel"]) el.addEventListener(t, (ev) => ev.stopPropagation());
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeEditor();
      else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) saveEdit();
    });
    el.addEventListener("click", (ev) => {
      if (!ev.isTrusted) return;
      const act = ev.target?.dataset?.act;
      if (act === "save") saveEdit(); else if (act === "cancel") closeEditor(); else if (act === "gloss") addGlossary();
    });
    shadow.append(el);
    return el;
  }
  function openEditor(hit, clientX, clientY) {
    hideReadable();
    editor.el ||= buildEditor();
    const p = hit.entry.result.placements[hit.idx];
    const item = p.item != null ? hit.entry.result.items[p.item] : null;
    editor.entry = hit.entry; editor.idx = hit.idx; editor.open = true;
    const ta = editor.el.querySelector("textarea"); ta.value = p.text;
    editor.el.querySelector('[data-f="from"]').value = item?.source || "";
    editor.el.querySelector('[data-f="to"]').value = "";
    editor.el.hidden = false;
    const w = 300, h = editor.el.offsetHeight || 190;
    editor.el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, clientX + 12)) + "px";
    editor.el.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, clientY + 12)) + "px";
    clearTimeout(peekTimer); setPeek(hit.entry, -1);
    ta.focus(); ta.select();
  }
  function closeEditor() { if (!editor.el) return; editor.el.hidden = true; editor.open = false; editor.entry = null; }
  async function saveEdit() {
    const e = editor.entry, p = e?.result.placements[editor.idx];
    if (!p) return closeEditor();
    const text = editor.el.querySelector("textarea").value.trim();
    if (text && text !== p.text) {
      p.text = text;
      if (p.item != null && e.result.items[p.item]) e.result.items[p.item].text = text;
      drawOverlay(e);
      if (p.item != null && e.result.cacheKey) chrome.runtime.sendMessage({ type: "EDIT_ITEM", cacheKey: e.result.cacheKey, item: p.item, text }).catch(() => {});
    }
    closeEditor();
  }
  async function addGlossary() {
    const from = editor.el.querySelector('[data-f="from"]').value.trim(), to = editor.el.querySelector('[data-f="to"]').value.trim();
    if (!from || !to) { toast(T("content_fill_both")); return; }
    try {
      const r = await chrome.runtime.sendMessage({ type: "ADD_GLOSSARY", from, to });
      if (r?.error) throw new Error(r.error);
      toast(r.replaced ? T("content_glossary_updated", { from, to }) : T("content_glossary_added", { from, to }));
      editor.el.querySelector('[data-f="to"]').value = "";
    } catch (err) { toast(T("content_error", { error: err.message || err }), 5000); }
  }
  document.addEventListener("dblclick", (ev) => {
    if (!ev.isTrusted || !active()) return;
    const hit = hitTest(ev.clientX, ev.clientY);
    if (!hit || hit.idx < 0) return;
    ev.preventDefault(); ev.stopPropagation();
    openEditor(hit, ev.clientX, ev.clientY);
  }, true);
  document.addEventListener("mousedown", (ev) => { if (editor.open && ev.isTrusted && ev.composedPath()[0] !== host) closeEditor(); }, true);

  // Debug overlay: text regions the engine found (red = bubble, blue = free
  // text, numbered as stamped for the model) and the final text areas (green).
  function drawDebug(ctx, res) {
    const W = res.work.W;
    ctx.save();
    ctx.lineWidth = Math.max(1, W / 600); ctx.font = `bold ${Math.max(10, W / 60)}px sans-serif`;
    for (const r of res.regions) {
      ctx.strokeStyle = r.kind === "bubble" ? "rgba(220,38,38,.9)" : "rgba(37,99,235,.9)";
      ctx.strokeRect(r.box.x, r.box.y, r.box.w, r.box.h);
      ctx.fillStyle = ctx.strokeStyle; ctx.fillText("#" + r.id, r.box.x + 3, r.box.y + W / 60);
    }
    for (const p of res.placements) { ctx.strokeStyle = "rgba(22,163,74,.9)"; ctx.strokeRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h); }
    ctx.restore();
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
      keepBacking(e, r);
    }
    if (hoverImg && bar.classList.contains("visible")) positionBar();
  }

  // Near the screen (within one screen-height): pixels at the current size; a page coming
  // back is drawn at once, a size change after the resize settles (until then CSS stretches
  // the old pixels, which stay in place). Far away (three screens): released.
  // Growing by over 1% redraws; shrinking only by over 10% (a smaller window loses nothing).
  let redrawTimer = null;
  function keepBacking(e, r) {
    if (!e.result) return;
    const vh = window.innerHeight || 800;
    const near = r.top + r.height > -vh && r.top < 2 * vh;
    const far = r.top + r.height < -3 * vh || r.top > 4 * vh;
    if (far) { if (e.canvas.width) { e.canvas.width = 0; e.canvas.height = 0; } return; }
    if (!near) return;
    const b = backingFor(e.result, r);
    if (!e.canvas.width) { sizeBacking(e, b); drawOverlay(e); return; }
    // never stretched by more than 1% (that is where blur starts); a little too many pixels is fine
    const off = b.w > e.canvas.width * 1.01 || b.w < e.canvas.width * 0.9 || b.dpr !== e.dpr;
    if (!off) { e.stale = false; return; }
    // the timer restarts only when the wanted size moves (a resize still going on), not on
    // every layout pass (those run each frame while scrolling, and twice a second at rest)
    if (e.stale && Math.abs(e.stale.w - b.w) <= 1 && e.stale.dpr === b.dpr) return;
    e.stale = b;
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(() => {
      for (const x of entries.values()) if (x.stale && x.canvas?.width) { sizeBacking(x, x.stale); drawOverlay(x); }
    }, 180);
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

  function translateVisible(force = false) {
    if (!active()) { toast(T("content_off_here")); return; }
    // a page auto-translate is holding (waiting to settle, or paused by the spending guard) counts as untranslated: asking takes it over
    const autoQueued = (i) => entries.get(i)?.status === "queued" && queue.some((j) => j.img === i && j.auto);
    const skip = force ? ["working", "queued"] : ["done", "working", "queued"];
    const imgs = visibleImages().filter((i) => !skip.includes(entries.get(i)?.status) || autoQueued(i));
    if (!imgs.length) { toast(T("content_no_untranslated")); return; }
    toast(TN("content_translating_n", imgs.length));
    for (const img of imgs) enqueue(img, force);
  }

  let io = null, mo = null;
  function applyAutoMode() {
    const on = autoOn();
    if (on && !io) {
      io = new IntersectionObserver((recs) => {
        for (const r of recs) {
          if (!r.isIntersecting || !isEligible(r.target)) continue;
          const e = entries.get(r.target);
          // an image that failed twice is left alone (a site that refuses the download will refuse again)
          if (!e || e.status === "idle" || (e.status === "done" && srcOf(r.target) !== e.src) || (e.status === "error" && (e.failures || 0) < 2)) enqueue(r.target, false, true);
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
      case "SETTINGS_CHANGED": loadSettings(); sendResponse({ ok: true }); break;
      case "TRANSLATE_VISIBLE": whenReady().then(() => translateVisible(!!msg.force)); sendResponse({ ok: true }); break;
      case "TOGGLE_OVERLAYS": allHidden = !allHidden; layout(); refreshBar(); sendResponse({ hidden: allHidden }); break;
      case "EXPORT_REPORT": exportReport([...entries.keys()]).then(sendResponse, (e) => sendResponse({ error: e.message || String(e) })); return true;
      case "DEBUG_REPORT": {
        const img = [...entries.keys()].find((i) => entries.get(i)?.status === "done" && (msg.src ? srcOf(i) === msg.src : true));
        sendResponse(img ? buildReport(img, entries.get(img)) : { error: "No translated image" });
        break;
      }
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
