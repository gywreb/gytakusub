# ADR 0010: A language list, and an interface that follows it

Status: accepted (2.8.0). Date: 2026-11-17.

## Context

Until 2.7.0 the target language was a text box. People had to know to type "Vietnamese" (or "Tiếng Việt", or "vietnamese"), and the prompt passed whatever they typed to Claude. The interface itself was English only, so a reader who wants Vietnamese translations had to set it up in English.

Two requests from the owner: pick the language from a list, and have the extension's own pages switch to that language too.

**What Chrome gives an extension** (sources at the end):
- `chrome.i18n.getMessage()` reads `_locales/<locale>/messages.json`, picking the locale from the browser's own UI language. An extension can't choose another one at run time. A `setLanguage` API has been proposed to the W3C WebExtensions group (issue 258); it isn't available.
- Chromium developers' advice for an in-extension switch: load the messages yourself, or use a JS i18n library.
- `_locales` folders must be locales the Chrome Web Store supports.

## Decision

**The list (`languages.js`, shared with the web app):**
- 19 target languages, each with the English name (what the prompt says and what settings store) and its own name (what the dropdown shows: "Tiếng Việt · Vietnamese").
- "Other…" keeps a text box for anything else. Old free-text values still match ("Portuguese" → Portuguese (Brazil), "Chinese" → Simplified).
- Not listed: Thai and right-to-left scripts. My reasoning, not a source: `text.js` wraps lines at spaces, or between characters for Chinese and Japanese. Thai has no spaces between words and needs dictionary-based breaking; Arabic, Hebrew and Persian need right-to-left lettering. Neither exists yet, so listing them would promise pages we draw badly.
- A fresh install starts with the browser's own language when it's on the list (`chrome.i18n.getUILanguage()`), else English.

**The interface (`i18n.js`, `locale.js`, `_locales/`):**
- Ten interface languages: English, Vietnamese, Spanish, Portuguese (Brazil), Indonesian, French, German, Chinese (Simplified), Japanese, Korean. The interface follows the target language when it has a translation; otherwise it stays English. The owner chose these ten; more wait for requests from readers.
- Messages are in Chrome's own format (`_locales/<locale>/messages.json`), so the manifest's description and shortcut descriptions can use `__MSG_…__` too, and the browser shows those in its own language. The pages load them with our own loader, because `chrome.i18n` can't follow the target language. English is always loaded underneath, so a missing message shows English, never a key.
- Markup: `data-i18n` (text), `data-i18n-html` (a little markup: `b i em strong kbd code br a span`, parsed with `DOMParser`, links only to https or the extension's own files), `data-i18n-attr="placeholder=key;title=key"`. `{name}` placeholders; plurals by `Intl.PluralRules` with `key_one` / `key_other`.
- The worker says its errors in the target language too. Errors carry a `code` (`no-access`, `network`, `http-NNN`) so code never matches on wording.
- The page script can't read the extension's files from inside someone else's page, so the worker sends its `content_*` messages with the settings (`GET_SETTINGS`), and again when the language changes.
- Open pages follow a change straight away: Settings, the setup page and the overlay on a manga page all listen for it.
- `<html lang>` names the language, so screen readers pronounce it right. Japanese breaks lines between phrases (`word-break: auto-phrase`, Chrome 119+, needs `lang="ja"`); Korean breaks between words (`keep-all`), as it is written with spaces.
- Console labels stay in English ("Billing → Spend limits", "Settings → API keys"): that's what the Claude Console shows.
- Chrome's permission prompt is paraphrased, not quoted: its exact wording in each language is Chrome's, and it can change.

**Translation quality:**
- Written by Claude (Opus 5.5), not by native speakers, and none has had a native speaker's review yet. The owner reads Vietnamese, so that one can be checked first.
- Checked by machine: `scripts/check-i18n.mjs` (every locale has every English key, the same placeholders, the same markup and link targets, no stray `$`), and `tests/browser/i18n.mjs` (every label in the right language, no key on screen, nothing clipped or spilling sideways, `lang` set, live switching, the worker and the overlay).
- That test found two real problems before release: the setup page didn't follow a language change made in Settings, and the popup's model dropdown cut its labels off: in six languages here, and in seven of the ten (English too) on CI's wider Linux fonts. The dropdown now shows only the model names, with the chosen one's description underneath.
- Corrections come from readers: a "Translation fix" issue form.

## Alternatives considered

- **Follow the browser's language (plain `chrome.i18n`).** Zero code, but a Vietnamese reader on an English browser gets English, and it can't follow the target language. Kept only for the manifest strings and the first-install default.
- **A separate "interface language" setting.** More flexible, one more choice for everyone. People who translate into a language almost always read it; an English interface is one "Other…" away. Can be added later without breaking anything.
- **A JS i18n library (i18next and similar).** Plurals and formatting we already get from `Intl`; it would add a dependency and a second message format beside the one the manifest needs.
- **Translate the web app's interface in the same release.** It shares the loader and the files (synced into `web/`), but its Cloudflare setup guide is long and quotes Cloudflare's own screens. Next release (2.9.0); 2.8.0 gives it the same language list.

## Consequences

- Every new or changed English string needs nine translations in the same pull request; the checker fails CI otherwise. Writing them with Claude and checking them with the browser test takes minutes; a native speaker's eye is still better.
- 272 messages × 10 languages add about 300 KB to the package before compression (measured: 301,594 bytes).
- `default_locale: "en"` in the manifest is now required by Chrome, because `_locales/` exists.

## Sources

- Chromium Extensions group, "localization in extension" (2021): with `chrome.i18n.getMessage()` an extension can't switch language; load the files yourself or use a library. https://groups.google.com/a/chromium.org/g/chromium-extensions/c/T-Eoy2r_ogU
- W3C WebExtensions issue 258, a proposed API for choosing an extension's language. https://github.com/w3c/webextensions/issues/258
- Chrome's `chrome.i18n` reference: supported locales, `default_locale`. https://developer.chrome.com/docs/extensions/reference/api/i18n
- Chrome blog, "Introducing four new international features in CSS": `word-break: auto-phrase` from Chrome 119, for `lang="ja"`. https://developer.chrome.com/blog/css-i18n-features
