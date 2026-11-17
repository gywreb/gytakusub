// A new user's first run, and the worker's limits around it:
// - the setup page opens on install; until "I agree", nothing is translated and the popup
//   only offers setup;
// - without site access, nothing is registered on sites and a download says how to fix it;
// - the content script never gets the API key, and the image downloader returns only images;
// - Options → About shows the agreement and can withdraw it.
// The browser's own permission prompt can't be clicked here, so access stays off in this test
// (the other browser tests run with access, see ext-copy.mjs).
// Usage: node browser/setup.mjs [--out dir]   (screenshots for the PR in --out)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extensionCopy } from "./ext-copy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/setup"); fs.mkdirSync(out, { recursive: true });
const PORT = 8791, BASE = `http://127.0.0.1:${PORT}`;
const png = fs.readFileSync(path.join(here, "../fixtures/demo-page.png"));

// A site that sends no CORS headers, as most image servers: only site access lets the worker read
// it. /cors-* answers are readable without access, to reach the checks after the download.
const srv = http.createServer((q, r) => {
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (q.url === "/page.png") { r.writeHead(200, { "Content-Type": "image/png" }); return r.end(png); }
  if (q.url === "/cors-page.png") { r.writeHead(200, { "Content-Type": "image/png", ...cors }); return r.end(png); }
  if (q.url === "/cors-login.png") { r.writeHead(200, { "Content-Type": "image/png", ...cors }); return r.end("<!doctype html><title>Sign in</title><form>…</form>"); }
  r.writeHead(200, { "Content-Type": "text/html" }); r.end(`<title>Chapter 1</title><img src="/page.png">`);
});
await new Promise((ok) => srv.listen(PORT, "127.0.0.1", ok));

const ext = extensionCopy(path.resolve(here, "../../extension"), { grantAccess: false });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1100,900"],
  viewport: { width: 1100, height: 900 },
});
const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const extId = new URL(sw.url()).host;
const results = [];
const settle = () => new Promise((r) => setTimeout(r, 350)); // colours change with a .15 s transition
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// 1. the setup page opens by itself on install
let welcome = null;
for (let i = 0; i < 100 && !welcome; i++) { welcome = context.pages().find((p) => p.url().includes("/welcome.html")); if (!welcome) await new Promise((r) => setTimeout(r, 100)); }
check("setup page opens on install", welcome);
if (!welcome) { await context.close(); srv.close(); process.exit(1); }
await welcome.waitForLoadState("load");
await welcome.waitForFunction(() => document.getElementById("consentHint").textContent.length > 0);

await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], autoSites: ["127.0.0.1"] });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await new Promise((r) => setTimeout(r, 400)); // the worker re-registers on the storage change

const facts = await welcome.evaluate(() => ({
  disclosure: document.getElementById("stepConsent").textContent,
  agreeShown: !document.getElementById("agree").hidden,
  allowDisabled: document.getElementById("allow").disabled,
  keyState: document.getElementById("keyState").textContent,
  allSet: !document.getElementById("allSet").hidden,
}));
check("disclosure names what is sent and where", /page image/.test(facts.disclosure) && /glossary/.test(facts.disclosure) && /Claude API/.test(facts.disclosure) && /no analytics/i.test(facts.disclosure));
check("before agreeing: I agree shown, Allow access disabled", facts.agreeShown && facts.allowDisabled);
check("the key step sees the saved key", facts.keyState === "Key saved", facts.keyState);
for (const scheme of ["light", "dark"]) { await welcome.emulateMedia({ colorScheme: scheme }); await settle(); await welcome.screenshot({ path: path.join(out, `welcome-${scheme}.png`), fullPage: true }); }

const send = (msg) => welcome.evaluate((m) => chrome.runtime.sendMessage(m), msg);

// 2. nothing is translated before the agreement
const early = await send({ type: "TRANSLATE", url: `${BASE}/cors-page.png` });
check("translate before agreeing is refused", /isn't set up yet/.test(early?.error || ""), early?.error);

// 3. the content script's settings never carry the key
const settings = await send({ type: "GET_SETTINGS" });
check("GET_SETTINGS leaves the API key out", settings && !("apiKey" in settings) && settings.hasKey === true && settings.enabled === true);

// 4. no site access: nothing registered, even for enabled sites
const registered = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
check("no content scripts registered without access", registered.length === 0, `${registered.length} registered`);

// 5. the popup offers only setup
const popup = async (name) => {
  const p = await context.newPage(); await p.setViewportSize({ width: 340, height: 760 });
  // as if opened from the toolbar on the chapter tab, where the click lets the popup see the tab's
  // address (activeTab); a popup page in a tab of its own would see itself as the active tab
  await p.addInitScript((url) => { const q = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = (o) => (o && o.active ? Promise.resolve([{ id: 2147483000, url }]) : q(o)); }, `${BASE}/`);
  await p.goto(`chrome-extension://${extId}/popup.html`); await p.waitForFunction(() => document.body.classList.contains("ready"));
  await p.waitForTimeout(200);
  const state = await p.evaluate(() => ({ setup: document.body.classList.contains("setup"), setupShown: getComputedStyle(document.getElementById("setupNote")).display !== "none", bodyShown: getComputedStyle(document.querySelector(".pop-body")).display !== "none", accessShown: getComputedStyle(document.getElementById("access")).display !== "none" }));
  const h = await p.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  for (const scheme of ["light", "dark"]) { await p.emulateMedia({ colorScheme: scheme }); await settle(); await p.screenshot({ path: path.join(out, `popup-${name}-${scheme}.png`), clip: { x: 0, y: 0, width: 340, height: h } }); }
  await p.close();
  return state;
};
const before = await popup("setup");
check("popup before agreeing: only the Set up note", before.setup && before.setupShown && !before.bodyShown && !before.accessShown, JSON.stringify(before));

// 6. I agree
await welcome.click("#agree");
await welcome.waitForFunction(() => document.getElementById("agree").hidden);
const stored = await sw.evaluate(async () => (await chrome.storage.local.get("consent")).consent);
const after = await welcome.evaluate(() => ({ state: document.getElementById("consentState").textContent, allowEnabled: !document.getElementById("allow").disabled, hint: document.getElementById("consentHint").textContent }));
check("I agree stores the agreement with its date", stored?.version === 1 && !Number.isNaN(Date.parse(stored.at)));
check("after agreeing: step 1 done, Allow access enabled", after.state === "Agreed" && after.allowEnabled && /You agreed on/.test(after.hint), JSON.stringify(after));
for (const scheme of ["light", "dark"]) { await welcome.emulateMedia({ colorScheme: scheme }); await settle(); await welcome.screenshot({ path: path.join(out, `welcome-agreed-${scheme}.png`), fullPage: true }); }

const agreedPopup = await popup("no-access");
check("popup after agreeing, without access: the normal popup and an Allow access note", !agreedPopup.setup && agreedPopup.bodyShown && agreedPopup.accessShown, JSON.stringify(agreedPopup));

// 7. the image downloader, as the debug report uses it (FETCH_IMAGE answers only with the debug overlay on)
const offReport = await send({ type: "FETCH_IMAGE", url: `${BASE}/cors-page.png` });
check("without the debug overlay, no image comes back", /debug overlay/.test(offReport?.error || ""), offReport?.error);
await sw.evaluate(() => chrome.storage.sync.set({ debugOverlay: true }));
const noAccess = await send({ type: "FETCH_IMAGE", url: `${BASE}/page.png` });
check("without access, a download says how to allow it", /needs your permission.*Allow access/.test(noAccess?.error || ""), noAccess?.error);
const login = await send({ type: "FETCH_IMAGE", url: `${BASE}/cors-login.png` });
check("an HTML answer labelled as an image is refused", /did not return an image/.test(login?.error || ""), login?.error);
const real = await send({ type: "FETCH_IMAGE", url: `${BASE}/cors-page.png` });
check("a real image comes back, typed from its bytes", real?.type === "image/png" && /^data:image\/png;base64,/.test(real?.dataUrl || ""));
const notHttp = await send({ type: "FETCH_IMAGE", url: `chrome-extension://${extId}/manifest.json` });
check("only http(s) addresses", /Only http/.test(notHttp?.error || ""), notHttp?.error);

// 8. Options → About: the agreement and access, and withdrawing
const opt = await context.newPage();
await opt.goto(`chrome-extension://${extId}/options.html#sec-about`);
await opt.waitForFunction(() => !document.getElementById("consentBtn").hidden && !document.getElementById("accessBtn").hidden);
const about = await opt.evaluate(() => ({ consent: document.getElementById("consentDesc").textContent, access: document.getElementById("accessDesc").textContent, btn: document.getElementById("consentBtn").textContent, help: document.getElementById("sec-about").textContent }));
check("About shows the agreement date and that access is off", /You agreed on/.test(about.consent) && /Not allowed/.test(about.access) && about.btn === "Withdraw");
check("About has support and the not-affiliated note", /GitHub Issues/.test(about.help) && /not made by or affiliated with Anthropic/.test(about.help));
for (const scheme of ["light", "dark"]) { await opt.emulateMedia({ colorScheme: scheme }); await settle(); await opt.locator("#sec-about").screenshot({ path: path.join(out, `options-about-${scheme}.png`) }); }
await opt.click("#consentBtn");
await opt.waitForFunction(() => document.getElementById("consentBtn").textContent === "Review and agree");
const gone = await sw.evaluate(async () => (await chrome.storage.local.get("consent")).consent);
const again = await send({ type: "TRANSLATE", url: `${BASE}/cors-page.png` });
check("Withdraw removes the agreement and translating stops", gone === undefined && /isn't set up yet/.test(again?.error || ""), again?.error);

await context.close(); srv.close();
fs.rmSync(ext, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\nsetup: ${results.length - failed.length}/${results.length} passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
