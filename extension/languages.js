// The languages Gytakusub translates into, shared by the extension and the web app.
//
// `name` is what the prompt tells Claude ("into Vietnamese"), and what settings store as
// targetLang. `native` is what the dropdown shows. `ui` is the folder in _locales/ when the
// interface itself is translated into that language; otherwise the interface stays in English.
// `tag` (BCP 47) picks the lettering: line breaking, upper case and, for Chinese, Japanese and
// Korean, the system font. `hyphen` names the hyphenation patterns in vendor/hyphen/ (English's
// are built into vendor/hyphen-en.js); languages without one are never hyphenated. Patterns are
// bundled only under permissive licences (vendor/hyphen/LICENSE-patterns.txt): Russian and
// Turkish (LPPL) and Indonesian (GPL-2.0) are left out, so those break at spaces only.
//
// Only languages the page renderer handles well are listed. text.js wraps lines at spaces, and
// between words for scripts written without them (Chinese, Japanese, Thai: Intl.Segmenter). The
// bundled fonts cover the Latin, Cyrillic, Vietnamese and Thai ones; Chinese, Japanese and Korean
// use the system's font. Right-to-left scripts (Arabic, Hebrew, Persian) aren't lettered right
// yet; they can still be typed under "Other", at the reader's own risk.
export const LANGUAGES = [
  { name: "English", native: "English", ui: "en", tag: "en", hyphen: "en-us" },
  { name: "Vietnamese", native: "Tiếng Việt", ui: "vi", tag: "vi" },
  { name: "Spanish", native: "Español", ui: "es", tag: "es", hyphen: "es" },
  { name: "Portuguese (Brazil)", native: "Português (Brasil)", ui: "pt_BR", tag: "pt-BR", hyphen: "pt" },
  { name: "Indonesian", native: "Bahasa Indonesia", ui: "id", tag: "id" },
  { name: "French", native: "Français", ui: "fr", tag: "fr", hyphen: "fr" },
  { name: "German", native: "Deutsch", ui: "de", tag: "de", hyphen: "de-1996" },
  { name: "Chinese (Simplified)", native: "简体中文", ui: "zh_CN", tag: "zh-Hans" },
  { name: "Japanese", native: "日本語", ui: "ja", tag: "ja" },
  { name: "Korean", native: "한국어", ui: "ko", tag: "ko" },
  // translated into, with the interface in English for now
  { name: "Chinese (Traditional)", native: "繁體中文", tag: "zh-Hant" },
  { name: "Italian", native: "Italiano", tag: "it", hyphen: "it" },
  { name: "Russian", native: "Русский", tag: "ru" },
  { name: "Ukrainian", native: "Українська", tag: "uk", hyphen: "uk" },
  { name: "Polish", native: "Polski", tag: "pl", hyphen: "pl" },
  { name: "Turkish", native: "Türkçe", tag: "tr" },
  { name: "Dutch", native: "Nederlands", tag: "nl", hyphen: "nl" },
  { name: "Filipino", native: "Filipino", tag: "fil" },
  { name: "Malay", native: "Bahasa Melayu", tag: "ms" },
  { name: "Thai", native: "ไทย", tag: "th" },
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

/** How to letter a target language: its BCP 47 tag and hyphenation patterns, or nulls for one typed under Other. */
export function letteringFor(targetLang) {
  const l = findLanguage(targetLang);
  return { lang: l?.tag || null, hyphen: l?.hyphen || null };
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
