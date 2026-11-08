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
  let settings = { enabled: true, autoSites: [], enabledSites: [], uppercase: false, fontFamily: "", excludedSites: "", peekOnHover: true };
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
    const res = entry.result;
    entry.cleanImg = await loadImage(res.cleanDataUrl); // the page with original lettering erased, at working resolution
    const canvas = entry.canvas || document.createElement("canvas");
    canvas.className = "overlay";
    canvas.width = res.work.W; canvas.height = res.work.H;
    entry.img = img; entry.peek = -1;
    if (!entry.canvas) { entry.canvas = canvas; root.append(canvas); }
    drawOverlay(entry);
    if (settings.debugOverlay) console.info("Gytakusub debug", { src: entry.src, work: res.work, natural: [res.width, res.height], items: res.items, regions: res.regions, placements: res.placements, letter: res.letter });
    entry.objectFit = getComputedStyle(img).objectFit;
    layout();
  }

  /** Clean page + translations; while peeking, one bubble shows the original pixels instead. */
  function drawOverlay(entry) {
    const { result: res, canvas, cleanImg, img } = entry;
    const W = res.work.W, H = res.work.H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cleanImg, 0, 0, W, H);
    if (settings.debugOverlay) drawDebug(ctx, res);
    const peek = res.placements[entry.peek];
    GyText.draw(ctx, peek ? res.placements.filter((p) => p !== peek) : res.placements, { fontFamily: settings.fontFamily, uppercase: settings.uppercase });
    if (peek && img?.naturalWidth) {
      // the original lettering, from the page's own <img>, mapped work → natural pixels
      const sx = img.naturalWidth / W, sy = img.naturalHeight / H, r = peekRect(peek, res);
      try { ctx.drawImage(img, r.x * sx, r.y * sy, r.w * sx, r.h * sy, r.x, r.y, r.w, r.h); } catch { /* image not decodable here; keep the translation */ }
    }
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

  let peekTimer = null, lastHit = null;
  function setPeek(entry, idx) {
    if (entry.peek === idx) return;
    entry.peek = idx;
    drawOverlay(entry);
  }
  document.addEventListener("mousemove", (ev) => {
    if (!ev.isTrusted || !settings.peekOnHover || editor.open) return;
    const hit = hitTest(ev.clientX, ev.clientY);
    const same = hit && lastHit && hit.entry === lastHit.entry && hit.idx === lastHit.idx;
    if (same) return;
    clearTimeout(peekTimer);
    if (lastHit?.entry && lastHit.entry !== hit?.entry) setPeek(lastHit.entry, -1);
    lastHit = hit;
    if (!hit || hit.idx < 0) { if (hit) setPeek(hit.entry, -1); return; }
    peekTimer = setTimeout(() => setPeek(hit.entry, hit.idx), 280); // a dwell, so passing over bubbles doesn't flicker
  }, { capture: true, passive: true });
  document.addEventListener("mouseout", (ev) => { if (ev.relatedTarget) return; clearTimeout(peekTimer); if (lastHit?.entry) setPeek(lastHit.entry, -1); lastHit = null; }, true); // pointer left the window

  // Editor: double-click a translated line to correct it (and optionally teach the glossary).
  const editor = { el: null, open: false, entry: null, idx: -1 };
  function buildEditor() {
    const el = document.createElement("div"); el.className = "editor"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Edit translation"); el.hidden = true;
    el.innerHTML = `<textarea aria-label="Translated line" spellcheck="true"></textarea>
      <div class="row"><button class="primary" data-act="save">Save</button><button data-act="cancel">Cancel</button><span class="hint">Ctrl+Enter · Esc</span></div>
      <div class="label">Teach the glossary (applies to later pages)</div>
      <div class="row gloss"><input data-f="from" placeholder="original term" aria-label="Original term" /><span>=</span><input data-f="to" placeholder="translation" aria-label="Translation" /><button data-act="gloss">Add</button></div>`;
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
    if (!from || !to) { toast("Fill both the original term and its translation"); return; }
    try {
      const r = await chrome.runtime.sendMessage({ type: "ADD_GLOSSARY", from, to });
      if (r?.error) throw new Error(r.error);
      toast(r.replaced ? `Glossary updated: ${from} = ${to}` : `Added to glossary: ${from} = ${to}`);
      editor.el.querySelector('[data-f="to"]').value = "";
    } catch (err) { toast("Gytakusub: " + (err.message || err), 5000); }
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

  function translateVisible(force = false) {
    if (!active()) { toast("Gytakusub is off on this site"); return; }
    const skip = force ? ["working", "queued"] : ["done", "working", "queued"];
    const imgs = visibleImages().filter((i) => !skip.includes(entries.get(i)?.status));
    if (!imgs.length) { toast("No untranslated images on screen"); return; }
    toast(`Translating ${imgs.length} image${imgs.length > 1 ? "s" : ""}…`);
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
      case "TRANSLATE_VISIBLE": translateVisible(!!msg.force); sendResponse({ ok: true }); break;
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
