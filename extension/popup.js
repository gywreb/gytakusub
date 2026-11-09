// The popup talks to storage and to the tab's content script directly: the
// service worker may be busy analysing a page for seconds (see settings.js), and
// the popup must show the real settings the moment it opens.
import { getSettings, ensureContentScript } from "./settings.js";

const $ = (id) => document.getElementById(id);

let tab = null; // the active tab, when it is a web page

/** A message to the content script in the active tab (injecting it first if asked). */
async function relay(payload, inject = false) {
  if (!tab) return { error: "Not a web page" };
  try {
    if (inject) await ensureContentScript(tab.id);
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (e) { return { error: e.message }; }
}

let currentHost = null;

async function init() {
  const [s, [active]] = await Promise.all([getSettings(), chrome.tabs.query({ active: true, currentWindow: true })]);
  $("nokey").hidden = !!s.apiKey;
  $("enabled").checked = !!s.enabled;
  showEnabled(!!s.enabled);
  $("model").value = s.model;
  $("useContext").checked = !!s.useContext;
  $("exportReport").hidden = !s.debugOverlay;

  tab = active && /^https?:/.test(active.url || "") ? active : null;
  try { currentHost = tab ? new URL(tab.url).hostname : null; } catch { currentHost = null; }
  if (!currentHost) {
    $("site").disabled = $("auto").disabled = $("translate").disabled = $("toggle").disabled = true;
    $("host").textContent = "this page";
    $("state").textContent = "Not a web page.";
    document.body.classList.add("ready");
    return;
  }
  $("host").textContent = currentHost;
  $("site").checked = (s.enabledSites || []).includes(currentHost) || (s.autoSites || []).includes(currentHost);
  $("auto").checked = (s.autoSites || []).includes(currentHost);
  document.body.classList.add("ready");

  const st = await relay({ type: "GET_STATE" });
  if (st && !st.error) {
    $("state").textContent = st.excluded
      ? `${st.host} is in your disabled-sites list.`
      : `${st.done} translated${st.working ? `, ${st.working} in progress` : ""}${st.hidden ? " (hidden)" : ""}`;
  } else {
    $("state").textContent = $("site").checked
      ? "Reload the tab to activate Gytakusub here."
      : "Not active on this page yet. Translate still works.";
  }
}

/** The master switch: while it is off, the popup shows only that (plus the key notice and the footer). */
function showEnabled(on) {
  document.body.classList.toggle("off", !on);
  $("enabledText").textContent = on ? "On" : "Off";
}

/** The real shortcuts: people can change or remove them at chrome://extensions/shortcuts. */
async function showShortcuts() {
  const commands = await chrome.commands.getAll().catch(() => []);
  const key = (name) => commands.find((c) => c.name === name)?.shortcut || "";
  $("kbdTranslate").textContent = key("translate-visible");
  $("kbdTranslate").hidden = !key("translate-visible");
  $("toggle").title = "Hide / show translations" + (key("toggle-overlays") ? ` (${key("toggle-overlays")})` : "");
}

async function setSiteLists(host, { enabled, auto }) {
  const { enabledSites = [], autoSites = [] } = await chrome.storage.sync.get({ enabledSites: [], autoSites: [] });
  const upd = (list, on) => (on ? [...new Set([...list, host])] : list.filter((h) => h !== host));
  await chrome.storage.sync.set({ enabledSites: upd(enabledSites, enabled), autoSites: upd(autoSites, auto) });
}

$("enabled").onchange = async (e) => {
  await chrome.storage.sync.set({ enabled: e.target.checked });
  showEnabled(e.target.checked);
};
$("translate").onclick = async () => { const r = await relay({ type: "TRANSLATE_VISIBLE" }, true); if (r?.error) $("state").textContent = r.error; else window.close(); };
$("toggle").onclick = async () => { await relay({ type: "TOGGLE_OVERLAYS" }); init(); };
$("exportReport").onclick = async () => {
  const b = $("exportReport"); b.disabled = true; b.textContent = "Preparing…";
  const r = await relay({ type: "EXPORT_REPORT" });
  b.disabled = false; b.textContent = "Export debug report";
  if (r?.error) $("state").textContent = "Export failed: " + r.error;
  else if (r?.ok) $("state").textContent = `Report downloaded: ${r.pages} page${r.pages > 1 ? "s" : ""}`;
};
$("model").onchange = (e) => chrome.storage.sync.set({ model: e.target.value });
$("useContext").onchange = (e) => chrome.storage.sync.set({ useContext: e.target.checked });
$("site").onchange = async (e) => {
  if (!currentHost) return;
  const on = e.target.checked;
  if (!on) $("auto").checked = false;
  await setSiteLists(currentHost, { enabled: on, auto: on && $("auto").checked });
  if (on) await relay({ type: "PING" }, true).catch(() => {}); // inject now so it works without a reload
  init();
};
$("auto").onchange = async (e) => {
  if (!currentHost) return;
  const on = e.target.checked;
  if (on) $("site").checked = true;
  await setSiteLists(currentHost, { enabled: $("site").checked, auto: on });
  if (on) await relay({ type: "PING" }, true).catch(() => {});
  init();
};
$("openOptions").onclick = () => chrome.runtime.openOptionsPage();
$("openOptions2").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

showShortcuts();
init().finally(() => document.body.classList.add("ready"));
