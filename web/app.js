// Gytakusub Web – UI.
import { loadSettings, saveSettings, loadImage, blobToDataUrl, translateImage, renderPage, prepareLettering, testKey } from "./translator.js";
import { isConnected, connectFetcher, loadChapter, fetchPageImage, generateKey, connectionLink, readConnectionLink, fetcherBase, usageToday, onUsage, resetTime, FREE_DAILY, loadCloudUsage } from "./fetcher-client.js";
import { MODELS } from "./prompt.js";
import { loadLocale, applyI18n, t, tn, langTag, currentLocale } from "./i18n.js";
import { languageOptions, findLanguage, languageForLocale, uiLocaleFor } from "./languages.js";
import { summary, usageView, fmtUsd, dayStart, PRICES_CHECKED, PRICE_SOURCE } from "./usage.js";
import { readClaudeUsage, onClaudeUsage, clearClaudeUsage } from "./claude-usage.js";
import qrcode from "./lib/qrcode.mjs";
import { buildReport } from "./report.js";

const $ = (id) => document.getElementById(id);

let settings = loadSettings();
if (!localStorage.getItem("gytakusub.settings")) { // nothing saved yet
  // a first guess at the language to translate into: the device's own (Settings → Translation changes it)
  const guess = languageForLocale(navigator.language);
  if (guess) settings = { ...settings, targetLang: guess.name };
}
// The app speaks the target language when it has a translation, as the extension does (ADR 0010).
// Messages: the ones shared with the extension (_locales/, synced from extension/) and the web
// app's own (locales/), English underneath both.
const readMessages = async (path) => {
  const own = path.replace(/^_locales\//, "locales/");
  const [shared, web] = await Promise.all([fetch(`./${path}`).then((r) => r.json()), fetch(`./${own}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))]);
  return { ...shared, ...web };
};
await loadLocale(uiLocaleFor(settings.targetLang), readMessages);
applyI18n(document);
const n = (x) => Number(x).toLocaleString(langTag());
// GitHub's and Cloudflare's buttons are quoted in English (their own labels); say so in other languages
const labelsNote = () => document.querySelectorAll("[data-labels-note]").forEach((el) => (el.hidden = currentLocale() === "en"));
labelsNote();

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
    $("manageStatus").textContent = t("web_manage_status", { host: where, version: settings.fetcherCheck.version, date: new Date(settings.fetcherCheck.at).toLocaleDateString(langTag()) });
    showUsage();
    if (chapterView === "manage") refreshLive(true);
  }
  if (chapterView === "wizard") {
    if (!$("wzUrl").value && settings.fetcherUrl) $("wzUrl").value = settings.fetcherUrl;
    if (!$("wzKeyInput").value && settings.fetcherKey) $("wzKeyInput").value = settings.fetcherKey;
    if (settings.fetcherKey) { $("wzKey").textContent = settings.fetcherKey; $("wzCopyKey").disabled = false; $("wzGen").textContent = t("web_new_key"); }
  }
}
// Today's use of the free allowance. With the live count (the fetcher reads Cloudflare's analytics)
// every browser and the installed app show the same number; without it, what this device sent, as an
// estimate. The live count refreshes every minute while the Chapter link tab is on screen.
const LIVE_EVERY = 60e3, LIVE_MIN_GAP = 20e3;
let live = { state: "unknown", data: null, at: 0, error: "" }; // state: unknown | live | setup | old | error
let liveBusy = false;

async function refreshLive(force = false) {
  if (liveBusy || !settings.fetcherUrl || !(await isConnected(settings))) return;
  if (!force && Date.now() - live.at < LIVE_MIN_GAP) return;
  liveBusy = true;
  try {
    const data = await loadCloudUsage(settings);
    live = { state: "live", data, at: Date.now(), error: "" };
  } catch (e) {
    const state = e.code === "usage-setup" ? "setup" : e.code === "usage-old" ? "old" : "error";
    // a passing failure keeps the last count on screen, marked with its time
    live = { state, data: state === "error" ? live.data : null, at: Date.now(), error: state === "error" ? e.message : "" };
  } finally {
    liveBusy = false;
  }
  showUsage();
}
const liveWanted = () => currentMode === "chapter" && document.visibilityState === "visible" && !["setup", "old"].includes(live.state);
setInterval(() => { if (liveWanted()) refreshLive(); }, LIVE_EVERY);
document.addEventListener("visibilitychange", () => { if (liveWanted()) refreshLive(); });

function showUsage() {
  if (!settings.fetcherUrl) return;
  const time = (iso) => new Date(iso).toLocaleTimeString(langTag(), { hour: "numeric", minute: "2-digit" });
  const device = usageToday(fetcherBase(settings.fetcherUrl));
  const cloud = live.data, isLive = !!cloud;
  $("usageSource").textContent = isLive ? t("web_usage_source_live", { time: time(cloud.asOf) }) : t("web_usage_source_device");
  $("usageSource").classList.toggle("live", isLive);
  if (isLive) {
    // Cloudflare's own count for the account: the only number that can sit against the allowance
    const requests = cloud.requests, limit = cloud.limit || FREE_DAILY;
    const share = Math.min(1, requests / limit), warn = share >= 0.8;
    const state = share >= 1 ? t("web_usage_used_up", { time: resetTime() }) : warn ? t("web_usage_almost") : ""; // the state in words too, not only in red
    $("fetcherUsage").textContent = share >= 1 ? t("web_chip_used_up", { time: resetTime() }) : (state ? `${n(requests)} / ${n(limit)} · ${state}` : t("web_chip_count", { requests: n(requests), limit: n(limit) }));
    $("btnFetcherManage").classList.toggle("warn", warn);
    $("btnFetcherManage").title = t("web_chip_title", { time: time(cloud.asOf) });
    $("usageState").textContent = state ? state[0].toUpperCase() + state.slice(1) : "";
    $("usageState").hidden = !state;
    $("usageCount").textContent = n(requests);
    $("usageMax").textContent = n(limit);
    const meter = $("usageMeter");
    meter.setAttribute("aria-valuemax", limit);
    meter.setAttribute("aria-valuenow", Math.min(requests, limit));
    meter.setAttribute("aria-valuetext", t("web_meter_text", { requests: n(requests), limit: n(limit) }));
    meter.classList.toggle("warn", warn);
    meter.classList.toggle("used", requests > 0);
    meter.firstElementChild.style.width = `${share * 100}%`;
    const others = cloud.workers.slice(1).reduce((t, w) => t + w.requests, 0);
    const split = cloud.workers.length > 1 ? t("web_usage_split", { name: cloud.workers[0].name, count: n(cloud.workers[0].requests), others: n(others) }) + " · " : "";
    $("usageNote").textContent = split + t("web_usage_note_live", { time: resetTime() });
  } else {
    // only what this device sent: the account's total (other devices, the browser's permission
    // checks) isn't visible from here, so no share of the allowance and no warning are made up
    $("fetcherUsage").textContent = "";
    $("btnFetcherManage").classList.remove("warn");
    $("btnFetcherManage").title = "";
    $("usageState").hidden = true;
    $("usageCount").textContent = n(device.requests);
    $("usageNote").textContent = tn("web_usage_note_device", device.chapters, { time: resetTime() });
  }
  document.querySelectorAll("[data-usage=device]").forEach((el) => (el.hidden = isLive));
  document.querySelectorAll("[data-usage=live]").forEach((el) => (el.hidden = !isLive));
  $("usageReset").textContent = resetTime();
  $("liveSetup").hidden = live.state !== "setup";
  $("liveUpdate").hidden = live.state !== "old";
  $("liveError").hidden = live.state !== "error";
  $("liveError").textContent = live.state === "error" ? t("web_live_error", { error: live.error }) + (cloud ? " " + t("web_live_error_showing", { time: time(cloud.asOf) }) : "") : "";
}
onUsage(showUsage);
async function checkLive(button) {
  button.disabled = true; $("liveMsg").textContent = t("web_checking");
  await refreshLive(true);
  button.disabled = false;
  $("liveMsg").textContent = live.state === "live" ? "" : live.state === "setup" ? t("web_live_not_yet") : "";
  if (live.state === "live") toast(t("web_live_on"));
}

// ---------- Claude usage (usage.js): what this browser's translations cost ----------
function showClaudeUsage(log = readClaudeUsage()) {
  const v = usageView(log);
  $("cuTodayCost").textContent = v.today.cost; $("cuTodaySub").textContent = v.today.sub;
  $("cuMonthLabel").textContent = v.month.label;
  $("cuMonthCost").textContent = v.month.cost; $("cuMonthSub").textContent = v.month.sub;
  $("cuModels").replaceChildren(...v.models.map((m) => {
    const li = document.createElement("li");
    const name = document.createElement("span"); name.className = "model-name"; name.textContent = m.label;
    const what = document.createElement("span"); what.className = "model-what"; what.textContent = m.sub;
    const cost = document.createElement("span"); cost.className = "model-cost"; cost.textContent = m.cost;
    li.append(name, cost, what);
    return li;
  }));
  $("cuModels").hidden = !v.models.length;
  $("cuTodayTokens").textContent = v.today.tokens; $("cuMonthTokens").textContent = v.month.tokens;
  $("cuLimits").hidden = !v.limits;
  $("cuLimits").textContent = v.limits;
  $("cuChecked").textContent = new Date(PRICES_CHECKED + "T00:00:00Z").toLocaleDateString(langTag(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  $("cuPriceLink").href = PRICE_SOURCE;
  $("cuDayStart").textContent = dayStart();
  updateToolbar();
}
onClaudeUsage(showClaudeUsage);
$("cuClear").onclick = () => {
  if (!confirm(t("opt_confirm_clear_usage"))) return;
  clearClaudeUsage(); toast(t("opt_usage_cleared"));
};

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

// Each mode keeps its own pages: screenshots don't show under Chapter link, and the other way round.
let currentMode = "shots";
const modePages = () => pages.filter((p) => p.mode === currentMode);
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("active", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
  });
  $("modeShots").classList.toggle("hidden", mode !== "shots");
  $("modeChapter").classList.toggle("hidden", mode !== "chapter");
  $("pages").dataset.mode = mode;
  updateToolbar();
  if (mode === "chapter") refreshLive();
}
const tabs = [...document.querySelectorAll(".tab")];
tabs.forEach((b, i) => {
  b.onclick = () => setMode(b.dataset.mode);
  // tablist keyboard pattern: arrows move between tabs
  b.onkeydown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setMode(next.dataset.mode); next.focus();
  };
});

function updateToolbar() {
  const list = modePages();
  const done = list.filter((p) => p.status === "done").length;
  const busy = list.filter((p) => p.status === "working" || p.status === "queued").length;
  $("toolbar").classList.toggle("hidden", list.length === 0);
  $("drop").classList.toggle("compact", currentMode === "shots" && list.length > 0);
  const today = summary(readClaudeUsage()).today;
  $("progress").textContent = t("web_progress", { done: n(done), total: n(list.length) }) + (busy ? " · " + t("web_progress_busy", { n: n(busy) }) : "") + (today.requests ? " · " + t("web_progress_cost", { cost: fmtUsd(today.cost) }) : "");
  $("pages").classList.toggle("spread", list.length > 1);
  $("pages").classList.toggle("rtl", !!settings.rtlSpreads);
}

// ---------- pages ----------

function addPage({ img, url, referer, file, mode = currentMode }) {
  const el = document.createElement("article");
  el.className = "page"; el.dataset.mode = mode;
  el.innerHTML = `<div class="page-media"></div><div class="page-bar"><span class="status" role="status"></span><div class="page-actions"><button type="button" data-act="toggle" aria-pressed="false" data-i18n="web_page_original"></button><button type="button" data-act="redo" data-i18n="web_page_redo"></button><button type="button" data-act="save" data-i18n="opt_save"></button></div></div>`;
  applyI18n(el);
  el.querySelector(".status").textContent = t("web_status_queued");
  const page = { el, media: el.querySelector(".page-media"), img, url, referer, file, mode, status: "queued" };
  if (img) page.media.append(img);
  const toggle = el.querySelector('[data-act="toggle"]');
  const showOriginal = (on) => { el.classList.toggle("showing-original", on); toggle.setAttribute("aria-pressed", String(on)); };
  page.showOriginal = showOriginal;
  // tapping the page flips between translation and original, like the button
  page.media.addEventListener("click", () => { if (page.status === "done") showOriginal(!el.classList.contains("showing-original")); });
  toggle.onclick = () => showOriginal(!el.classList.contains("showing-original"));
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
  page.status = "queued"; setStatus(page, t("web_status_queued"));
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
  page.status = "working"; setStatus(page, t("web_status_loading"));
  try {
    if (!page.img) {
      const blob = page.file || (await fetchPageImage(settings, page.url, page.referer));
      page.blob = blob; // the image's own bytes, for the debug report
      page.img = await loadImage(await blobToDataUrl(blob));
      page.media.append(page.img);
    }
    setStatus(page, t("web_status_translating"));
    const [result, look] = await Promise.all([
      translateImage(page.img, settings, settings.useContext ? ctx : { terms: [], recent: [] }),
      prepareLettering(settings), // the bundled fonts and the target language's hyphenation
    ]);
    if (settings.useContext) ctx = result.ctx;
    page.result = result; page.look = look;
    const drawn = drawPage(page);
    page.status = "done";
    setStatus(page, drawn ? "" : t("web_status_no_text"));
  } catch (e) {
    page.status = "error";
    setStatus(page, "⚠ " + (e.message || e), "error");
    console.error(e);
  }
}

/** Draws a translated page at its own size or the screen's, whichever is larger. */
function drawPage(page) {
  const screenWidth = Math.round(page.media.clientWidth * (window.devicePixelRatio || 1));
  page.drawnFor = screenWidth;
  const { original, translated, drawn } = renderPage(page.img, page.result, settings, page.look, { minWidth: screenWidth });
  original.className = "original"; translated.className = "translated";
  page.media.querySelectorAll("canvas").forEach((c) => c.remove());
  page.img.remove();
  page.media.prepend(original, translated);
  return drawn;
}

// Unfolding a foldable, turning a phone or a wider window can need more pixels than a page was
// drawn with: redraw those once the change settles (fewer pixels than drawn is fine as is).
let screenTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(screenTimer);
  screenTimer = setTimeout(() => {
    for (const page of pages) {
      if (page.status !== "done" || !page.result) continue;
      const need = Math.round(page.media.clientWidth * (window.devicePixelRatio || 1));
      if (need > (page.drawnFor || 0) * 1.01) drawPage(page);
    }
  }, 250);
});

// Debug report (report.js): one .zip of the translated pages with their originals, Claude's answers,
// the engine's regions and timings, and a render of each — to share with the developer, through the
// share sheet on a phone (Save to Files), else as a download.
async function exportReport() {
  const done = pages.filter((p) => p.status === "done" && p.result);
  if (!done.length) return toast(t("content_nothing_translated"));
  toast(tn("content_preparing_report", done.length), 20000);
  let file;
  try { ({ file } = await buildReport(done, settings)); }
  catch (e) { console.error(e); return toast("⚠ " + (e.message || e), 6000); }
  toast(tn("content_report_done", done.length, { size: (file.size / 1e6).toFixed(1) }), 6000);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Gytakusub debug report" }); return; } catch { /* cancelled: offer the download instead */ }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.rel = "noopener"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function savePage(page) {
  const c = page.el.querySelector("canvas.translated");
  if (!c) return toast(t("web_not_translated_yet"));
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
  const file = new File([blob], `gytakusub-${Date.now()}.jpg`, { type: "image/jpeg" });
  toast(t("web_saved_personal"), 3500);
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Gytakusub" }); return; } catch { /* cancelled */ return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- screenshot mode ----------

async function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imgs.length) return toast(t("web_no_image"));
  for (const f of imgs) {
    const img = await loadImage(await blobToDataUrl(f));
    enqueue(addPage({ img, file: f })); // (the file's bytes too: the debug report keeps the original)
  }
  $("pages").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("file").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };

$("btnPaste").onclick = async () => {
  if (!navigator.clipboard?.read) return toast(t("web_paste_how"));
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith("image/"));
      if (type) files.push(new File([await it.getType(type)], "clipboard." + type.split("/")[1], { type }));
    }
    if (!files.length) return toast(t("web_clipboard_empty"));
    addFiles(files);
  } catch (e) {
    toast(t("web_clipboard_denied"));
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
  $("chapterInfo").textContent = t("web_loading_chapter");
  showNav({ next: null, prev: null });
  try {
    const ch = await loadChapter(settings, link);
    clearPages();
    if (!keepContext) ctx = { terms: [], recent: [] };
    history.replaceState(null, "", `?chapter=${encodeURIComponent(ch.url)}`);
    $("chapterInfo").textContent = (ch.title ? ch.title + " · " : "") + tn("web_chapter_pages", ch.pages.length);
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

function clearPages(mode = currentMode) {
  if (mode === "chapter") { io?.disconnect(); io = null; }
  for (let k = queue.length - 1; k >= 0; k--) if (queue[k].mode === mode) queue.splice(k, 1);
  for (let k = pages.length - 1; k >= 0; k--) if (pages[k].mode === mode) { pages[k].el.remove(); pages.splice(k, 1); }
  updateToolbar();
}
$("btnReport").onclick = () => exportReport();
$("btnClear").onclick = () => { clearPages(); ctx = { terms: [], recent: [] }; if (currentMode === "chapter") { showNav({}); history.replaceState(null, "", location.pathname); } };
$("showOriginal").onchange = (e) => modePages().forEach((p) => p.showOriginal(e.target.checked));

// ---------- settings ----------

const dlg = $("settings");
// the model menu shows the names (they fit a phone in any language); what the chosen one is for sits below it
$("sModel").replaceChildren(...MODELS.map((m) => new Option(m.label.split(" — ")[0], m.id)));
const showModelHint = () => { const kind = ($("sModel").value.match(/haiku|sonnet|opus/) || [])[0]; $("sModelHint").textContent = kind ? t(`popup_model_hint_${kind}`) : ""; };
$("sModel").addEventListener("change", showModelHint);
// Target language: the list (languages.js) or "Other…" with a name typed in
const OTHER_LANG = "__other";
const fillLanguages = () => { const keep = $("sTargetLang").value; $("sTargetLang").replaceChildren(...languageOptions().map(({ value, label }) => new Option(label, value)), new Option(t("opt_other_language"), OTHER_LANG)); if (keep) $("sTargetLang").value = keep; };
fillLanguages();
$("sTargetLang").addEventListener("change", () => {
  $("sTargetOtherField").hidden = $("sTargetLang").value !== OTHER_LANG;
  if (!$("sTargetOtherField").hidden) $("sTargetOther").focus();
});
function fillSettings() {
  showClaudeUsage();
  $("sApiKey").value = settings.apiKey; $("sModel").value = settings.model; showModelHint();
  const listed = findLanguage(settings.targetLang);
  $("sTargetLang").value = listed ? listed.name : OTHER_LANG;
  $("sTargetOther").value = listed ? "" : settings.targetLang;
  $("sTargetOtherField").hidden = !!listed;
  $("sGlossary").value = settings.glossary; $("sCustomPrompt").value = settings.customPrompt;
  $("sUseContext").checked = settings.useContext; $("sUppercase").checked = settings.uppercase; $("sRtl").checked = settings.rtlSpreads;
  $("sMsg").textContent = "";
}
function readSettings() {
  return { ...settings, apiKey: $("sApiKey").value.trim(), model: $("sModel").value, targetLang: $("sTargetLang").value === OTHER_LANG ? $("sTargetOther").value.trim() || "English" : $("sTargetLang").value,
    glossary: $("sGlossary").value, customPrompt: $("sCustomPrompt").value, useContext: $("sUseContext").checked,
    uppercase: $("sUppercase").checked, rtlSpreads: $("sRtl").checked };
}
$("btnSettings").onclick = () => { fillSettings(); dlg.showModal(); };
$("sShow").onclick = () => { const i = $("sApiKey"); i.type = i.type === "password" ? "text" : "password"; $("sShow").textContent = t(i.type === "password" ? "opt_show" : "opt_hide"); };
$("sTest").onclick = async () => {
  const s = readSettings(); $("sMsg").className = "hint"; $("sMsg").textContent = t("opt_testing");
  try { await testKey(s); $("sMsg").className = "hint ok"; $("sMsg").textContent = t("opt_key_works", { model: s.model }); }
  catch (e) { $("sMsg").className = "hint err"; $("sMsg").textContent = t("opt_key_failed", { error: e.message }); }
};
dlg.addEventListener("close", async () => {
  if (dlg.returnValue !== "save") return;
  const before = currentLocale();
  settings = readSettings(); saveSettings(settings); updateToolbar();
  if (uiLocaleFor(settings.targetLang) !== before) await speak(); // the app follows the target language
  toast(t("opt_saved"));
});

// ---------- chapter fetcher setup ----------

function wizardMsg(kind, text) { const m = $("wzMsg"); m.className = "hint" + (kind ? " " + kind : ""); m.textContent = text; }
async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(t("web_copied", { what })); }
  catch { prompt(t("web_copy_prompt"), text); }
}
// When the steps were last checked against Cloudflare's pages (fetcher/guide-sources.json; a weekly CI job flags changes).
let guideChecked = null;
const showGuideChecked = () => { if (guideChecked) $("wzChecked").textContent = new Date(guideChecked + "T00:00:00Z").toLocaleDateString(langTag(), { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }); };
fetch("fetcher-guide.json").then((r) => r.json()).then((g) => { guideChecked = g.checked; showGuideChecked(); }).catch(() => {});
$("wzGen").onclick = () => {
  const key = generateKey();
  $("wzKey").textContent = key; $("wzKeyInput").value = key; $("wzCopyKey").disabled = false; $("wzGen").textContent = t("web_new_key");
  // remembered (not yet connected), so leaving for Cloudflare and coming back keeps it
  settings = { ...settings, fetcherKey: key, fetcherCheck: null }; saveSettings(settings);
};
$("wzCopyKey").onclick = () => copyText($("wzKey").textContent, t("web_what_key"));
// Buttons inside translated sentences are re-created when the language changes: one listener for them all.
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("button");
  if (!b) return;
  if (b.id === "wzCopyKey2") settings.fetcherKey ? copyText(settings.fetcherKey, t("web_what_key")) : toast(t("web_key_first"));
  else if (b.id === "btnCopyAppLink") copyText(appUrl, t("web_what_link"));
  // copyable values in the steps (names and settings to type into GitHub/Cloudflare)
  else if (b.matches(".chip[data-copy]")) copyText(b.dataset.copy, `“${b.dataset.copy}”`);
});

// One step at a time; where you are is remembered, so going off to GitHub or Cloudflare and back keeps your place.
const STEP_KEY = "gytakusub.setupStep";
const stepItems = [...document.querySelectorAll("#wzSteps > li")];
function showStep(n) {
  const step = Math.max(1, Math.min(stepItems.length, n | 0));
  try { localStorage.setItem(STEP_KEY, String(step)); } catch { /* private mode */ }
  stepItems.forEach((li, i) => { li.classList.toggle("active", i + 1 === step); li.classList.toggle("done", i + 1 < step); });
  $("wzProgress").textContent = t("web_step", { step, total: stepItems.length });
  stepItems[step - 1].querySelector(".step-body").append($("wzStepNav")); // Back/Next sit right under the open step, not after the list
  $("wzBack").hidden = step === 1;
  $("wzNext").hidden = step === stepItems.length;
}
stepItems.forEach((li, i) => (li.querySelector(".step-title").onclick = () => showStep(i + 1)));
$("wzBack").onclick = () => showStep(Number(localStorage.getItem(STEP_KEY) || 1) - 1);
$("wzNext").onclick = () => {
  const step = Number(localStorage.getItem(STEP_KEY) || 1);
  if (step === 2 && !settings.fetcherKey) return toast(t("web_tap_generate"));
  showStep(step + 1);
  $("wzProgress").scrollIntoView({ block: "nearest" });
};
showStep(Number(localStorage.getItem(STEP_KEY) || 1));
async function connect(url, key, button, show) {
  show("", t("web_connecting")); button.disabled = true;
  try {
    const fields = await connectFetcher(url, key);
    settings = { ...settings, ...fields }; saveSettings(settings);
    show("ok", t("web_connected_version", { version: fields.fetcherCheck.version }));
    await applyChapterMode("ready");
    toast(t("web_connected_toast"));
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
  if (!shared) return show("err", t("web_not_a_link"));
  connect(shared.url, shared.key, $("wzLinkConnect"), show);
};
$("btnFetcherManage").onclick = () => applyChapterMode("manage");
$("liveCheck").onclick = (e) => checkLive(e.currentTarget);
$("liveCheck2").onclick = (e) => checkLive(e.currentTarget);
$("mgDone").onclick = () => applyChapterMode("ready");
$("mgSetup").onclick = () => applyChapterMode("wizard");
$("mgCopyLink").onclick = () => copyText(connectionLink(settings), t("web_wzLink_arialabel"));
$("mgForget").onclick = async () => {
  if (!confirm(t("web_confirm_forget"))) return;
  settings = { ...settings, fetcherUrl: "", fetcherKey: "", fetcherCheck: null }; saveSettings(settings);
  $("wzUrl").value = ""; $("wzKeyInput").value = ""; wizardMsg("", "");
  await applyChapterMode("wizard");
};

// ---------- boot ----------

// ---------- install (Home Screen / app) ----------

const INSTALL_LATER = "gytakusub.installLater";
const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);
const isPhone = isIOS || isAndroid;
let installPrompt = null; // Chrome/Edge/Brave/Samsung offer this; Safari and Firefox don't
const appUrl = location.origin + location.pathname;

function renderInstall(force = false) {
  const card = $("installCard");
  let later = false; try { later = !!localStorage.getItem(INSTALL_LATER); } catch { /* private mode */ }
  if (installed || (later && !force)) { card.classList.add("hidden"); return; }
  const show = isIOS ? ["ios"] : [installPrompt ? "prompt" : isAndroid ? "android" : "", isPhone ? "" : "desktop"].filter(Boolean);
  card.dataset.show = show.join(" ");
  if (show.includes("desktop") && !$("installQr").firstChild) {
    const q = qrcode(0, "M"); q.addData(appUrl); q.make();
    $("installQr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  $("installUrl").textContent = appUrl.replace(/^https:\/\//, "");
  $("installDesktopHint").hidden = !!installPrompt;
  card.classList.remove("hidden");
}
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
addEventListener("appinstalled", () => { installPrompt = null; $("installCard").classList.add("hidden"); toast(t("web_installed")); });
$("btnInstall").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null; renderInstall();
};
$("btnInstallLater").onclick = () => {
  try { localStorage.setItem(INSTALL_LATER, "1"); } catch { /* private mode */ }
  $("installCard").classList.add("hidden");
  if (!settings.apiKey) { fillSettings(); dlg.showModal(); }
};
$("btnShowInstall").onclick = () => { dlg.close(); renderInstall(true); $("installCard").scrollIntoView({ block: "start" }); };
renderInstall();

// A connection link (#connect=…) fills in a fetcher address and key; the user checks the address and taps Connect.
const shared = readConnectionLink(location.hash);
if (shared) history.replaceState(null, "", location.pathname + location.search); // don't leave the key in the address bar
await applyChapterMode();
if (shared) {
  setMode("chapter");
  await applyChapterMode("wizard");
  $("wzLink").value = location.origin + location.pathname + "#connect=…";
  $("wzUrl").value = shared.url; $("wzKeyInput").value = shared.key;
  wizardMsg("", t("web_link_filled", { address: shared.url }));
  showStep(6); $("wzStep5").scrollIntoView({ block: "center" });
}
// ?chapter=<link> (the bookmarklet in fetcher/README.md) fills in that chapter; it opens on a tap of Load, so a link
// someone else sent can't make the fetcher visit a site or spend Claude credits by itself.
const linked = new URLSearchParams(location.search).get("chapter");
if (linked && !shared) { setMode("chapter"); $("chapterUrl").value = linked; $("chapterInfo").textContent = chapterView === "ready" ? t("web_tap_load") : t("web_setup_waiting"); }
// First visit: on a phone that hasn't installed the app yet, installing comes first (on iPhone the installed app
// keeps its own settings, so a key typed in Safari would not be there); otherwise ask for the Claude key.
const installFirst = isPhone && !installed && !$("installCard").classList.contains("hidden");
if (!settings.apiKey && !installFirst) setTimeout(() => { fillSettings(); dlg.showModal(); }, 400);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

/** The app in the target language's words, without a reload: messages, then everything drawn from code. */
async function speak() {
  await loadLocale(uiLocaleFor(settings.targetLang), readMessages);
  applyI18n(document);
  labelsNote();
  fillLanguages(); showModelHint();
  for (const p of pages) applyI18n(p.el);
  if (settings.fetcherKey) $("wzGen").textContent = t("web_new_key");
  showStep(Number(localStorage.getItem(STEP_KEY) || 1));
  showGuideChecked();
  renderInstall();
  showClaudeUsage();
  await applyChapterMode(chapterView);
  updateToolbar();
}
updateToolbar();
