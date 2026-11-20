// The interface's own language, shared by the extension and the web app.
//
// The interface follows the target language (languages.js uiLocaleFor): read in Vietnamese, use
// it in Vietnamese. Messages live in _locales/<locale>/messages.json, Chrome's format, so the
// Chrome Web Store also uses them for the listing's name and summary. English is always loaded
// underneath, so a message a translation lacks shows in English rather than as a key.
//
// In a page: await loadLocale(code, reader) once, then applyI18n(document). Elements carry
//   data-i18n="key"            → textContent
//   data-i18n-html="key"       → a message with a little markup (b, i, kbd, code, a, br, span),
//                                rebuilt node by node from our own bundled files: no innerHTML
//   data-i18n-attr="placeholder=key;title=key;aria-label=key"
// and code uses t("key", {name: value}) for "{name}" in a message.

let messages = {}, fallback = {}, current = "en";

/**
 * Loads `locale` (with English underneath). `read(path)` returns the parsed JSON of a path such
 * as "_locales/vi/messages.json": fetch from the extension or the web app's folder.
 */
export async function loadLocale(locale, read) {
  const load = async (code) => {
    try { const raw = await read(`_locales/${code}/messages.json`); return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message])); }
    catch { return {}; }
  };
  if (!Object.keys(fallback).length) fallback = await load("en");
  messages = locale === "en" ? fallback : await load(locale);
  current = Object.keys(messages).length ? locale : "en";
  return current;
}

export const currentLocale = () => current;
/** Whether English (always underneath) has loaded: a failed read leaves it empty, to be tried again. */
export const localeLoaded = () => Object.keys(fallback).length > 0;
/** "pt_BR" → "pt-BR", for <html lang> and Intl. */
export const langTag = (locale = current) => locale.replace("_", "-");

/** The message for `key`, with "{name}" filled from `vars`; the key itself if no file has it. */
export function t(key, vars = {}) {
  const m = messages[key] ?? fallback[key];
  if (m == null) return key;
  return m.replace(/\$\$/g, "$").replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all));
}

/**
 * A message that depends on a count: "{key}_one", "{key}_few"… by the language's plural rules
 * (Intl.PluralRules), falling back to "{key}_other". `n` is also passed as {n}, formatted.
 */
export function tn(key, n, vars = {}) {
  let rule = "other";
  try { rule = new Intl.PluralRules(langTag()).select(n); } catch { /* unknown locale: "other" */ }
  const k = (messages[`${key}_${rule}`] ?? fallback[`${key}_${rule}`]) != null ? `${key}_${rule}` : `${key}_other`;
  return t(k, { n: Number(n).toLocaleString(langTag()), ...vars });
}

const INLINE = new Set(["B", "I", "EM", "STRONG", "KBD", "CODE", "BR", "A", "SPAN", "BUTTON"]); // BUTTON: the web app's copy chips inside its setup steps
const SAFE_HREF = /^(https:\/\/[^\s"<>]+|[\w-]+(\.\w+)?(#[\w-]+)?|#[\w-]+)$/; // https, or the extension's or app's own files ("options.html#sec-api", "LICENSE")

/**
 * A message with markup as DOM nodes: only INLINE tags, https or local links, plain ids and classes,
 * aria-hidden, and on buttons a title and a data-copy value (always type="button": no form submits).
 */
export function safeFragment(markup, doc = document) {
  const parsed = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  const frag = doc.createDocumentFragment();
  const copy = (from, into) => {
    for (const n of from.childNodes) {
      if (n.nodeType === 3) { into.append(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      if (!INLINE.has(n.tagName)) { copy(n, into); continue; } // anything else: just its text
      const el = doc.createElement(n.tagName.toLowerCase());
      for (const attr of ["id", "class"]) { const v = n.getAttribute(attr); if (v && /^[\w -]+$/.test(v)) el.setAttribute(attr, v); }
      if (n.getAttribute("aria-hidden") === "true") el.setAttribute("aria-hidden", "true");
      if (n.tagName === "BUTTON") {
        el.type = "button";
        const copyValue = n.getAttribute("data-copy"), title = n.getAttribute("title");
        if (copyValue && /^[\w .:/-]+$/.test(copyValue)) el.dataset.copy = copyValue;
        if (title) el.title = title;
      }
      if (n.tagName === "A") {
        const href = n.getAttribute("href") || "";
        if (SAFE_HREF.test(href)) el.setAttribute("href", href);
        if (/^https:/.test(href) || n.getAttribute("target") === "_blank") { el.target = "_blank"; el.rel = "noopener"; }
      }
      copy(n, el);
      into.append(el);
    }
  };
  copy(parsed.body, frag);
  return frag;
}

/** Puts the current language's messages into every marked element under `root`. */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.replaceChildren(safeFragment(t(el.dataset.i18nHtml), el.ownerDocument));
  for (const el of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split("=").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
  const html = root.documentElement || root.ownerDocument?.documentElement;
  if (html) html.lang = langTag();
}

/** The raw messages whose keys start with `prefix`, in the current language over English (for the content script). */
export function messagesWithPrefix(prefix) {
  const out = {};
  for (const [k, v] of Object.entries(fallback)) if (k.startsWith(prefix)) out[k] = v;
  for (const [k, v] of Object.entries(messages)) if (k.startsWith(prefix)) out[k] = v;
  return out;
}

/** For tests: the messages as loaded. */
export const _state = () => ({ messages, fallback, current });
