// Reads and writes storage directly, never through the service worker (which may
// be busy analysing a page for seconds; see settings.js) — and Save stays off
// until the stored settings are on screen, so it can never write the form's
// empty defaults over them.
import { getSettings } from "./settings.js";
import { apiHeaders, API_URL } from "./prompt.js";
import { addCall, emptyLog, limitsOf, explainApiError, summary, fmtUsd, fmtTokens, dayStart, PRICES_CHECKED, PRICE_SOURCE } from "./usage.js";

const $ = (id) => document.getElementById(id);
const FIELDS = ["model", "targetLang", "glossary", "customPrompt", "fontFamily", "excludedSites"];
const CHECKS = ["useContext", "includeSource", "uppercase", "syncApiKey", "debugOverlay", "peekOnHover", "useGpu"];

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
  if (on) show("dirty", "Unsaved changes");
}

async function load() {
  const s = await getSettings();
  for (const f of FIELDS) $(f).value = s[f] ?? "";
  for (const c of CHECKS) $(c).checked = !!s[c];
  $("autoSites").value = (s.autoSites || []).join("\n");
  $("enabledSites").value = (s.enabledSites || []).join("\n");
  $("apiKey").value = s.apiKey || "";
  loaded = true;
  for (const id of ["save", "testKey"]) $(id).disabled = false;
  markDirty(false);
}

async function save() {
  if (!loaded) throw new Error("Settings are still loading.");
  const sync = {};
  for (const f of FIELDS) sync[f] = $(f).value;
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
  show("ok", "Saved.");
}

// ---------- Claude usage (usage.js), written by the service worker as pages are translated ----------
function showUsage(log) {
  const { today, month, limits } = summary(log?.v === 1 ? log : emptyLog());
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
    const cost = document.createElement("span"); cost.className = "model-cost"; cost.textContent = m.unpriced && !m.cost ? "price unknown" : `≈${fmtUsd(m.cost)}`;
    const what = document.createElement("span"); what.className = "model-what"; what.textContent = line(m);
    li.append(name, cost, what);
    return li;
  }));
  $("cuModels").hidden = !month.models.length;
  const left = (x, unit) => (x ? `${fmtTokens(x.remaining)} of ${fmtTokens(x.limit)} ${unit}` : null);
  const parts = limits ? [left(limits.requests, "requests"), left(limits.inputTokens, "input tokens"), left(limits.outputTokens, "output tokens")].filter(Boolean) : [];
  $("cuLimits").hidden = !parts.length;
  $("cuLimits").textContent = parts.length ? `Rate limit left, from Claude's last answer (${new Date(limits.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}): ${parts.join(", ")}.` : "";
  $("cuChecked").textContent = new Date(PRICES_CHECKED + "T00:00:00Z").toLocaleDateString([], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  $("cuPriceLink").href = PRICE_SOURCE;
  $("cuDayStart").textContent = dayStart();
}
chrome.storage.local.get({ claudeUsage: null }).then(({ claudeUsage }) => showUsage(claudeUsage));
// the rate-limit line goes stale after five minutes without an answer
setInterval(() => chrome.storage.local.get({ claudeUsage: null }).then(({ claudeUsage }) => showUsage(claudeUsage)), 60e3);
$("cuClear").onclick = async () => {
  if (!confirm("Clear this browser's Claude usage history? The Claude Console keeps its own records.")) return;
  await chrome.storage.local.set({ claudeUsage: emptyLog() });
  show(dirty ? "dirty" : "ok", dirty ? "Unsaved changes" : "Usage history cleared.");
};

$("save").onclick = () => save().catch((e) => show("err", e.message));
$("showKey").onclick = () => {
  const i = $("apiKey");
  i.type = i.type === "password" ? "text" : "password";
  $("showKey").textContent = i.type === "password" ? "Show" : "Hide";
  $("showKey").setAttribute("aria-pressed", String(i.type !== "password"));
};
$("testKey").onclick = async () => {
  await save();
  show("ok", "Testing…");
  try {
    const s = await getSettings();
    if (!s.apiKey) throw new Error("No API key saved yet.");
    const res = await fetch(API_URL, { method: "POST", headers: apiHeaders(s.apiKey), body: JSON.stringify({ model: s.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK" }] }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const hint = explainApiError(res.status, j); throw new Error(`${res.status}: ${j?.error?.message || res.statusText}${hint ? " " + hint : ""}`); }
    // the test costs a few tokens too
    const { claudeUsage } = await chrome.storage.local.get({ claudeUsage: null });
    await chrome.storage.local.set({ claudeUsage: addCall(claudeUsage?.v === 1 ? claudeUsage : emptyLog(), { model: j.model || s.model, usage: j.usage, limits: limitsOf(res.headers) }) });
    show("ok", `Key works. Model ${s.model} responded.`);
  } catch (e) { show("err", "Key test failed: " + e.message); }
};
$("clearCache").onclick = async () => {
  if (!confirm("Clear the translated pages, the names found per tab and your edited lines?")) return;
  await chrome.storage.session.clear();
  show("ok", dirty ? "Cache cleared. Your other changes are not saved yet." : "Cache cleared.");
};

document.querySelector("main").addEventListener("input", () => { if (loaded) markDirty(true); });
// The popup can change settings while this page is open: show them, unless that would lose edits here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.claudeUsage) showUsage(changes.claudeUsage.newValue);
  if ((area === "sync" || (area === "local" && changes.apiKey)) && loaded && !dirty) load().catch(() => {});
});
addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); $("save").click(); }
});

$("save").title = /Mac|iPhone|iPad/.test(navigator.platform) ? "Save (⌘S)" : "Save (Ctrl+S)";
for (const id of ["save", "testKey"]) $(id).disabled = true;
load().catch((e) => show("err", "Could not read the settings: " + e.message));
