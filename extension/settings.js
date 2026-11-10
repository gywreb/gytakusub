// Settings and content-script injection, shared by the service worker and the
// extension's own pages (popup, options). ES module.
//
// The pages read and write chrome.storage themselves instead of asking the
// service worker: the worker runs the page engine on its one thread (seconds
// of WebAssembly per page, back to back while auto-translate reads a chapter),
// and a message sent meanwhile waits until it is done. A settings page that
// waits for the worker shows its HTML defaults in the meantime — and an
// options page saved in that state writes those defaults over the user's
// settings.

export const DEFAULT_SETTINGS = {
  enabled: true, // master switch
  model: "claude-haiku-5-5",
  targetLang: "English",
  glossary: "",
  customPrompt: "",
  enabledSites: [], // hostnames where the content script is injected (hover button + hotkeys)
  autoSites: [], // hostnames where auto-translate-on-scroll is on (implies enabled)
  useContext: true, // feed recent dialogue from this tab into each request
  includeSource: false, // ask the model to transcribe the original too (slower)
  uppercase: false,
  fontFamily: "",
  syncApiKey: false,
  excludedSites: "",
  debugOverlay: false, // draw detection boxes and log results (for diagnosing placement)
  useGpu: true, // run the page models on the GPU (WebGPU) when the browser offers one; CPU otherwise
  creditPlan: "none", // a Max or Team plan's monthly Claude API credit (usage.js CREDIT_PLANS)
  creditCustom: 0, // USD a month, for creditPlan "custom"
  creditRenews: "", // YYYY-MM-DD, from the Console's Billing page
  peekOnHover: false, // hovering a translated bubble shows the original lettering (off by default: it flickers while reading)
  // Image prep
  maxLongEdge: 1600, // px sent to Claude for a normal page
  stripWidth: 1000, // px width for tall webtoon strips
  sliceHeight: 1800, // px per slice for tall strips
};

/** The settings with defaults filled in; the API key from local storage, or from sync if the user chose that. */
export async function getSettings() {
  const [synced, local] = await Promise.all([chrome.storage.sync.get({ ...DEFAULT_SETTINGS, apiKey: "" }), chrome.storage.local.get({ apiKey: "" })]);
  return { ...DEFAULT_SETTINGS, ...synced, apiKey: local.apiKey || synced.apiKey || "" };
}

/** The content script's files, in load order. */
export const CS_FILES = ["vendor/hyphen-en.js", "text.js", "content.js"];

/** Injects the content script into a tab unless it already answers. */
export async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (r?.ok) return true;
  } catch { /* not injected */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: CS_FILES });
  return true;
}
