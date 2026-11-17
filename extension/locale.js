// The extension's side of i18n.js: messages come from the extension's own _locales/ folder, and the
// interface's language follows the target language (languages.js).
import { loadLocale, applyI18n } from "./i18n.js";
import { uiLocaleFor } from "./languages.js";

export const readExtensionJson = async (path) => (await fetch(chrome.runtime.getURL(path))).json();

/** Loads the interface language for `targetLang` and, with a `root`, fills its marked elements. */
export async function useLanguageOf(targetLang, root = null) {
  const locale = await loadLocale(uiLocaleFor(targetLang), readExtensionJson);
  if (root) applyI18n(root);
  return locale;
}
