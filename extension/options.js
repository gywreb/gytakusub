// Reads and writes storage directly, never through the service worker (which may
// be busy analysing a page for seconds; see settings.js) — and Save stays off
// until the stored settings are on screen, so it can never write the form's
// empty defaults over them.
import { getSettings } from "./settings.js";
import { apiHeaders, API_URL } from "./prompt.js";

const $ = (id) => document.getElementById(id);
const FIELDS = ["model", "targetLang", "glossary", "customPrompt", "fontFamily", "excludedSites"];
const CHECKS = ["useContext", "includeSource", "uppercase", "syncApiKey", "debugOverlay", "peekOnHover", "useGpu"];

function show(kind, text) {
  const m = $("msg");
  m.className = kind;
  m.textContent = text;
}

let loaded = false;

async function load() {
  const s = await getSettings();
  for (const f of FIELDS) $(f).value = s[f] ?? "";
  for (const c of CHECKS) $(c).checked = !!s[c];
  $("autoSites").value = (s.autoSites || []).join("\n");
  $("enabledSites").value = (s.enabledSites || []).join("\n");
  $("apiKey").value = s.apiKey || "";
  loaded = true;
  for (const id of ["save", "testKey"]) $(id).disabled = false;
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
  show("ok", "Saved.");
}

$("save").onclick = () => save().catch((e) => show("err", e.message));
$("showKey").onclick = () => {
  const i = $("apiKey");
  i.type = i.type === "password" ? "text" : "password";
  $("showKey").textContent = i.type === "password" ? "Show" : "Hide";
};
$("testKey").onclick = async () => {
  await save();
  show("ok", "Testing…");
  try {
    const s = await getSettings();
    if (!s.apiKey) throw new Error("No API key saved yet.");
    const res = await fetch(API_URL, { method: "POST", headers: apiHeaders(s.apiKey), body: JSON.stringify({ model: s.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK" }] }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(`${res.status}: ${j?.error?.message || res.statusText}`); }
    show("ok", `Key works. Model ${s.model} responded.`);
  } catch (e) { show("err", "Key test failed: " + e.message); }
};
$("clearCache").onclick = async () => {
  await chrome.storage.session.clear();
  show("ok", "Cache cleared.");
};

for (const id of ["save", "testKey"]) $(id).disabled = true;
load().catch((e) => show("err", "Could not read the settings: " + e.message));
