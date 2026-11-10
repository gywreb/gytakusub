// Gytakusub Web – UI.
import { loadSettings, saveSettings, loadImage, blobToDataUrl, translateImage, renderPage, testKey } from "./translator.js";
import { isConnected, connectFetcher, loadChapter, fetchPageImage, generateKey, connectionLink, readConnectionLink, fetcherBase, usageToday, onUsage, resetTime, FREE_DAILY, loadCloudUsage } from "./fetcher-client.js";
import { MODELS } from "./prompt.js";
import { summary, fmtUsd, fmtTokens, dayStart, PRICES_CHECKED, PRICE_SOURCE, CREDIT_PLANS, creditStatus, creditWords, limitWords } from "./usage.js";
import { readClaudeUsage, onClaudeUsage, clearClaudeUsage } from "./claude-usage.js";
import qrcode from "./lib/qrcode.mjs";

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
    $("manageStatus").textContent = `Connected to ${where}, version ${settings.fetcherCheck.version}, checked ${new Date(settings.fetcherCheck.at).toLocaleDateString()}.`;
    showUsage();
    if (chapterView === "manage") refreshLive(true);
  }
  if (chapterView === "wizard") {
    if (!$("wzUrl").value && settings.fetcherUrl) $("wzUrl").value = settings.fetcherUrl;
    if (!$("wzKeyInput").value && settings.fetcherKey) $("wzKeyInput").value = settings.fetcherKey;
    if (settings.fetcherKey) { $("wzKey").textContent = settings.fetcherKey; $("wzCopyKey").disabled = false; $("wzGen").textContent = "New key"; }
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
  const n = (x) => x.toLocaleString(), time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const device = usageToday(fetcherBase(settings.fetcherUrl));
  const cloud = live.data, isLive = !!cloud;
  const requests = isLive ? cloud.requests : device.requests, limit = (isLive && cloud.limit) || FREE_DAILY;
  const share = Math.min(1, requests / limit), warn = share >= 0.8;
  // the state in words too, not only in red
  const state = share >= 1 ? `used up until ${resetTime()}` : warn ? "almost used up" : "";
  const figure = `${isLive ? "" : "≈"}${n(requests)} / ${n(limit)}`;
  $("fetcherUsage").textContent = share >= 1 ? `free requests ${state}` : (state ? `${figure} · ${state}` : `${figure} free today`);
  $("btnFetcherManage").classList.toggle("warn", warn);
  $("btnFetcherManage").title = isLive ? `Cloudflare's count, ${time(cloud.asOf)}` : "Estimated from this device";
  $("usageSource").textContent = isLive ? `Cloudflare · ${time(cloud.asOf)}` : "This device";
  $("usageSource").classList.toggle("live", isLive);
  $("usageState").textContent = state ? state[0].toUpperCase() + state.slice(1) : "";
  $("usageState").hidden = !state;
  $("usageCount").textContent = n(requests);
  $("usageMax").textContent = n(limit);
  const meter = $("usageMeter");
  meter.setAttribute("aria-valuemax", limit);
  meter.setAttribute("aria-valuenow", Math.min(requests, limit));
  meter.setAttribute("aria-valuetext", `${n(requests)} of ${n(limit)} requests used today${isLive ? "" : ", estimated from this device"}`);
  meter.classList.toggle("warn", warn);
  meter.classList.toggle("used", requests > 0);
  meter.firstElementChild.style.width = `${share * 100}%`;
  if (isLive) {
    const others = cloud.workers.slice(1).reduce((t, w) => t + w.requests, 0);
    const split = cloud.workers.length > 1 ? `${cloud.workers[0].name} ${n(cloud.workers[0].requests)}, other Workers ${n(others)} · ` : "";
    $("usageNote").textContent = `${split}All your devices · starts again at ${resetTime()}`;
  } else {
    $("usageNote").textContent = `Sent from this device · ${n(device.chapters)} chapter${device.chapters === 1 ? "" : "s"} (about 2 requests a page) · starts again at ${resetTime()}`;
  }
  document.querySelectorAll("[data-usage=device]").forEach((el) => (el.hidden = isLive));
  document.querySelectorAll("[data-usage=live]").forEach((el) => (el.hidden = !isLive));
  $("usageReset").textContent = resetTime();
  $("liveSetup").hidden = live.state !== "setup";
  $("liveUpdate").hidden = live.state !== "old";
  $("liveError").hidden = live.state !== "error";
  $("liveError").textContent = live.state === "error" ? `Cloudflare's count didn't update: ${live.error}${cloud ? ` Showing the count from ${time(cloud.asOf)}.` : ""}` : "";
}
onUsage(showUsage);
async function checkLive(button) {
  button.disabled = true; $("liveMsg").textContent = "Checking…";
  await refreshLive(true);
  button.disabled = false;
  $("liveMsg").textContent = live.state === "live" ? "" : live.state === "setup" ? "Not yet: the Worker has no CF_API_TOKEN and CF_ACCOUNT_ID secrets (after adding them, click Deploy)." : "";
  if (live.state === "live") toast("Live count from Cloudflare is on.");
}

// ---------- Claude usage (usage.js): what this browser's translations cost ----------
function showClaudeUsage(log = readClaudeUsage()) {
  const { today, month, limits } = summary(log);
  const line = (t) => (t.requests ? `${t.requests.toLocaleString()} request${t.requests === 1 ? "" : "s"} · ${fmtTokens(t.input + t.read + t.write)} in · ${fmtTokens(t.output)} out` : "No requests yet");
  const usd = (t) => (t.unpriced && !t.cost ? "—" : `${t.cost ? "≈" : ""}${fmtUsd(t.cost)}`);
  $("cuTodayCost").textContent = usd(today);
  $("cuTodaySub").textContent = line(today);
  $("cuMonthLabel").textContent = new Date().toLocaleDateString([], { month: "long", timeZone: "UTC" });
  $("cuMonthCost").textContent = usd(month);
  $("cuMonthSub").textContent = line(month);
  $("cuModels").replaceChildren(...month.models.map((m) => {
    const li = document.createElement("li");
    const name = document.createElement("span"); name.className = "model-name"; name.textContent = m.label;
    const what = document.createElement("span"); what.className = "model-what"; what.textContent = line(m);
    const cost = document.createElement("span"); cost.className = "model-cost"; cost.textContent = m.unpriced && !m.cost ? "price unknown" : `≈${fmtUsd(m.cost)}`;
    li.append(name, cost, what);
    return li;
  }));
  $("cuModels").hidden = !month.models.length;
  const speed = limitWords(limits);
  $("cuLimits").hidden = !speed;
  $("cuLimits").textContent = speed;
  showCredit(log);
  $("cuChecked").textContent = new Date(PRICES_CHECKED + "T00:00:00Z").toLocaleDateString([], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  $("cuPriceLink").href = PRICE_SOURCE;
  $("cuDayStart").textContent = dayStart();
  updateToolbar();
}
onClaudeUsage(showClaudeUsage);
// The monthly API credit, with the form's values while Settings is open (a preview before Save).
function creditSettings() {
  return $("settings").open ? { creditPlan: $("sCreditPlan").value, creditCustom: $("sCreditCustom").value, creditRenews: $("sCreditRenews").value } : settings;
}
function showCredit(log = readClaudeUsage()) {
  const c = creditStatus(log, creditSettings());
  $("cuCredit").hidden = !c;
  if (!c) return;
  const w = creditWords(c);
  $("cuCreditFigure").textContent = w.headline;
  $("cuCreditState").textContent = w.state; $("cuCreditState").hidden = !w.state;
  $("cuCreditLeft").textContent = w.left;
  $("cuCreditPace").textContent = w.pace;
  const m = $("cuCreditMeter");
  m.setAttribute("aria-valuenow", Math.round(c.share * 100));
  m.setAttribute("aria-valuetext", `${w.headline}. ${w.left}.`);
  m.classList.toggle("warn", !!w.state); m.classList.toggle("used", c.used > 0);
  m.firstElementChild.style.width = `${c.share * 100}%`;
}
$("sCreditPlan").innerHTML = CREDIT_PLANS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
for (const id of ["sCreditPlan", "sCreditCustom", "sCreditRenews"]) $(id).addEventListener("input", () => { $("sCreditCustomField").hidden = $("sCreditPlan").value !== "custom"; showCredit(); });
$("cuClear").onclick = () => {
  if (!confirm("Clear this browser's Claude usage history? The Claude Console keeps its own records.")) return;
  clearClaudeUsage(); toast("Usage history cleared");
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
  const credit = creditStatus(readClaudeUsage(), settings);
  $("progress").textContent = `${done} of ${list.length} translated${busy ? ` · ${busy} in progress` : ""}${today.requests ? ` · Claude today ≈ ${fmtUsd(today.cost)}` : ""}${credit ? ` · ≈${fmtUsd(credit.left)} credit left` : ""}`;
  $("pages").classList.toggle("spread", list.length > 1);
  $("pages").classList.toggle("rtl", !!settings.rtlSpreads);
}

// ---------- pages ----------

function addPage({ img, url, referer, file, mode = currentMode }) {
  const el = document.createElement("article");
  el.className = "page"; el.dataset.mode = mode;
  el.innerHTML = `<div class="page-media"></div><div class="page-bar"><span class="status" role="status">queued</span><div class="page-actions"><button type="button" data-act="toggle" aria-pressed="false">Original</button><button type="button" data-act="redo">Redo</button><button type="button" data-act="save">Save</button></div></div>`;
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
      page.media.append(page.img);
    }
    setStatus(page, "translating…");
    const [result] = await Promise.all([
      translateImage(page.img, settings, settings.useContext ? ctx : { terms: [], recent: [] }),
      document.fonts?.load('700 20px "Gytakusub Comic"').catch(() => null), // bundled lettering font
    ]);
    if (settings.useContext) ctx = result.ctx;
    const { original, translated, drawn } = renderPage(page.img, result, settings);
    original.className = "original"; translated.className = "translated";
    page.media.querySelectorAll("canvas").forEach((c) => c.remove());
    page.img.remove();
    page.media.prepend(original, translated);
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

function clearPages(mode = currentMode) {
  if (mode === "chapter") { io?.disconnect(); io = null; }
  for (let k = queue.length - 1; k >= 0; k--) if (queue[k].mode === mode) queue.splice(k, 1);
  for (let k = pages.length - 1; k >= 0; k--) if (pages[k].mode === mode) { pages[k].el.remove(); pages.splice(k, 1); }
  updateToolbar();
}
$("btnClear").onclick = () => { clearPages(); ctx = { terms: [], recent: [] }; if (currentMode === "chapter") { showNav({}); history.replaceState(null, "", location.pathname); } };
$("showOriginal").onchange = (e) => modePages().forEach((p) => p.showOriginal(e.target.checked));

// ---------- settings ----------

const dlg = $("settings");
$("sModel").innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");
function fillSettings() {
  showClaudeUsage();
  $("sApiKey").value = settings.apiKey; $("sModel").value = settings.model; $("sTargetLang").value = settings.targetLang;
  $("sGlossary").value = settings.glossary; $("sCustomPrompt").value = settings.customPrompt;
  $("sUseContext").checked = settings.useContext; $("sUppercase").checked = settings.uppercase; $("sRtl").checked = settings.rtlSpreads;
  $("sCreditPlan").value = settings.creditPlan || "none"; $("sCreditCustom").value = settings.creditCustom || ""; $("sCreditRenews").value = settings.creditRenews || "";
  $("sCreditCustomField").hidden = $("sCreditPlan").value !== "custom";
  $("sMsg").textContent = "";
}
function readSettings() {
  return { ...settings, apiKey: $("sApiKey").value.trim(), model: $("sModel").value, targetLang: $("sTargetLang").value.trim() || "English",
    glossary: $("sGlossary").value, customPrompt: $("sCustomPrompt").value, useContext: $("sUseContext").checked,
    uppercase: $("sUppercase").checked, rtlSpreads: $("sRtl").checked,
    creditPlan: $("sCreditPlan").value, creditCustom: Number($("sCreditCustom").value) || 0, creditRenews: $("sCreditRenews").value };
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
document.querySelectorAll("#fetcherWizard .chip, #fetcherManage .chip").forEach((b) => (b.onclick = () => copyText(b.dataset.copy, `“${b.dataset.copy}”`)));

// One step at a time; where you are is remembered, so going off to GitHub or Cloudflare and back keeps your place.
const STEP_KEY = "gytakusub.setupStep";
const stepItems = [...document.querySelectorAll("#wzSteps > li")];
function showStep(n) {
  const step = Math.max(1, Math.min(stepItems.length, n | 0));
  try { localStorage.setItem(STEP_KEY, String(step)); } catch { /* private mode */ }
  stepItems.forEach((li, i) => { li.classList.toggle("active", i + 1 === step); li.classList.toggle("done", i + 1 < step); });
  $("wzProgress").textContent = `Step ${step} of ${stepItems.length}`;
  stepItems[step - 1].querySelector(".step-body").append($("wzStepNav")); // Back/Next sit right under the open step, not after the list
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
$("liveCheck").onclick = (e) => checkLive(e.currentTarget);
$("liveCheck2").onclick = (e) => checkLive(e.currentTarget);
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
    $("installUrl").textContent = appUrl.replace(/^https:\/\//, "");
  }
  $("installDesktopHint").hidden = !!installPrompt;
  card.classList.remove("hidden");
}
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; renderInstall(); });
addEventListener("appinstalled", () => { installPrompt = null; $("installCard").classList.add("hidden"); toast("Installed. Open Gytakusub from your home screen or app list."); });
$("btnInstall").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null; renderInstall();
};
$("btnCopyAppLink").onclick = () => copyText(appUrl, "Link");
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
  wizardMsg("", `A connection link filled in the fetcher at ${shared.url}. If you trust it, tap Connect.`);
  showStep(6); $("wzStep5").scrollIntoView({ block: "center" });
}
// ?chapter=<link> (the bookmarklet in fetcher/README.md) fills in that chapter; it opens on a tap of Load, so a link
// someone else sent can't make the fetcher visit a site or spend Claude credits by itself.
const linked = new URLSearchParams(location.search).get("chapter");
if (linked && !shared) { setMode("chapter"); $("chapterUrl").value = linked; $("chapterInfo").textContent = chapterView === "ready" ? "Tap Load to open this chapter." : "Set up chapter links below; this chapter will be waiting."; }
// First visit: on a phone that hasn't installed the app yet, installing comes first (on iPhone the installed app
// keeps its own settings, so a key typed in Safari would not be there); otherwise ask for the Claude key.
const installFirst = isPhone && !installed && !$("installCard").classList.contains("hidden");
if (!settings.apiKey && !installFirst) setTimeout(() => { fillSettings(); dlg.showModal(); }, 400);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
updateToolbar();
