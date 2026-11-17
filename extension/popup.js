// The popup talks to storage and to the tab's content script directly: the
// service worker may be busy analysing a page for seconds (see settings.js), and
// the popup must show the real settings the moment it opens.
import { getSettings, ensureContentScript } from "./settings.js";
import { summary, fmtUsd } from "./usage.js";
import { consentGiven, hasAccess, requestAccess, openWelcome } from "./access.js";
import { t, tn } from "./i18n.js";
import { useLanguageOf } from "./locale.js";

const $ = (id) => document.getElementById(id);

let tab = null; // the active tab, when it is a web page

/** A message to the content script in the active tab (injecting it first if asked). */
async function relay(payload, inject = false) {
  if (!tab) return { error: t("popup_not_web_page") };
  try {
    if (inject) await ensureContentScript(tab.id);
    return await chrome.tabs.sendMessage(tab.id, payload);
  } catch (e) { return { error: e.message }; }
}

let currentHost = null;
let access = false; // site access (access.js), read on open so a click can ask for it straight away

/**
 * Asks for site access when it's missing. Call it first thing in a click handler: the browser
 * shows its prompt only during a click. The popup may close while the prompt is open; that's fine,
 * because the worker registers the enabled sites itself once access is given (permissions.onAdded).
 */
function ensureAccess() {
  if (access) return Promise.resolve(true);
  return requestAccess().then((ok) => { access = ok; if (ok) $("access").hidden = true; return ok; }, () => false);
}
const noAccess = () => t("popup_no_access");

async function init() {
  const [s, [active], agreed, acc] = await Promise.all([getSettings(), chrome.tabs.query({ active: true, currentWindow: true }), consentGiven(), hasAccess()]);
  access = acc;
  document.body.classList.toggle("setup", !agreed);
  $("nokey").hidden = !!s.apiKey;
  $("access").hidden = access || !s.apiKey; // one notice at a time (the popup can't grow past 600 px): the key first
  $("enabled").checked = !!s.enabled;
  showEnabled(!!s.enabled);
  $("model").value = s.model;
  $("useContext").checked = !!s.useContext;
  $("exportReport").hidden = !s.debugOverlay;

  tab = active && /^https?:/.test(active.url || "") ? active : null;
  try { currentHost = tab ? new URL(tab.url).hostname : null; } catch { currentHost = null; }
  if (!currentHost) {
    $("site").disabled = $("auto").disabled = $("translate").disabled = $("toggle").disabled = true;
    $("host").textContent = t("popup_this_page");
    $("state").textContent = t("popup_not_web_page");
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
      ? t("popup_state_excluded", { host: st.host })
      : tn("popup_state_translated", st.done) + (st.working ? t("popup_list_sep") + tn("popup_state_in_progress", st.working) : "") + (st.hidden ? " " + t("popup_state_hidden") : "");
  } else {
    $("state").textContent = !$("site").checked ? t("popup_not_active")
      : access ? t("popup_reload_tab")
      : t("popup_allow_above");
  }
}

/** The master switch: while it is off, the popup shows only that (plus the key notice and the footer). */
function showEnabled(on) {
  document.body.classList.toggle("off", !on);
  $("enabledText").textContent = on ? t("popup_on") : t("popup_off");
}

/** The real shortcuts: people can change or remove them at chrome://extensions/shortcuts. */
async function showShortcuts() {
  const commands = await chrome.commands.getAll().catch(() => []);
  const key = (name) => commands.find((c) => c.name === name)?.shortcut || "";
  $("kbdTranslate").textContent = key("translate-visible");
  $("kbdTranslate").hidden = !key("translate-visible");
  $("toggle").title = key("toggle-overlays") ? t("popup_toggle_title_key", { key: key("toggle-overlays") }) : t("popup_toggle_arialabel");
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
$("translate").onclick = async () => {
  if (!(await ensureAccess())) { $("state").textContent = noAccess(); return; }
  const r = await relay({ type: "TRANSLATE_VISIBLE" }, true);
  if (r?.error) $("state").textContent = r.error; else window.close();
};
$("toggle").onclick = async () => { await relay({ type: "TOGGLE_OVERLAYS" }); init(); };
$("exportReport").onclick = async () => {
  const b = $("exportReport"); b.disabled = true; b.textContent = t("popup_preparing");
  const r = await relay({ type: "EXPORT_REPORT" });
  b.disabled = false; b.textContent = t("popup_exportReport");
  if (r?.error) $("state").textContent = t("popup_export_failed", { error: r.error });
  else if (r?.ok) $("state").textContent = tn("popup_report_downloaded", r.pages);
};
$("model").onchange = (e) => chrome.storage.sync.set({ model: e.target.value });
$("useContext").onchange = (e) => chrome.storage.sync.set({ useContext: e.target.checked });
$("site").onchange = async (e) => {
  if (!currentHost) return;
  const on = e.target.checked;
  const asked = on ? ensureAccess() : Promise.resolve(true); // first, while the click still counts
  if (!on) $("auto").checked = false;
  await setSiteLists(currentHost, { enabled: on, auto: on && $("auto").checked });
  if (on && !(await asked)) { $("state").textContent = noAccess(); return; }
  if (on) await relay({ type: "PING" }, true).catch(() => {}); // inject now so it works without a reload
  init();
};
$("auto").onchange = async (e) => {
  if (!currentHost) return;
  const on = e.target.checked;
  const asked = on ? ensureAccess() : Promise.resolve(true);
  if (on) $("site").checked = true;
  await setSiteLists(currentHost, { enabled: $("site").checked, auto: on });
  if (on && !(await asked)) { $("state").textContent = noAccess(); return; }
  if (on) await relay({ type: "PING" }, true).catch(() => {});
  init();
};
$("openOptions").onclick = () => chrome.runtime.openOptionsPage();
$("openSetup").onclick = () => { openWelcome(); window.close(); };
$("allowAccess").onclick = () => { ensureAccess().then((ok) => { if (!ok) $("state").textContent = noAccess(); else init(); }); };
$("openOptions2").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

/** Today's Claude cost on this browser, next to the model (details: Settings → Claude usage). */
function showUsage(log) {
  const today = summary(log?.v === 1 ? log : null).today;
  $("usageToday").hidden = !today.requests;
  $("usageToday").textContent = today.requests ? t("popup_usage_today", { cost: fmtUsd(today.cost) }) : "";
  $("usageToday").setAttribute("aria-label", today.requests ? t("popup_usage_today_aria", { cost: fmtUsd(today.cost) }) : "");
}
$("usageToday").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html#sec-usage") });

// the interface speaks the target language (languages.js); everything below draws text with it
await useLanguageOf((await getSettings()).targetLang, document);
chrome.storage.local.get({ claudeUsage: null }).then(({ claudeUsage }) => showUsage(claudeUsage));
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.claudeUsage) showUsage(changes.claudeUsage.newValue); });
showShortcuts();
init().finally(() => document.body.classList.add("ready"));
