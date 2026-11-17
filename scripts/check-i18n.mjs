// Checks the interface translations against English, for the extension (extension/_locales) and
// the web app's own messages (web/locales; it also uses the extension's):
// every message present and no extra ones, the same {placeholders}, the same markup (tags with
// their ids, classes and links: translations may move them, not change them), message names
// Chrome accepts, and no bare "$" (Chrome's own placeholder sign; "$$" is a literal one).
// Also: every locale languages.js offers for the interface has a folder, and back.
// Usage: node scripts/check-i18n.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UI_LOCALES } from "../extension/languages.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const holes = (m) => [...m.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
const tags = (m) => [...m.matchAll(/<(\/?)([a-z]+)([^>]*)>/gi)].map(([, close, tag, attrs]) => {
  if (close) return `/${tag.toLowerCase()}`;
  const keep = [...attrs.matchAll(/\b(id|class|href|data-copy)="([^"]*)"/g)].map(([, a, v]) => `${a}=${v}`).sort().join(" ");
  return `${tag.toLowerCase()}${keep ? " " + keep : ""}`;
}).sort().join("|");

/** Every locale in `dir` against its English; `label` names the set in the report. */
function checkSet(dir, label) {
  const read = (loc) => JSON.parse(fs.readFileSync(path.join(dir, loc, "messages.json"), "utf8"));
  const en = read("en");
  const folders = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "messages.json")));
  for (const loc of UI_LOCALES) if (!folders.includes(loc)) problems.push(`${label} ${loc}: languages.js offers it, but ${loc}/ is missing`);
  for (const loc of folders) if (!UI_LOCALES.includes(loc)) problems.push(`${label} ${loc}: a folder languages.js doesn't offer`);
  for (const [k, v] of Object.entries(en)) {
    if (!/^[A-Za-z0-9_@]+$/.test(k)) problems.push(`${label} en: "${k}" isn't a name Chrome accepts`);
    if (/(^|[^$])\$([^$]|$)/.test(v.message.replace(/\$\$/g, ""))) problems.push(`${label} en: ${k} has a bare $`);
  }
  for (const loc of folders.filter((l) => l !== "en")) {
    const m = read(loc);
    for (const k of Object.keys(en)) {
      if (!(k in m)) { problems.push(`${label} ${loc}: ${k} is missing`); continue; }
      const a = en[k].message, b = m[k].message;
      if (typeof b !== "string" || !b.trim()) problems.push(`${label} ${loc}: ${k} is empty`);
      else {
        if (holes(a) !== holes(b)) problems.push(`${label} ${loc}: ${k} has placeholders {${holes(b)}}, English has {${holes(a)}}`);
        if (tags(a) !== tags(b)) problems.push(`${label} ${loc}: ${k} markup differs from English`);
        if (/\$/.test(b.replace(/\$\$/g, ""))) problems.push(`${label} ${loc}: ${k} has a bare $`);
      }
    }
    for (const k of Object.keys(m)) if (!(k in en)) problems.push(`${label} ${loc}: ${k} isn't in English (left over?)`);
  }
  return { read, folders, count: Object.keys(en).length };
}

const ext = checkSet(path.join(root, "extension", "_locales"), "extension");
const web = checkSet(path.join(root, "web", "locales"), "web");
// The manifest's description (__MSG_appDescription__) may be at most 132 characters, in every language.
for (const loc of ext.folders) {
  const d = ext.read(loc).appDescription?.message || "";
  if ([...d].length > 132) problems.push(`extension ${loc}: appDescription is ${[...d].length} characters; the manifest allows 132`);
}
// The web app's messages are its own: none may share a name with the extension's (it loads both).
const extKeys = new Set(Object.keys(ext.read("en")));
for (const k of Object.keys(web.read("en"))) if (extKeys.has(k)) problems.push(`web en: ${k} is also an extension message`);
if (problems.length) { console.log(problems.join("\n")); console.log(`I18N CHECK FAILED (${problems.length})`); process.exit(1); }
console.log(`i18n: ${ext.folders.length} locales × ${ext.count} extension messages and ${web.folders.length} × ${web.count} web app messages match English`);
