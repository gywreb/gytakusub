// Gytakusub Web – UI.
import { loadSettings, saveSettings, loadImage, blobToDataUrl, translateImage, renderPage, testKey } from "./translator.js";
import { isConnected, connectFetcher, loadChapter, fetchPageImage, generateKey, connectionLink, readConnectionLink } from "./fetcher-client.js";
import { MODELS } from "./prompt.js";

const $ = (id) => document.getElementById(id);

let settings = loadSettings();

// "Chapter link" mode works only through a fetcher the user deployed and connected (verified with /ping).
// Until then the tab shows the setup steps instead of the chapter form.
let chapterView = "wizard"; // wizard | ready | manage
async function applyChapterMode(view) {
  const ok = await isConnected(settings);
  chapterView = view || (ok ? "ready" : "wizard");
  if (!ok && chapterView === "ready") chapterView = "wizard";
  $("chapterReady").classList.toggle("hidden", chapterView !== "ready");
  $("fetcherWizard").classList.toggle("hidden", chapterView !== "wizard");
  $("fetcherManage").classList.toggle("hidden", chapterView !== "manage");
  if (ok) {
    const where = new URL(settings.fetcherUrl).host;
    $("fetcherStatus").textContent = `Fetcher connected: ${where} (version ${settings.fetcherCheck.version})`;
    $("manageStatus").textContent = `Connected to ${where}, version ${settings.fetcherCheck.version}, checked ${new Date(settings.fetcherCheck.at).toLocaleDateString()}.`;
  }
  if (chapterView === "wizard") {
    if (!$("wzUrl").value && settings.fetcherUrl) $("wzUrl").value = settings.fetcherUrl;
    if (!$("wzKeyInput").value && settings.fetcherKey) $("wzKeyInput").value = settings.fetcherKey;
    if (settings.fetcherKey) { $("wzKey").textContent = settings.fetcherKey; $("wzCopyKey").disabled = false; $("wzGen").textContent = "New key"; }
  }
}
let ctx = { terms: [], recent: [] }; // chapter context for this session
const MAX_PARALLEL = 2;
const pages = []; // { el, img?, url?, status, result? }
let running = 0;
const queue = [];

// ---------- helpers ----------

let toastTimer;
function toast(msg, ms = 4000) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function setMode(mode) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("modeShots").classList.toggle("hidden", mode !== "shots");
  $("modeChapter").classList.toggle("hidden", mode !== "chapter");
}
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

function updateToolbar() {
  const done = pages.filter((p) => p.status === "done").length;
  const busy = pages.filter((p) => p.status === "working" || p.status === "queued").length;
  $("toolbar").classList.toggle("hidden", pages.length === 0);
  $("progress").textContent = `${done}/${pages.length} translated${busy ? ` · ${busy} in progress` : ""}`;
  $("pages").classList.toggle("spread", pages.length > 1);
  $("pages").classList.toggle("rtl", !!settings.rtlSpreads);
}

// ---------- pages ----------

function addPage({ img, url, referer, file }) {
  const el = document.createElement("div");
  el.className = "page";
  el.innerHTML = `<span class="status">queued</span><div class="actions"><button data-act="toggle">Original</button><button data-act="redo">Redo</button><button data-act="save">Save</button></div>`;
  const page = { el, img, url, referer, file, status: "queued" };
  if (img) el.append(img);
  el.addEventListener("click", (e) => {
    if (e.target.closest(".actions")) return;
    el.classList.toggle("touched");
    if (page.status === "done") el.classList.toggle("showing-original");
  });
  el.querySelector('[data-act="toggle"]').onclick = () => el.classList.toggle("showing-original");
  el.querySelector('[data-act="redo"]').onclick = () => enqueue(page, true);
  el.querySelector('[data-act="save"]').onclick = () => savePage(page);
  $("pages").append(el);
  pages.push(page);
  updateToolbar();
  return page;
}

function setStatus(page, text, cls = "") {
  const s = page.el.querySelector(".status");
  s.textContent = text; s.className = "status " + cls; s.hidden = !text;
}

function enqueue(page, force = false) {
  if (page.status === "working") return;
  page.status = "queued"; setStatus(page, "queued");
  if (!queue.includes(page)) queue.push(page);
  pump();
}
function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    // nearest to the viewport first
    queue.sort((a, b) => Math.abs(a.el.getBoundingClientRect().top) - Math.abs(b.el.getBoundingClientRect().top));
    const page = queue.shift();
    running++;
    processPage(page).finally(() => { running--; pump(); updateToolbar(); });
  }
  updateToolbar();
}

async function processPage(page) {
  page.status = "working"; setStatus(page, "loading…");
  try {
    if (!page.img) {
      const blob = page.file || (await fetchPageImage(settings, page.url, page.referer));
      page.img = await loadImage(await blobToDataUrl(blob));
      page.el.append(page.img);
    }
    setStatus(page, "translating…");
    const [result] = await Promise.all([
      translateImage(page.img, settings, settings.useContext ? ctx : { terms: [], recent: [] }),
      document.fonts?.load('700 20px "Gytakusub Comic"').catch(() => null), // bundled lettering font
    ]);
    if (settings.useContext) ctx = result.ctx;
    const { original, translated, drawn } = renderPage(page.img, result, settings);
    original.className = "original"; translated.className = "translated";
    page.el.querySelectorAll("canvas").forEach((c) => c.remove());
    page.img.remove();
    page.el.prepend(original, translated);
    page.result = result;
    page.status = "done";
    setStatus(page, drawn ? "" : "no text found");
  } catch (e) {
    page.status = "error";
    setStatus(page, "⚠ " + (e.message || e), "error");
    console.error(e);
  }
}

async function savePage(page) {
  const c = page.el.querySelector("canvas.translated");
  if (!c) return toast("Not translated yet");
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
  const file = new File([blob], `gytakusub-${Date.now()}.jpg`, { type: "image/jpeg" });
  toast("Saved for your personal reading. Please don't redistribute translated pages.", 3500);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Gytakusub" }); return; } catch { /* cancelled */ return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- screenshot mode ----------

async function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return toast("No image found");
  for (const f of imgs) {
    const img = await loadImage(await blobToDataUrl(f));
    enqueue(addPage({ img }));
  }
  $("pages").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("file").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };

$("btnPaste").onclick = async () => {
  if (!navigator.clipboard?.read) return toast("Paste with Ctrl/⌘+V, or long-press the page and choose Paste.");
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith("image/"));
      if (type) files.push(new File([await it.getType(type)], "clipboard." + type.split("/")[1], { type }));
    }
    if (!files.length) return toast("Clipboard has no image. Copy a screenshot first.");
    addFiles(files);
  } catch (e) {
    toast("Clipboard access was denied. Use Choose photos instead.");
  }
};

document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  const fromItems = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile());
  const all = files.length ? files : fromItems;
  if (all.length) { e.preventDefault(); addFiles(all); }
});

const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

// ---------- chapter mode ----------

let io = null, chapterNav = { next: null, prev: null };

/** Loads the chapter at `link` through the fetcher. `keepContext`: Next/Previous keep the names and recent lines. */
async function openChapter(link, { keepContext = false } = {}) {
  setMode("chapter");
  $("chapterUrl").value = link;
  $("chapterInfo").textContent = "Loading chapter…";
  showNav({ next: null, prev: null });
  try {
    const ch = await loadChapter(settings, link);
    clearPages();
    if (!keepContext) ctx = { terms: [], recent: [] };
    history.replaceState(null, "", `?chapter=${encodeURIComponent(ch.url)}`);
    $("chapterInfo").textContent = `${ch.title ? ch.title + " · " : ""}${ch.pages.length} pages. Scroll — pages translate as they come into view.`;
    io = new IntersectionObserver((recs) => {
      for (const r of recs) if (r.isIntersecting) { const p = pages.find((p) => p.el === r.target); if (p && p.status === "idle") enqueue(p); }
    }, { rootMargin: "150% 0px" });
    for (const url of ch.pages) {
      const page = addPage({ url, referer: ch.referer });
      page.status = "idle"; setStatus(page, "");
      page.el.style.minHeight = "60vh";
      io.observe(page.el);
    }
    showNav(ch);
    window.scrollTo({ top: 0 });
  } catch (err) {
    $("chapterInfo").textContent = "⚠ " + err.message;
    // the fetcher no longer accepts this app's key or setup: back to the setup steps, with the reason
    if (["unauthorized", "setup", "outdated"].includes(err.code)) {
      settings = { ...settings, fetcherCheck: null }; saveSettings(settings);
      await applyChapterMode("wizard");
      showStep(err.code === "setup" ? 5 : 6);
      wizardMsg("err", err.message);
    }
  }
}

function showNav(ch) {
  chapterNav = { next: ch.next || null, prev: ch.prev || null };
  for (const id of ["navNext", "navNextTop"]) $(id).hidden = !chapterNav.next;
  for (const id of ["navPrev", "navPrevTop"]) $(id).hidden = !chapterNav.prev;
}
for (const id of ["navNext", "navNextTop"]) $(id).onclick = () => chapterNav.next && openChapter(chapterNav.next, { keepContext: true });
for (const id of ["navPrev", "navPrevTop"]) $(id).onclick = () => chapterNav.prev && openChapter(chapterNav.prev, { keepContext: true });

$("chapterForm").onsubmit = (e) => { e.preventDefault(); openChapter($("chapterUrl").value.trim()); };

function clearPages() {
  io?.disconnect(); io = null;
  queue.length = 0;
  pages.splice(0).forEach((p) => p.el.remove());
  updateToolbar();
}
$("btnClear").onclick = () => { clearPages(); showNav({}); ctx = { terms: [], recent: [] }; history.replaceState(null, "", location.pathname); };
$("showOriginal").onchange = (e) => document.querySelectorAll(".page").forEach((p) => p.classList.toggle("showing-original", e.target.checked));

// ---------- settings ----------

const dlg = $("settings");
$("sModel").innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
function fillSettings() {
  $("sApiKey").value = settings.apiKey; $("sModel").value = settings.model; $("sTargetLang").value = settings.targetLang;
  $("sGlossary").value = settings.glossary; $("sCustomPrompt").value = settings.customPrompt;
  $("sUseContext").checked = settings.useContext; $("sUppercase").checked = settings.uppercase; $("sRtl").checked = settings.rtlSpreads;
  $("sMsg").textContent = "";
}
function readSettings() {
  return { ...settings, apiKey: $("sApiKey").value.trim(), model: $("sModel").value, targetLang: $("sTargetLang").value.trim() || "English",
    glossary: $("sGlossary").value, customPrompt: $("sCustomPrompt").value, useContext: $("sUseContext").checked,
    uppercase: $("sUppercase").checked, rtlSpreads: $("sRtl").checked };
}
$("btnSettings").onclick = () => { fillSettings(); dlg.showModal(); };
$("sShow").onclick = () => { const i = $("sApiKey"); i.type = i.type === "password" ? "text" : "password"; $("sShow").textContent = i.type === "password" ? "Show" : "Hide"; };
$("sTest").onclick = async () => {
  const s = readSettings(); $("sMsg").className = "hint"; $("sMsg").textContent = "Testing…";
  try { await testKey(s); $("sMsg").className = "hint ok"; $("sMsg").textContent = `Key works (${s.model}).`; }
  catch (e) { $("sMsg").className = "hint err"; $("sMsg").textContent = "Failed: " + e.message; }
};
dlg.addEventListener("close", () => { if (dlg.returnValue === "save") { settings = readSettings(); saveSettings(settings); updateToolbar(); toast("Saved"); } });

// ---------- chapter fetcher setup ----------

function wizardMsg(kind, text) { const m = $("wzMsg"); m.className = "hint" + (kind ? " " + kind : ""); m.textContent = text; }
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`); }
  catch { prompt(`Copy ${what.toLowerCase()}:`, text); }
}
// When the steps were last checked against Cloudflare's pages (fetcher/guide-sources.json; a weekly CI job flags changes).
fetch("fetcher-guide.json").then((r) => r.json()).then((g) => { $("wzChecked").textContent = new Date(g.checked + "T00:00:00Z").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); }).catch(() => {});
$("wzGen").onclick = () => {
  const key = generateKey();
  $("wzKey").textContent = key; $("wzKeyInput").value = key; $("wzCopyKey").disabled = false; $("wzGen").textContent = "New key";
  // remembered (not yet connected), so leaving for Cloudflare and coming back keeps it
  settings = { ...settings, fetcherKey: key, fetcherCheck: null }; saveSettings(settings);
};
$("wzCopyKey").onclick = () => copyText($("wzKey").textContent, "Key");
$("wzCopyKey2").onclick = () => settings.fetcherKey ? copyText(settings.fetcherKey, "Key") : toast("Generate a key in step 2 first");
// Copyable values in the steps (names and settings to type into GitHub/Cloudflare)
document.querySelectorAll("#fetcherWizard .chip").forEach((b) => (b.onclick = () => copyText(b.dataset.copy, `“${b.dataset.copy}”`)));

// One step at a time; where you are is remembered, so going off to GitHub or Cloudflare and back keeps your place.
const STEP_KEY = "gytakusub.setupStep";
const stepItems = [...document.querySelectorAll("#wzSteps > li")];
function showStep(n) {
  const step = Math.max(1, Math.min(stepItems.length, n | 0));
  try { localStorage.setItem(STEP_KEY, String(step)); } catch { /* private mode */ }
  stepItems.forEach((li, i) => { li.classList.toggle("active", i + 1 === step); li.classList.toggle("done", i + 1 < step); });
  $("wzProgress").textContent = `Step ${step} of ${stepItems.length}`;
  $("wzBack").hidden = step === 1;
  $("wzNext").hidden = step === stepItems.length;
}
stepItems.forEach((li, i) => (li.querySelector(".step-title").onclick = () => showStep(i + 1)));
$("wzBack").onclick = () => showStep(Number(localStorage.getItem(STEP_KEY) || 1) - 1);
$("wzNext").onclick = () => {
  const step = Number(localStorage.getItem(STEP_KEY) || 1);
  if (step === 2 && !settings.fetcherKey) return toast("Tap Generate key first");
  showStep(step + 1);
  $("wzProgress").scrollIntoView({ block: "nearest" });
};
showStep(Number(localStorage.getItem(STEP_KEY) || 1));
async function connect(url, key, button, show) {
  show("", "Connecting…"); button.disabled = true;
  try {
    const fields = await connectFetcher(url, key);
    settings = { ...settings, ...fields }; saveSettings(settings);
    show("ok", `Connected (fetcher version ${fields.fetcherCheck.version}).`);
    await applyChapterMode("ready");
    toast("Fetcher connected. Paste a chapter link.");
  } catch (e) {
    show("err", e.message);
  } finally { button.disabled = false; }
}
$("wzConnect").onclick = () => connect($("wzUrl").value, $("wzKeyInput").value.trim(), $("wzConnect"), wizardMsg);
// A connection link pasted as text (on iPhone the Home Screen app and Safari keep separate settings, so opening the link may not reach the app)
$("wzLinkConnect").onclick = () => {
  const show = (kind, text) => { const m = $("wzLinkMsg"); m.className = "hint" + (kind ? " " + kind : ""); m.textContent = text; };
  const raw = $("wzLink").value.trim();
  const shared = readConnectionLink(raw.includes("#") ? raw.slice(raw.indexOf("#")) : "");
  if (!shared) return show("err", "That isn't a connection link. It looks like https://gywreb.github.io/gytakusub/#connect=…");
  connect(shared.url, shared.key, $("wzLinkConnect"), show);
};
$("btnFetcherManage").onclick = () => applyChapterMode("manage");
$("mgDone").onclick = () => applyChapterMode("ready");
$("mgSetup").onclick = () => applyChapterMode("wizard");
$("mgCopyLink").onclick = () => copyText(connectionLink(settings), "Connection link");
$("mgForget").onclick = async () => {
  if (!confirm("Remove the fetcher address and key from this device? Chapter links stop working here until you connect again.")) return;
  settings = { ...settings, fetcherUrl: "", fetcherKey: "", fetcherCheck: null }; saveSettings(settings);
  $("wzUrl").value = ""; $("wzKeyInput").value = ""; wizardMsg("", "");
  await applyChapterMode("wizard");
};

// ---------- boot ----------

// A connection link (#connect=…) fills in a fetcher address and key; the user checks the address and taps Connect.
const shared = readConnectionLink(location.hash);
if (shared) history.replaceState(null, "", location.pathname + location.search); // don't leave the key in the address bar
await applyChapterMode();
if (shared) {
  setMode("chapter");
  await applyChapterMode("wizard");
  $("wzLink").value = location.origin + location.pathname + "#connect=…";
  $("wzUrl").value = shared.url; $("wzKeyInput").value = shared.key;
  wizardMsg("", `A connection link filled in the fetcher at ${shared.url}. If you trust it, tap Connect.`);
  showStep(6); $("wzStep5").scrollIntoView({ block: "center" });
}
// ?chapter=<link> (the bookmarklet in fetcher/README.md) fills in that chapter; it opens on a tap of Load, so a link
// someone else sent can't make the fetcher visit a site or spend Claude credits by itself.
const linked = new URLSearchParams(location.search).get("chapter");
if (linked && !shared) { setMode("chapter"); $("chapterUrl").value = linked; $("chapterInfo").textContent = chapterView === "ready" ? "Tap Load to open this chapter." : "Set up chapter links below; this chapter will be waiting."; }
if (!settings.apiKey) setTimeout(() => { fillSettings(); dlg.showModal(); }, 400);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
updateToolbar();
