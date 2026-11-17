// Interface languages (2.8.0): the setup page, Settings, the toolbar popup, the worker's messages
// and the words on the page all follow the target language, when it has a translation.
//   node browser/i18n.mjs [--out dir]
// What it checks, for each of the ten interface languages:
// - every marked element shows that language's message (not a key, not English by mistake);
// - <html lang> names the language, for screen readers and for line breaking;
// - nothing spills sideways, and no button or label clips its words (German runs long, CJK has
//   no spaces to wrap at);
// - no errors in the console.
// Then: changing the language updates open pages without a reload, the worker answers in the
// new language, the hover button's label on a manga page changes too, and a target language
// with no translation (or one typed under "Other") leaves the interface in English.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extensionCopy, agree } from "./ext-copy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/i18n"); fs.mkdirSync(out, { recursive: true });
const src = path.resolve(here, "../../extension");
const { LANGUAGES } = await import(path.join(src, "languages.js"));
const messages = (loc) => JSON.parse(fs.readFileSync(path.join(src, "_locales", loc, "messages.json"), "utf8"));
const tagOf = (loc) => loc.replace("_", "-");

const PORT = 8793, BASE = `http://127.0.0.1:${PORT}`;
const png = fs.readFileSync(path.join(here, "../fixtures/demo-page.png"));
const srv = http.createServer((q, r) => {
  if (q.url === "/page.png") { r.writeHead(200, { "Content-Type": "image/png" }); return r.end(png); }
  r.writeHead(200, { "Content-Type": "text/html" }); r.end(`<title>Chapter 1</title><body style="margin:0"><img src="/page.png" style="display:block;width:800px">`);
});
await new Promise((ok) => srv.listen(PORT, "127.0.0.1", ok));

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(env) {
  const ext = extensionCopy(src);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-")), {
    channel: process.env.GYT_CHANNEL || "chromium", headless: false, env: { ...process.env, ...env },
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1100,900"],
    viewport: { width: 1100, height: 900 },
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  return { ctx, sw, id: new URL(sw.url()).host };
}

const { ctx, sw, id } = await launch({});
await agree(sw);
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"] });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
const setTarget = (lang) => sw.evaluate((l) => chrome.storage.sync.set({ targetLang: l }), lang);

// What a page shows against what its language says it should. Elements a page fills in itself
// after the translation (a state line, a number) show something else on purpose; those are the
// ones whose message has a {placeholder} or that the page marks with an id it rewrites.
async function readPage(page) {
  return page.evaluate(() => {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const shown = [...document.querySelectorAll("[data-i18n]")].filter((e) => e.closest("[hidden]") == null).map((e) => ({ key: e.dataset.i18n, text: norm(e.textContent) }));
    const keysShown = [...document.querySelectorAll("[data-i18n],[data-i18n-html],option,button,label,h1,h2,p,li")]
      .map((e) => norm(e.textContent)).filter((s) => /^(popup|opt|welcome|usage|content|bg|api_err)_\w+$/.test(s));
    const de = document.documentElement;
    const sideways = de.scrollWidth > de.clientWidth + 1;
    // words cut off: a control narrower than its own text (overflow hidden or ellipsis)
    const clipped = [...document.querySelectorAll("button, label, .chip, .tab, nav a, select, kbd")]
      .filter((e) => e.offsetParent && e.closest("[hidden]") == null)
      .filter((e) => { const cs = getComputedStyle(e); return e.scrollWidth > e.clientWidth + 2 && (cs.overflow !== "visible" || cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap"); })
      .map((e) => norm(e.textContent).slice(0, 40));
    // a closed dropdown shows its chosen option on one line: each option must fit that line
    const ctx = document.createElement("canvas").getContext("2d");
    for (const sel of document.querySelectorAll("select")) {
      if (!sel.offsetParent || sel.closest("[hidden]")) continue;
      const cs = getComputedStyle(sel);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20; // the arrow
      for (const o of sel.options) if (ctx.measureText(o.text).width > room) clipped.push(`${sel.id}: "${o.text}"`);
    }
    return { lang: de.lang, shown, keysShown, sideways, clipped };
  });
}

const PAGES = [["welcome.html", 1000, 900, true], ["options.html", 1100, 900, true], ["popup.html", 340, 640, false]];
const SHOTS = new Set(["vi", "de", "ja", "ko"]);

// 1. each interface language, on each page
for (const lang of LANGUAGES.filter((l) => l.ui)) {
  const loc = lang.ui, want = messages(loc), en = messages("en");
  await setTarget(lang.name);
  for (const [file, w, h, full] of PAGES) {
    const page = await ctx.newPage(); await page.setViewportSize({ width: w, height: h });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/${file}`);
    await page.waitForFunction((tag) => document.documentElement.lang === tag, tagOf(loc), { timeout: 5000 }).catch(() => {});
    await wait(500);
    const r = await readPage(page);
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const wrong = r.shown.filter(({ key, text }) => want[key] && !/\{\w+\}/.test(want[key].message) && text !== norm(want[key].message));
    const english = loc === "en" ? [] : r.shown.filter(({ key, text }) => want[key] && en[key] && want[key].message !== en[key].message && text === norm(en[key].message));
    const what = `${loc} ${file}`;
    check(`${what}: <html lang> is ${tagOf(loc)}`, r.lang === tagOf(loc), r.lang);
    check(`${what}: ${r.shown.length} labels in the right language`, r.shown.length > 5 && !wrong.length && !english.length, [...wrong, ...english].slice(0, 4).map((x) => `${x.key}="${x.text.slice(0, 50)}"`).join("; "));
    check(`${what}: no message keys on screen`, !r.keysShown.length, r.keysShown.slice(0, 4).join(", "));
    check(`${what}: nothing spills sideways or clips`, !r.sideways && !r.clipped.length, [r.sideways ? "page scrolls sideways" : "", ...r.clipped].filter(Boolean).join("; "));
    check(`${what}: no console errors`, !errors.length, errors.slice(0, 2).join(" | "));
    if (SHOTS.has(loc)) {
      for (const scheme of ["light", "dark"]) {
        if (scheme === "dark" && file === "welcome.html") continue;
        await page.emulateMedia({ colorScheme: scheme }); await wait(250);
        await page.screenshot({ path: path.join(out, `${loc}-${file.replace(".html", "")}-${scheme}.png`), fullPage: full });
      }
    }
    await page.close();
  }
}

// 2. open pages follow a change of language without a reload
await setTarget("English");
const options = await ctx.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
await options.waitForFunction(() => document.documentElement.lang === "en");
const welcome = await ctx.newPage(); await welcome.goto(`chrome-extension://${id}/welcome.html`);
await welcome.waitForFunction(() => document.documentElement.lang === "en");
await welcome.selectOption("#targetLang", "Vietnamese"); // the setup page's picker saves at once
const vi = messages("vi");
const followed = await options.waitForFunction((save) => document.documentElement.lang === "vi" && document.querySelector('[data-i18n="opt_save"]')?.textContent.trim() === save, vi.opt_save.message, { timeout: 5000 }).then(() => true, () => false);
check("choosing Vietnamese on the setup page turns open Settings Vietnamese", followed);
const pickerKept = await options.evaluate(() => document.getElementById("targetLang").value);
check("Settings' dropdown shows the new target language", pickerKept === "Vietnamese", pickerKept);
await options.selectOption("#targetLang", "Japanese");
await options.click("#save");
const ja = messages("ja");
const back = await welcome.waitForFunction((h) => document.documentElement.lang === "ja" && document.querySelector('[data-i18n="welcome_h_consent"]')?.textContent.trim() === h, ja.welcome_h_consent.message, { timeout: 5000 }).then(() => true, () => false);
check("saving Japanese in Settings turns the open setup page Japanese", back);

// 3. the worker answers in the target language
const ask = (msg) => options.evaluate((m) => chrome.runtime.sendMessage(m), msg);
const settings = await ask({ type: "GET_SETTINGS" });
check("the page script gets its words in the target language", settings?.uiLang === "ja" && settings?.ui?.content_translate_image === ja.content_translate_image.message, `${settings?.uiLang} ${settings?.ui?.content_translate_image}`);
check("the page script never gets the key", settings && !("apiKey" in settings));
await sw.evaluate(() => chrome.storage.local.remove("consent"));
const refused = await ask({ type: "TRANSLATE", url: `${BASE}/page.png` });
check("the worker's refusal is in Japanese", refused?.error === ja.bg_not_set_up.message, refused?.error);
await agree(sw);

// 4. the hover button on a manga page (closed shadow root: read through the accessibility tree)
const reader = await ctx.newPage(); await reader.goto(`${BASE}/`);
const cdp = await ctx.newCDPSession(reader);
const buttonNamed = async (name) => {
  for (let i = 0; i < 25; i++) {
    await reader.mouse.move(400, 200); await reader.mouse.move(420, 260);
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    if (nodes.some((n) => n.role?.value === "button" && n.name?.value === name)) return true;
    await wait(200);
  }
  return false;
};
check("the hover button is labelled in Japanese", await buttonNamed(ja.content_translate_image.message));
const ko = messages("ko");
await setTarget("Korean");
check("…and in Korean once the target changes, without a reload", await buttonNamed(ko.content_translate_image.message));
await reader.close();

// 5. a target language with no interface translation, and one typed under "Other"
for (const [lang, picker] of [["Italian", "Italian"], ["Klingon", "__other"]]) {
  await setTarget(lang);
  const ok = await options.waitForFunction(() => document.documentElement.lang === "en", null, { timeout: 5000 }).then(() => true, () => false);
  await options.reload(); await options.waitForFunction(() => document.documentElement.lang === "en");
  const state = await options.evaluate(() => ({ value: document.getElementById("targetLang").value, other: document.getElementById("targetLangOther").value, otherShown: !document.getElementById("targetLangOther").hidden, save: document.querySelector('[data-i18n="opt_save"]').textContent.trim() }));
  check(`target ${lang}: the interface is English`, ok && state.save === "Save", state.save);
  check(`target ${lang}: Settings shows it in the dropdown`, picker === "__other" ? state.value === "__other" && state.otherShown && state.other === lang : state.value === lang, JSON.stringify(state));
}
await ctx.close();

// 6. a fresh install picks the browser's own language as the target
const fresh = await launch({ LANGUAGE: "vi", LANG: "vi_VN.UTF-8" });
const ui = await fresh.sw.evaluate(() => chrome.i18n.getUILanguage());
let target = null;
for (let i = 0; i < 30 && !target; i++) { target = (await fresh.sw.evaluate(() => chrome.storage.sync.get("targetLang"))).targetLang; if (!target) await wait(100); }
if (/^vi/.test(ui)) check("a fresh install in a Vietnamese browser translates into Vietnamese", target === "Vietnamese", target);
else check("a fresh install in an English browser translates into English", target === "English", `browser says ${ui}, target ${target}`);
await fresh.ctx.close();

srv.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
