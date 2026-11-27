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
  uppercase: false,
  fontFamily: "",
  syncApiKey: false,
  excludedSites: "",
  debugOverlay: false, // draw detection boxes and log results (for diagnosing placement)
  useGpu: true, // run the page models on the GPU (WebGPU) when the browser offers one; CPU otherwise
  // the eraser finds lettering with the learned text mask where the rules are weak (engine/textmask.js,
  // ADR 0022). On by default from 3.4 (ADR 0026): a new name, so the "off" every saved Options page
  // wrote under the old one (learnedMask, a preview off by default) doesn't keep it off
  learnedTextMask: true,
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
export const CS_FILES = ["vendor/hyphen-en.js", "vendor/lettering-fonts.js", "text.js", "notpage.js", "content.js"];

/** Injects the content script into a tab unless it already answers. */
export async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (r?.ok) return true;
  } catch { /* not injected */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: CS_FILES });
  return true;
}
