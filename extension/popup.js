const $ = (id) => document.getElementById(id);

async function relay(payload, inject = false) {
  try { return await chrome.runtime.sendMessage({ type: "RELAY_TO_TAB", payload, inject }); }
  catch (e) { return { error: e.message }; }
}

let currentHost = null;

async function init() {
  const s = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  $("nokey").style.display = s.apiKey ? "none" : "block";
  $("enabled").checked = !!s.enabled;
  document.body.classList.toggle("off", !s.enabled);
  $("model").value = s.model;
  $("useContext").checked = !!s.useContext;
  $("exportReport").style.display = s.debugOverlay ? "" : "none";

  const info = await chrome.runtime.sendMessage({ type: "ACTIVE_TAB_INFO" });
  currentHost = info?.host || null;
  if (!currentHost) {
    $("site").disabled = $("auto").disabled = $("translate").disabled = $("toggle").disabled = true;
    $("host").textContent = "this page";
    $("state").textContent = "Not a web page.";
    return;
  }
  $("host").textContent = currentHost;
  $("site").checked = (s.enabledSites || []).includes(currentHost) || (s.autoSites || []).includes(currentHost);
  $("auto").checked = (s.autoSites || []).includes(currentHost);

  const st = await relay({ type: "GET_STATE" });
  if (st && !st.error) {
    $("state").textContent = st.excluded
      ? `${st.host} is in your disabled-sites list.`
      : `${st.done} translated${st.working ? `, ${st.working} in progress` : ""}${st.hidden ? " (hidden)" : ""}`;
  } else {
    $("state").textContent = $("site").checked
      ? "Reload the tab to activate Gytakusub here."
      : "Not active on this page yet. \"Translate visible\" works anyway; enable the site for the hover button.";
  }
}

async function setSiteLists(host, { enabled, auto }) {
  const { enabledSites = [], autoSites = [] } = await chrome.storage.sync.get({ enabledSites: [], autoSites: [] });
  const upd = (list, on) => (on ? [...new Set([...list, host])] : list.filter((h) => h !== host));
  await chrome.storage.sync.set({ enabledSites: upd(enabledSites, enabled), autoSites: upd(autoSites, auto) });
}

$("enabled").onchange = async (e) => {
  await chrome.storage.sync.set({ enabled: e.target.checked });
  document.body.classList.toggle("off", !e.target.checked);
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

init();
