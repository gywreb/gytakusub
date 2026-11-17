// What a new user agrees to, and the one permission Gytakusub asks for at first use.
//
// Consent: the Chrome Web Store asks that an extension handling user data (page images
// are "website content") disclose what it sends where, in its own interface, and get the
// user's affirmative consent first (Program Policies, user data FAQ). welcome.html shows
// the disclosure; the user's "I agree" is stored here, and the worker translates nothing
// until it is. CONSENT_VERSION goes up when what is sent changes, so people are asked again.
//
// Access: manga sites often load their pages from other servers, so reading a page's
// images needs access to sites Gytakusub can't know in advance. It is optional in the
// manifest (no warning at install) and asked for once, from a click, with the reason shown
// first. People can take it back at chrome://extensions; the popup then offers it again.

export const CONSENT_VERSION = 1;
export const ALL_SITES = Object.freeze({ origins: ["<all_urls>"] });
export const WELCOME_PAGE = "welcome.html";

export async function consentGiven() {
  const { consent } = await chrome.storage.local.get("consent");
  return (consent?.version || 0) >= CONSENT_VERSION;
}

export async function giveConsent() {
  await chrome.storage.local.set({ consent: { version: CONSENT_VERSION, at: new Date().toISOString() } });
}

export async function withdrawConsent() {
  await chrome.storage.local.remove("consent");
}

export const hasAccess = () => chrome.permissions.contains(ALL_SITES);

/**
 * Shows Chrome's permission prompt. Call it first thing in a click handler, before any
 * await: Chrome shows the prompt only during a user gesture.
 * @returns {Promise<boolean>} granted
 */
export const requestAccess = () => chrome.permissions.request(ALL_SITES);

/** Opens the setup page, or brings forward the one already open (no pile of tabs). */
export async function openWelcome(hash = "") {
  const url = chrome.runtime.getURL(WELCOME_PAGE);
  const open = (await chrome.runtime.getContexts?.({ contextTypes: ["TAB"] }).catch(() => []) || []).find((c) => c.documentUrl?.startsWith(url) && c.tabId >= 0);
  if (open) {
    await chrome.tabs.update(open.tabId, { active: true });
    if (open.windowId >= 0) await chrome.windows.update(open.windowId, { focused: true }).catch(() => {});
    return;
  }
  await chrome.tabs.create({ url: url + hash });
}
