const $ = (id) => document.getElementById(id);

async function relay(payload) {
  try { return await chrome.runtime.sendMessage({ type: "RELAY_TO_TAB", payload }); }
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

  const st = await relay({ type: "GET_STATE" });
  if (st && !st.error) {
    currentHost = st.host;
    $("host").textContent = st.host;
    $("auto").checked = (s.autoSites || []).includes(st.host);
    $("state").textContent = st.excluded
      ? `${st.host} is in your disabled-sites list.`
      : `${st.done} translated${st.working ? `, ${st.working} in progress` : ""}${st.hidden ? " (hidden)" : ""}`;
  } else {
    $("auto").disabled = true;
    $("state").textContent = "No Gytakusub on this page (browser pages, or reload the tab after installing).";
  }
}

$("enabled").onchange = async (e) => {
  await chrome.storage.sync.set({ enabled: e.target.checked });
  document.body.classList.toggle("off", !e.target.checked);
};
$("translate").onclick = async () => { await relay({ type: "TRANSLATE_VISIBLE" }); window.close(); };
$("toggle").onclick = async () => { await relay({ type: "TOGGLE_OVERLAYS" }); init(); };
$("model").onchange = (e) => chrome.storage.sync.set({ model: e.target.value });
$("useContext").onchange = (e) => chrome.storage.sync.set({ useContext: e.target.checked });
$("auto").onchange = async (e) => {
  if (!currentHost) return;
  const { autoSites = [] } = await chrome.storage.sync.get({ autoSites: [] });
  const next = e.target.checked ? [...new Set([...autoSites, currentHost])] : autoSites.filter((h) => h !== currentHost);
  await chrome.storage.sync.set({ autoSites: next });
};
$("openOptions").onclick = () => chrome.runtime.openOptionsPage();
$("openOptions2").onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

init();
