// The setup page: opened on install (and on an update when the agreement is missing).
// Step 1 is the disclosure and the agreement Chrome Web Store policy asks for; step 3 asks
// for site access inside the click, which is the only time the browser allows it.
import { CONSENT_VERSION, giveConsent, hasAccess, requestAccess } from "./access.js";
import { getSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);

if (location.hash === "#update") {
  $("lede").textContent = "Gytakusub now asks before it reads any page. Please look at what is sent and agree, to keep translating.";
}

const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); } catch { return ""; } };

function mark(step, done, text) {
  $(step).classList.toggle("done", done);
  $(step).querySelector(".step-state").textContent = text;
}

/** Reads the three facts and shows them; called on load and whenever one of them changes. */
async function refresh() {
  const [{ consent }, s, access] = await Promise.all([chrome.storage.local.get("consent"), getSettings(), hasAccess()]);
  const agreed = (consent?.version || 0) >= CONSENT_VERSION;
  mark("stepConsent", agreed, agreed ? "Agreed" : "");
  $("agree").hidden = agreed;
  $("consentHint").textContent = agreed
    ? `You agreed on ${fmtDate(consent.at)}. You can withdraw any time in Settings → About.`
    : "Nothing is sent until you agree. You can withdraw any time in Settings → About.";

  mark("stepKey", !!s.apiKey, s.apiKey ? "Key saved" : "");
  $("openKey").textContent = s.apiKey ? "Change key" : "Open settings";

  mark("stepAccess", access, access ? "Allowed" : "");
  $("allow").hidden = access;
  $("allow").disabled = !agreed;
  $("accessHint").textContent = access
    ? "You can remove this any time in Settings → About, or on the browser's extensions page."
    : agreed ? "" : "Agree to step 1 first.";

  $("allSet").hidden = !(agreed && s.apiKey && access);
}

$("agree").onclick = async () => { await giveConsent(); refresh(); };
$("openKey").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html#sec-api") });
// requestAccess must be the first call in the click: the browser shows its prompt only during one
$("allow").onclick = () => {
  requestAccess().then((ok) => {
    if (!ok) $("accessHint").textContent = "Not allowed. Gytakusub can't read manga images until you allow it.";
    refresh();
  }, (e) => { $("accessHint").textContent = e.message; });
};

chrome.storage.onChanged.addListener((changes) => { if (changes.consent || changes.apiKey) refresh(); });
chrome.permissions.onAdded.addListener(refresh);
chrome.permissions.onRemoved.addListener(refresh);

chrome.commands.getAll().then((commands) => {
  const key = commands.find((c) => c.name === "translate-visible")?.shortcut;
  for (const el of document.querySelectorAll(".kbdTranslate")) { if (key) el.textContent = key; else el.replaceWith("the Translate shortcut"); }
}).catch(() => {});

refresh();
