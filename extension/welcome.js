// The setup page: opened on install (and on an update when the agreement is missing).
// Step 1 is the disclosure and the agreement Chrome Web Store policy asks for; step 3 asks
// for site access inside the click, which is the only time the browser allows it.
import { CONSENT_VERSION, giveConsent, hasAccess, requestAccess } from "./access.js";
import { getSettings } from "./settings.js";
import { t, langTag } from "./i18n.js";
import { useLanguageOf } from "./locale.js";
import { languageOptions, findLanguage } from "./languages.js";

const $ = (id) => document.getElementById(id);

const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(langTag(), { day: "numeric", month: "long", year: "numeric" }); } catch { return ""; } };

/** This page in the target language: the static text, then everything refresh() writes. */
async function speak(targetLang) {
  await useLanguageOf(targetLang, document);
  document.title = t("welcome_set_up_gytakusub");
  $("lede").textContent = location.hash === "#update" ? t("welcome_lede_update") : t("welcome_lede");
  showShortcut();
  await refresh();
}

function mark(step, done, text) {
  $(step).classList.toggle("done", done);
  $(step).querySelector(".step-state").textContent = text;
}

/** Reads the three facts and shows them; called on load and whenever one of them changes. */
async function refresh() {
  const [{ consent }, s, access] = await Promise.all([chrome.storage.local.get("consent"), getSettings(), hasAccess()]);
  const agreed = (consent?.version || 0) >= CONSENT_VERSION;
  mark("stepConsent", agreed, agreed ? t("welcome_state_agreed") : "");
  $("agree").hidden = agreed;
  $("consentHint").textContent = agreed ? t("welcome_hint_agreed", { date: fmtDate(consent.at) }) : t("welcome_hint_not_agreed");

  mark("stepKey", !!s.apiKey, s.apiKey ? t("welcome_state_key") : "");
  $("openKey").textContent = s.apiKey ? t("welcome_change_key") : t("welcome_open_settings");

  mark("stepAccess", access, access ? t("welcome_state_allowed") : "");
  $("allow").hidden = access;
  $("allow").disabled = !agreed;
  $("accessHint").textContent = access ? t("welcome_hint_access_remove") : agreed ? "" : t("welcome_hint_agree_first");

  $("allSet").hidden = !(agreed && s.apiKey && access);
}

// The button you pressed hides itself; move focus to the next thing to do, so keyboard and
// screen-reader users aren't left on nothing.
async function focusNext() {
  if (!$("allSet").hidden) $("allSet").focus();
  else if (!$("allow").hidden && !$("allow").disabled && $("stepKey").classList.contains("done")) $("allow").focus();
  else $("openKey").focus();
}
$("agree").onclick = async () => { await giveConsent(); await refresh(); focusNext(); };
$("openKey").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html#sec-api") });
// requestAccess must be the first call in the click: the browser shows its prompt only during one
$("allow").onclick = () => {
  requestAccess().then((ok) => {
    refresh().then(() => {
      if (ok) focusNext();
      else $("accessHint").textContent = t("welcome_not_allowed");
    });
  }, (e) => { $("accessHint").textContent = e.message; });
};

chrome.storage.onChanged.addListener((changes) => { if (changes.consent || changes.apiKey) refresh(); });
chrome.permissions.onAdded.addListener(refresh);
chrome.permissions.onRemoved.addListener(refresh);

/** The real shortcut where the text names it (people can change or remove it at chrome://extensions/shortcuts). */
function showShortcut() {
  chrome.commands.getAll().then((commands) => {
    const key = commands.find((c) => c.name === "translate-visible")?.shortcut;
    for (const el of document.querySelectorAll(".kbdTranslate")) { if (key) el.textContent = key; else el.replaceWith(t("welcome_translate_shortcut")); }
  }).catch(() => {});
}

// The language to translate into, first: it decides this page's language too
function showTarget(targetLang) {
  const listed = findLanguage(targetLang);
  $("targetLang").replaceChildren(...languageOptions().map(({ value, label }) => new Option(label, value)));
  if (!listed) $("targetLang").prepend(new Option(targetLang, targetLang)); // a language typed under "Other" in Settings
  $("targetLang").value = listed?.name || targetLang;
}
const s0 = await getSettings();
showTarget(s0.targetLang);
$("targetLang").onchange = async (e) => {
  await chrome.storage.sync.set({ targetLang: e.target.value });
  await speak(e.target.value);
};
// changed in Settings while this page is open
chrome.storage.onChanged.addListener((changes, area) => {
  const next = area === "sync" && changes.targetLang?.newValue;
  if (next && next !== $("targetLang").value) { showTarget(next); speak(next); }
});
await speak(s0.targetLang);
