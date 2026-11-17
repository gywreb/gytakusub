// The languages Gytakusub translates into, shared by the extension and the web app.
//
// `name` is what the prompt tells Claude ("into Vietnamese"), and what settings store as
// targetLang. `native` is what the dropdown shows. `ui` is the folder in _locales/ when the
// interface itself is translated into that language; otherwise the interface stays in English.
//
// Only languages the page renderer handles well are listed: text.js wraps lines at spaces, or
// between characters for Chinese and Japanese. Thai (no spaces between words) and the right-to-
// left scripts (Arabic, Hebrew, Persian) need line breaking that doesn't exist yet; they can still
// be typed under "Other", at the reader's own risk.
export const LANGUAGES = [
  { name: "English", native: "English", ui: "en" },
  { name: "Vietnamese", native: "Tiếng Việt", ui: "vi" },
  { name: "Spanish", native: "Español", ui: "es" },
  { name: "Portuguese (Brazil)", native: "Português (Brasil)", ui: "pt_BR" },
  { name: "Indonesian", native: "Bahasa Indonesia", ui: "id" },
  { name: "French", native: "Français", ui: "fr" },
  { name: "German", native: "Deutsch", ui: "de" },
  { name: "Chinese (Simplified)", native: "简体中文", ui: "zh_CN" },
  { name: "Japanese", native: "日本語", ui: "ja" },
  { name: "Korean", native: "한국어", ui: "ko" },
  // translated into, with the interface in English for now
  { name: "Chinese (Traditional)", native: "繁體中文" },
  { name: "Italian", native: "Italiano" },
  { name: "Russian", native: "Русский" },
  { name: "Ukrainian", native: "Українська" },
  { name: "Polish", native: "Polski" },
  { name: "Turkish", native: "Türkçe" },
  { name: "Dutch", native: "Nederlands" },
  { name: "Filipino", native: "Filipino" },
  { name: "Malay", native: "Bahasa Melayu" },
];

export const UI_LOCALES = LANGUAGES.filter((l) => l.ui).map((l) => l.ui);

const norm = (s) => String(s || "").trim().toLowerCase();

/** The listed language for a stored targetLang ("vietnamese", "Tiếng Việt" and "Vietnamese" all match), or null. */
export function findLanguage(targetLang) {
  const t = norm(targetLang);
  if (!t) return null;
  return LANGUAGES.find((l) => norm(l.name) === t || norm(l.native) === t)
    // older free-text values: "Portuguese" for Portuguese (Brazil), "Chinese" for Simplified
    || LANGUAGES.find((l) => norm(l.name).startsWith(t + " (")) || null;
}

/** The interface locale (a folder in _locales/) for a target language: its own when translated, else English. */
export function uiLocaleFor(targetLang) {
  return findLanguage(targetLang)?.ui || "en";
}

// A browser or system locale ("vi", "pt-BR", "zh-TW") → the listed language, for a first default
const BY_LOCALE = {
  en: "English", vi: "Vietnamese", es: "Spanish", pt: "Portuguese (Brazil)", id: "Indonesian", in: "Indonesian",
  fr: "French", de: "German", zh: "Chinese (Simplified)", "zh-tw": "Chinese (Traditional)", "zh-hk": "Chinese (Traditional)",
  "zh-mo": "Chinese (Traditional)", "zh-hant": "Chinese (Traditional)", ja: "Japanese", ko: "Korean", it: "Italian", ru: "Russian",
  uk: "Ukrainian", pl: "Polish", tr: "Turkish", nl: "Dutch", fil: "Filipino", tl: "Filipino", ms: "Malay",
};
/** The listed language for a locale such as navigator.language or chrome.i18n.getUILanguage(), or null. */
export function languageForLocale(locale) {
  const l = String(locale || "").toLowerCase().replace("_", "-");
  const name = BY_LOCALE[l] || BY_LOCALE[l.split("-").slice(0, 2).join("-")] || BY_LOCALE[l.split("-")[0]];
  return name ? findLanguage(name) : null;
}

/** <option> data for a dropdown: [{value, label}], each language once, its own name first. */
export function languageOptions() {
  return LANGUAGES.map((l) => ({ value: l.name, label: l.native === l.name ? l.name : `${l.native} · ${l.name}` }));
}
