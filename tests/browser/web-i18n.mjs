// The web app's own interface in ten languages (2.10.0), on a phone-sized screen: install card,
// screenshot mode, the chapter-link setup steps, the fetcher page and Settings.
//   node browser/web-i18n.mjs [--out dir]
// For each language: every marked element shows that language's message, no message key is on
// screen, <html lang> is right, nothing spills sideways or clips at 390 px, and no console errors.
// Then: saving another target language in Settings switches the app without a reload, and the
// copy buttons inside translated sentences still work afterwards.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/web-i18n"); fs.mkdirSync(out, { recursive: true });
const PORT = 8796;
const { LANGUAGES } = await import(path.join(root, "extension/languages.js"));
const json = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const messagesOf = (loc) => ({ ...json(`extension/_locales/${loc}/messages.json`), ...json(`web/locales/${loc}/messages.json`) });
const EN = messagesOf("en");

execFileSync("sh", [path.join(root, "scripts/sync-shared.sh")], { stdio: "ignore" });
const web = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-web-"));
fs.cpSync(path.join(root, "web"), web, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ttf": "font/ttf", ".wasm": "application/wasm", ".txt": "text/plain", ".md": "text/plain" };
const statik = http.createServer((req, res) => {
  const p = path.join(web, decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")));
  if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => statik.listen(PORT, "127.0.0.1", r));

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: process.env.GYT_CHANNEL || "chromium", headless: true });
// an iPhone-sized screen with an iPhone's user agent: the install card shows the iPhone steps
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** What a part of the page shows against its language's messages. */
async function readView(page, selector, want) {
  return page.evaluate(({ selector, want }) => {
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
    const scope = document.querySelector(selector);
    const plain = [...scope.querySelectorAll("[data-i18n]")].filter(visible);
    const wrong = plain.filter((e) => { const m = want[e.dataset.i18n]; return m && !/\{\w+\}/.test(m) && norm(e.textContent) !== norm(m); }).map((e) => `${e.dataset.i18n}="${norm(e.textContent).slice(0, 40)}"`);
    const keys = [...scope.querySelectorAll("*")].filter((e) => e.children.length === 0 && visible(e)).map((e) => norm(e.textContent)).filter((s) => /^(web|opt|popup|usage|api_err)_[a-z0-9_]+$/.test(s));
    const de = document.documentElement;
    const clipped = [...scope.querySelectorAll("button, label, .tab, select, .status-chip")].filter(visible)
      .filter((e) => { const cs = getComputedStyle(e); return e.scrollWidth > e.clientWidth + 2 && (cs.overflow !== "visible" || cs.textOverflow === "ellipsis" || cs.whiteSpace === "nowrap"); })
      .map((e) => norm(e.textContent).slice(0, 40));
    const ctx = document.createElement("canvas").getContext("2d");
    for (const sel of scope.querySelectorAll("select")) {
      if (!visible(sel)) continue;
      const cs = getComputedStyle(sel); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20;
      for (const o of sel.options) if (ctx.measureText(o.text).width > room) clipped.push(`${sel.id}: "${o.text}"`);
    }
    return { lang: de.lang, shown: plain.length, wrong, keys, sideways: de.scrollWidth > de.clientWidth + 1, clipped };
  }, { selector, want });
}

const SHOTS = new Set(["vi", "ja", "de"]);
for (const lang of LANGUAGES.filter((l) => l.ui)) {
  const loc = lang.ui, tag = loc.replace("_", "-");
  const msgs = Object.fromEntries(Object.entries({ ...EN, ...messagesOf(loc) }).map(([k, v]) => [k, v.message]));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript((target) => localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test", targetLang: target })), lang.name);
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction((t) => document.documentElement.lang === t, tag, { timeout: 8000 }).catch(() => {});
  await wait(300);
  const views = [];
  views.push(["home", await readView(page, "body", msgs)]);
  if (SHOTS.has(loc)) await page.screenshot({ path: path.join(out, `${loc}-home.png`), fullPage: true });
  await page.click("#tabChapter"); await wait(300);
  views.push(["chapter setup", await readView(page, "#modeChapter", msgs)]);
  if (SHOTS.has(loc)) await page.screenshot({ path: path.join(out, `${loc}-setup.png`), fullPage: true });
  await page.click("#btnSettings"); await wait(300);
  views.push(["settings", await readView(page, "#settings", msgs)]);
  if (SHOTS.has(loc)) await page.screenshot({ path: path.join(out, `${loc}-settings.png`) });
  for (const [view, r] of views) {
    const what = `${loc} ${view}`;
    if (view === "home") check(`${loc}: <html lang> is ${tag}`, r.lang === tag, r.lang);
    check(`${what}: ${r.shown} labels in the right language, no keys on screen`, r.shown > 3 && !r.wrong.length && !r.keys.length, [...r.wrong, ...r.keys].slice(0, 4).join("; "));
    check(`${what}: nothing spills sideways or clips at 390 px`, !r.sideways && !r.clipped.length, [r.sideways ? "page scrolls sideways" : "", ...r.clipped].filter(Boolean).join("; "));
  }
  check(`${loc}: no console errors`, !errors.length, errors.slice(0, 2).join(" | "));
  await context.close();
}

// switching language from Settings, without a reload
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${PORT}` });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => { if (!localStorage.getItem("gytakusub.settings")) localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test", targetLang: "English" })); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.click("#tabChapter");
  await page.click("#btnSettings");
  await page.selectOption("#sTargetLang", "Vietnamese");
  await page.click("#sSave");
  const vi = messagesOf("vi");
  const switched = await page.waitForFunction((save) => document.documentElement.lang === "vi" && document.querySelector('[data-i18n="web_tabShots"]').textContent.trim() === save, vi.web_tabShots.message, { timeout: 5000 }).then(() => true, () => false);
  check("saving Vietnamese in Settings switches the app to Vietnamese without a reload", switched);
  const step = await page.textContent("#wzProgress");
  check("…including text drawn from code (the setup step counter)", step.trim() === vi.web_step.message.replace("{step}", "1").replace("{total}", "6"), step);
  // a copy button inside a translated sentence still works after the switch
  await page.click('#wzSteps > li[data-step="3"] .step-title');
  await page.click('#wzSteps > li[data-step="3"] .chip[data-copy="gytakusub"]');
  const toast = await page.waitForFunction(() => { const t = document.getElementById("toast"); return !t.hidden && t.textContent.includes("gytakusub") && t.textContent; }, null, { timeout: 3000 }).then((h) => h.jsonValue(), async () => page.textContent("#toast"));
  check("a copy button in a translated step still copies, and says so in Vietnamese", toast === vi.web_copied.message.replace("{what}", "“gytakusub”"), toast);
  await context.close();
}

await browser.close(); statik.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
