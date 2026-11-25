// Reads and writes storage directly, never through the service worker (which may
// be busy analysing a page for seconds; see settings.js) — and Save stays off
// until the stored settings are on screen, so it can never write the form's
// empty defaults over them.
import { getSettings } from "./settings.js";
import { apiHeaders, API_URL } from "./prompt.js";
import { consentGiven, withdrawConsent, hasAccess, requestAccess, ALL_SITES, openWelcome } from "./access.js";
import { addCall, emptyLog, limitsOf, explainApiError, usageView, dayStart, PRICES_CHECKED, PRICE_SOURCE } from "./usage.js";
import { t, langTag } from "./i18n.js";
import { useLanguageOf } from "./locale.js";
import { languageOptions, findLanguage } from "./languages.js";

const $ = (id) => document.getElementById(id);
const FIELDS = ["model", "glossary", "customPrompt", "fontFamily", "excludedSites"];
const OTHER = "__other";
const CHECKS = ["useContext", "uppercase", "syncApiKey", "debugOverlay", "peekOnHover", "useGpu", "learnedMask"];

function show(kind, text) {
  const m = $("msg");
  m.className = kind;
  m.textContent = text;
}

let loaded = false;
let dirty = false;

/** Unsaved edits are shown next to Save, and leaving the page asks first. */
function markDirty(on) {
  dirty = on;
  if (on) show("dirty", t("opt_unsaved"));
}

// Target language: the list (languages.js), or "Other…" with a name typed in
function fillLanguages() {
  const keep = $("targetLang").value;
  $("targetLang").replaceChildren(...languageOptions().map(({ value, label }) => new Option(label, value)), new Option(t("opt_other_language"), OTHER));
  if (keep) $("targetLang").value = keep;
}
function setTargetLang(value) {
  const listed = findLanguage(value);
  $("targetLang").value = listed ? listed.name : OTHER;
  $("targetLangOther").value = listed ? "" : value || "";
  $("targetLangOther").hidden = !!listed;
}
const targetLangValue = () => ($("targetLang").value === OTHER ? $("targetLangOther").value.trim() || "English" : $("targetLang").value);
$("targetLang").addEventListener("change", () => {
  $("targetLangOther").hidden = $("targetLang").value !== OTHER;
  if (!$("targetLangOther").hidden) $("targetLangOther").focus();
});

async function load() {
  const s = await getSettings();
  for (const f of FIELDS) $(f).value = s[f] ?? "";
  setTargetLang(s.targetLang);
  for (const c of CHECKS) $(c).checked = !!s[c];
  $("autoSites").value = (s.autoSites || []).join("\n");
  $("enabledSites").value = (s.enabledSites || []).join("\n");
  $("apiKey").value = s.apiKey || "";
  loaded = true;
  for (const id of ["save", "testKey"]) $(id).disabled = false;
  markDirty(false);
}

async function save() {
  if (!loaded) throw new Error(t("opt_loading"));
  const sync = {};
  for (const f of FIELDS) sync[f] = $(f).value;
  sync.targetLang = targetLangValue();
  for (const c of CHECKS) sync[c] = $(c).checked;
  const hosts = (v) => v.split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean);
  sync.autoSites = hosts($("autoSites").value);
  sync.enabledSites = [...new Set([...hosts($("enabledSites").value), ...sync.autoSites])];
  const key = $("apiKey").value.trim();

  // Key storage: local by default; optionally in browser sync so other devices get it.
  if (sync.syncApiKey) {
    await chrome.storage.sync.set({ apiKey: key });
    await chrome.storage.local.remove("apiKey");
  } else {
    await chrome.storage.local.set({ apiKey: key });
    await chrome.storage.sync.remove("apiKey");
  }
  await chrome.storage.sync.set(sync);
  dirty = false;
  show("ok", t("opt_saved"));
}

// ---------- Claude usage (usage.js), written by the service worker as pages are translated ----------
function showUsage(log) {
  const v = usageView(log?.v === 1 ? log : emptyLog());
  $("cuTodayCost").textContent = v.today.cost; $("cuTodaySub").textContent = v.today.sub;
  $("cuMonthLabel").textContent = v.month.label;
  $("cuMonthCost").textContent = v.month.cost; $("cuMonthSub").textContent = v.month.sub;
  $("cuModels").replaceChildren(...v.models.map((m) => {
    const li = document.createElement("li");
    const name = document.createElement("span"); name.className = "model-name"; name.textContent = m.label;
    const cost = document.createElement("span"); cost.className = "model-cost"; cost.textContent = m.cost;
    const what = document.createElement("span"); what.className = "model-what"; what.textContent = m.sub;
    li.append(name, cost, what);
    return li;
  }));
  $("cuModels").hidden = !v.models.length;
  $("cuTodayTokens").textContent = v.today.tokens; $("cuMonthTokens").textContent = v.month.tokens;
  $("cuLimits").hidden = !v.limits;
  $("cuLimits").textContent = v.limits;
  lastLog = log;
  $("cuChecked").textContent = new Date(PRICES_CHECKED + "T00:00:00Z").toLocaleDateString(langTag(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  $("cuPriceLink").href = PRICE_SOURCE;
  $("cuDayStart").textContent = dayStart();
}
let lastLog = null;
// the rate-limit line goes stale after five minutes without an answer
setInterval(() => chrome.storage.local.get({ claudeUsage: null }).then(({ claudeUsage }) => showUsage(claudeUsage)), 60e3);
$("cuClear").onclick = async () => {
  if (!confirm(t("opt_confirm_clear_usage"))) return;
  await chrome.storage.local.set({ claudeUsage: emptyLog() });
  show(dirty ? "dirty" : "ok", dirty ? t("opt_unsaved") : t("opt_usage_cleared"));
};

$("save").onclick = () => save().catch((e) => show("err", e.message));
$("showKey").onclick = () => {
  const i = $("apiKey");
  i.type = i.type === "password" ? "text" : "password";
  $("showKey").textContent = i.type === "password" ? t("opt_show") : t("opt_hide");
  $("showKey").setAttribute("aria-pressed", String(i.type !== "password"));
};
$("testKey").onclick = async () => {
  await save();
  show("ok", t("opt_testing"));
  try {
    const s = await getSettings();
    if (!s.apiKey) throw new Error(t("opt_no_key_saved"));
    const res = await fetch(API_URL, { method: "POST", headers: apiHeaders(s.apiKey), body: JSON.stringify({ model: s.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK" }] }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const hint = explainApiError(res.status, j); throw new Error(`${res.status}: ${j?.error?.message || res.statusText}${hint ? " " + hint : ""}`); }
    // the test costs a few tokens too
    const { claudeUsage } = await chrome.storage.local.get({ claudeUsage: null });
    await chrome.storage.local.set({ claudeUsage: addCall(claudeUsage?.v === 1 ? claudeUsage : emptyLog(), { model: j.model || s.model, usage: j.usage, limits: limitsOf(res.headers) }) });
    show("ok", t("opt_key_works", { model: s.model }));
  } catch (e) { show("err", t("opt_key_failed", { error: e.message })); }
};
$("clearCache").onclick = async () => {
  if (!confirm(t("opt_confirm_clear_cache"))) return;
  await chrome.storage.session.clear();
  show("ok", dirty ? t("opt_cache_cleared_unsaved") : t("opt_cache_cleared"));
};

document.querySelector("main").addEventListener("input", () => { if (loaded) markDirty(true); });
// The popup can change settings while this page is open: show them, unless that would lose edits here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.claudeUsage) showUsage(changes.claudeUsage.newValue);
  if ((area === "sync" || (area === "local" && changes.apiKey)) && loaded && !dirty) load().catch(() => {});
  if (area === "sync" && changes.targetLang) speak(changes.targetLang.newValue); // saved here, in the popup or on the setup page
});
addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); $("save").click(); }
});

// Side nav (wide windows): it stays on screen while the page scrolls (options.html) and marks
// the section you're reading: the last one whose top has passed 30% of the window, or the
// last section at the bottom of the page. A section picked in the nav (or by the link that
// opened this page) stays marked while it is on screen, even if the page can't scroll it to the top.
const tocLinks = [...document.querySelectorAll(".toc a")];
const tocSections = tocLinks.map((a) => document.querySelector(a.getAttribute("href")));
let pickedSection = tocSections.findIndex((sec) => sec && "#" + sec.id === location.hash);
function markSection() {
  const picked = tocSections[pickedSection];
  if (picked) { const r = picked.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight) pickedSection = -1; }
  let current = 0;
  if (pickedSection >= 0) current = pickedSection;
  else if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = tocSections.length - 1;
  else tocSections.forEach((sec, i) => { if (sec && sec.getBoundingClientRect().top <= innerHeight * 0.3) current = i; });
  tocLinks.forEach((a, i) => { if (i === current) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current"); });
}
tocLinks.forEach((a, i) => a.addEventListener("click", () => { pickedSection = i; requestAnimationFrame(markSection); }));
let tocFrame = 0;
addEventListener("scroll", () => { if (!tocFrame) tocFrame = requestAnimationFrame(() => { tocFrame = 0; markSection(); }); }, { passive: true });
addEventListener("resize", markSection);
markSection();

for (const id of ["save", "testKey"]) $(id).disabled = true;
// About: the agreement (welcome.html) and site access, each with the one action that changes it
async function showPrivacy() {
  const [{ consent }, agreed, access] = await Promise.all([chrome.storage.local.get("consent"), consentGiven(), hasAccess()]);
  const when = agreed ? new Date(consent.at).toLocaleDateString(langTag(), { day: "numeric", month: "long", year: "numeric" }) : "";
  $("consentDesc").textContent = agreed ? t("opt_consent_agreed", { date: when }) : t("opt_consent_none");
  $("consentBtn").textContent = agreed ? t("opt_withdraw") : t("opt_review_agree");
  $("consentBtn").hidden = false;
  $("accessDesc").textContent = access ? t("opt_access_allowed") : t("opt_access_none");
  $("accessBtn").dataset.allowed = String(access);
  $("accessBtn").textContent = access ? t("opt_remove_access") : t("opt_allow_access");
  $("accessBtn").disabled = !access && !agreed; // as on the setup page: agree first
  $("accessBtn").title = $("accessBtn").disabled ? t("opt_agree_first") : "";
  $("accessBtn").hidden = false;
}
$("consentBtn").onclick = async () => { if (await consentGiven()) { await withdrawConsent(); showPrivacy(); } else openWelcome(); };
// asking must be the first call in the click (the browser's rule for permission prompts)
$("accessBtn").onclick = () => {
  const wasAllowed = $("accessBtn").dataset.allowed === "true";
  (wasAllowed ? chrome.permissions.remove(ALL_SITES) : requestAccess()).finally(showPrivacy);
};
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.consent) showPrivacy(); });
chrome.permissions.onAdded.addListener(showPrivacy);
chrome.permissions.onRemoved.addListener(showPrivacy);

/** The whole page in the target language: the marked text, then everything code writes. */
async function speak(targetLang) {
  await useLanguageOf(targetLang, document);
  document.title = t("opt_gytakusub_settings");
  fillLanguages();
  $("save").title = t("opt_save_title", { key: /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘S" : "Ctrl+S" });
  $("showKey").textContent = $("apiKey").type === "password" ? t("opt_show") : t("opt_hide");
  $("version").textContent = chrome.runtime.getManifest().version;
  if (dirty) show("dirty", t("opt_unsaved"));
  showUsage(lastLog);
  showPrivacy();
}

await speak((await getSettings()).targetLang);
chrome.storage.local.get({ claudeUsage: null }).then(({ claudeUsage }) => showUsage(claudeUsage));
load().then(markSection, (e) => show("err", t("opt_cannot_read", { error: e.message }))); // the filled-in form changes section heights
