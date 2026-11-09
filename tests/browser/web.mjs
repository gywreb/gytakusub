// Real-browser test of the web app (the phone path): serves web/ statically,
// points it at the mock API, uploads the synthetic page through the file input
// and checks a translated canvas appears without an error status. Then chapter
// link mode: the real fetcher (fetcher/worker.js) runs on a local port with the
// web mocked, the app opens a chapter through it (?chapter= deep link), the
// pages arrive through its image relay and translate, and "Next chapter" opens
// the next one.
// Usage: node web.mjs [--out /tmp/gyt-browser/web]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { startMock } from "./mock-api.mjs";
import { handle as fetcherHandle } from "../../fetcher/worker.js";
import { fmtUsd } from "../../extension/usage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/web"); fs.mkdirSync(out, { recursive: true });
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const API_PORT = 8787, WEB_PORT = 8788, FETCHER_PORT = 8789, OLD_FETCHER_PORT = 8790;

// Test copy of the web app with the shared files synced and the API URL mocked.
execFileSync("sh", [path.join(root, "scripts/sync-shared.sh")], { stdio: "ignore" });
const web = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-web-"));
fs.cpSync(path.join(root, "web"), web, { recursive: true });
const pj = path.join(web, "prompt.js");
fs.writeFileSync(pj, fs.readFileSync(pj, "utf8").replace(/export const API_URL = "[^"]+"/, `export const API_URL = "http://127.0.0.1:${API_PORT}/v1/messages"`));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".onnx": "application/octet-stream", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ttf": "font/ttf", ".wasm": "application/wasm", ".txt": "text/plain" };
const statik = http.createServer((req, res) => {
  const p = path.join(web, decodeURIComponent(new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")));
  if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => statik.listen(WEB_PORT, "127.0.0.1", r));
const { srv: api, calls } = await startMock(API_PORT, pageImage, { badBoxes: process.argv.includes("--bad-boxes"), truth: pageImage.replace(/-page\.png$/, "-truth.json") });

const browser = await chromium.launch({ channel: process.env.GYT_CHANNEL || "chromium", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test", useContext: false })));
await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
await page.setInputFiles("#file", pageImage);
await page.waitForSelector(".page canvas.translated", { timeout: 60000 });
await page.waitForTimeout(300);
const status = await page.$eval(".page .status", (el) => ({ text: el.textContent, hidden: el.hidden, cls: el.className }));
await page.screenshot({ path: path.join(out, "web-translated.png"), fullPage: true });
await page.click('[data-act="toggle"]'); await page.waitForTimeout(100);
await page.screenshot({ path: path.join(out, "web-original.png"), fullPage: true });

// the translated canvas must carry drawn text: it differs from the clean page in many pixels
const inked = await page.$eval(".page canvas.translated", (c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let dark = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) dark++;
  return dark;
});

let failures = 0;
const fail = (m) => { failures++; console.log("FAIL:", m); };
if (!calls.length) fail("no API call reached the mock");
if (/error/.test(status.cls)) fail("page status is an error: " + status.text);
if (errors.length) fail("console/page errors: " + errors.slice(0, 3).join(" | "));
if (inked < 500) fail("translated canvas looks blank (dark samples: " + inked + ")");
console.log(`API calls: ${JSON.stringify(calls)} status: ${JSON.stringify(status)} dark samples: ${inked}`);

// Claude usage: each answer is logged; Settings shows today, the model and the rate-limit headroom
await page.click("#btnSettings");
await page.waitForSelector("#settings[open]");
const cu = await page.evaluate(() => ({ cost: document.getElementById("cuTodayCost").textContent, sub: document.getElementById("cuTodaySub").textContent, models: document.getElementById("cuModels").textContent, limits: document.getElementById("cuLimits").textContent, progress: document.getElementById("progress").textContent }));
await page.screenshot({ path: path.join(out, "web-claude-usage.png"), fullPage: true });
await page.keyboard.press("Escape");
// the page's model is Haiku 5.5 by default: 1000 input + 200 output tokens = $0.0002 per answer
const wantUsd = fmtUsd(calls.length * (1000 * 0.10 + 200 * 0.50) / 1e6);
if (cu.cost !== `≈${wantUsd}` || !cu.sub.startsWith(`${calls.length} request${calls.length === 1 ? "" : "s"} · `) || !/Claude Haiku 5\.5/.test(cu.models)) fail(`Settings should show today's Claude usage (${calls.length} answers, ${wantUsd}): ${JSON.stringify(cu)}`);
if (!/of 50 requests/.test(cu.limits)) fail("the rate-limit headroom from Claude's last answer should show: " + cu.limits);
if (!/Claude today ≈/.test(cu.progress)) fail("the toolbar should show today's Claude cost: " + cu.progress);
console.log("claude usage:", JSON.stringify(cu));

// ---------- chapter link mode through the real fetcher ----------
// The fetcher's handler on a local port; its outbound fetch is a fake web: two chapter pages on
// a MangaThemesia-style site and their images on a CDN (the demo page), plus a site with a bot check.
const KEY = "browser-test-key-0123456789";
const png = fs.readFileSync(pageImage);
const ch = (n, next) => `<html><head><title>Test Series ${n}</title></head><body><img src="https://reader.example/wp-content/uploads/logo.png">
<div id="readerarea"><img data-src="https://cdn.reader.example/series/${n}/01.png"><img data-src="https://cdn.reader.example/series/${n}/02.png"></div>
${next ? `<a class="ch-next-a" href="https://reader.example/series-chapter-${n + 1}/">Next ›</a>` : ""}</body></html>`;
const fakeSite = {
  "https://reader.example/series-chapter-1/": { body: ch(1, true), type: "text/html" },
  "https://reader.example/series-chapter-2/": { body: ch(2, false), type: "text/html" },
  "https://guarded.example/ch/1/": { status: 503, body: "<title>Just a moment...</title><script src=/cdn-cgi/challenge-platform/x></script>", type: "text/html" },
};
const fetched = [];
// Cloudflare's analytics, for the live count: 1,256 requests today over two Workers
const graphqlAnswer = { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [
  { sum: { requests: 1200, errors: 0 }, dimensions: { scriptName: "gytakusub" } },
  { sum: { requests: 56, errors: 0 }, dimensions: { scriptName: "other-worker" } },
] }] } } };
const fetcherEnv = { GYT_KEY: KEY }; // the live-count secrets are added later in the test
const fakeWeb = async (url, init = {}) => {
  if (String(url) === "https://api.cloudflare.com/client/v4/graphql") return new Response(JSON.stringify(graphqlAnswer), { headers: { "Content-Type": "application/json" } });
  fetched.push({ url: String(url), referer: init.headers?.Referer || null });
  if (/^https:\/\/cdn\.reader\.example\/series\/\d+\/0\d\.png$/.test(String(url))) return new Response(png, { headers: { "Content-Type": "image/png" } });
  const r = fakeSite[String(url)];
  return r ? new Response(r.body, { status: r.status || 200, headers: { "Content-Type": r.type } }) : new Response("nope", { status: 404 });
};
const served = []; // every request the fetcher receives, as Cloudflare would count it (permission checks included)
const fetcherSrv = http.createServer(async (req, res) => {
  served.push(`${req.method} ${req.url}`);
  const request = new Request(`http://127.0.0.1:${FETCHER_PORT}${req.url}`, { method: req.method, headers: req.headers });
  const r = await fetcherHandle(request, fetcherEnv, fakeWeb);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => fetcherSrv.listen(FETCHER_PORT, "127.0.0.1", r));
// a fetcher from an older release: answers /ping with version 2.0.0
const oldSrv = http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": req.headers.origin || "*", "Access-Control-Allow-Headers": "Authorization" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  res.writeHead(200, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, version: "2.0.0" }));
});
await new Promise((r) => oldSrv.listen(OLD_FETCHER_PORT, "127.0.0.1", r));

const page2 = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const errors2 = [];
page2.on("pageerror", (e) => errors2.push(String(e)));
await page2.addInitScript(() => { if (!localStorage.getItem("gytakusub.settings")) localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test", useContext: true })); });
await page2.goto(`http://127.0.0.1:${WEB_PORT}/?chapter=${encodeURIComponent("https://reader.example/series-chapter-1/")}`);
await page2.waitForTimeout(500);
// No fetcher yet: the tab shows the setup steps, and the chapter form is not reachable.
if (!(await page2.isVisible("#fetcherWizard"))) fail("without a connected fetcher the Chapter link tab must show the setup steps");
if (await page2.isVisible("#chapterForm")) fail("the chapter form must stay hidden until a fetcher is connected");
if ((await page2.$$('#fetcherWizard a[href="https://github.com/gywreb/gytakusub"]')).length !== 1 || (await page2.$$('#fetcherWizard a[href="https://dash.cloudflare.com/"]')).length !== 1) fail("the steps must link to the repository to fork and to the Cloudflare dashboard");
if (!/^Step 1 of 6$/.test(await page2.textContent("#wzProgress"))) fail("the setup should start at step 1 of 6: " + await page2.textContent("#wzProgress"));
if (await page2.isVisible("#wzGen")) fail("only the current step should be open");
await page2.click("#wzNext");
await page2.click("#wzNext"); // no key yet: stays on step 2
if (!/Step 2 of 6/.test(await page2.textContent("#wzProgress"))) fail("Next on step 2 without a key should not advance");
await page2.click("#wzGen");
const genKey = (await page2.textContent("#wzKey")).trim();
if (!/^[A-Za-z0-9]{32}$/.test(genKey) || (await page2.inputValue("#wzKeyInput")) !== genKey) fail("Generate key should make a 32-character key and fill it into step 3: " + genKey);
await page2.waitForFunction(() => /\d{4}/.test(document.querySelector("#wzChecked").textContent), null, { timeout: 5000 }).catch(() => fail("step 2 should say when the steps were last checked"));
for (let i = 0; i < 4; i++) await page2.click("#wzNext");
if (!/Step 6 of 6/.test(await page2.textContent("#wzProgress")) || await page2.isVisible("#wzNext")) fail("the last step is Connect, with no Next");
const connect = async (url, key) => {
  await page2.fill("#wzUrl", url); await page2.fill("#wzKeyInput", key); await page2.click("#wzConnect");
  await page2.waitForFunction(() => !/Connecting/.test(document.querySelector("#wzMsg").textContent), null, { timeout: 15000 });
  return page2.textContent("#wzMsg");
};
// the generated key is not the Worker's GYT_KEY yet: refused, explained
const m1 = await connect(`http://127.0.0.1:${FETCHER_PORT}/`, genKey);
if (!/refused the access key/.test(m1)) fail("a key that is not the Worker's should be explained: " + m1);
const m2 = await connect(`http://127.0.0.1:${OLD_FETCHER_PORT}`, KEY);
if (!/version 2\.0\.0.*needs/.test(m2)) fail("an outdated fetcher should be refused with its version: " + m2);
const m3 = await connect("http://127.0.0.1:9/", KEY);
if (!/No answer from/.test(m3)) fail("an address with nothing behind it should say so: " + m3);
if (await page2.isVisible("#chapterForm")) fail("failed connections must not unlock the chapter form");
served.length = 0; // the device count starts again here too: the last attempts went to other addresses
const m4 = await connect(`http://127.0.0.1:${FETCHER_PORT}/`, KEY);
if (!/Connected/.test(m4) || !(await page2.isVisible("#chapterForm"))) fail("a working fetcher should connect and unlock the chapter form: " + m4);
// connected state survives a reload (verified address + key), and the connection link round-trips
await page2.reload(); await page2.waitForTimeout(400);
await page2.click('.tab[data-mode="chapter"]');
if (!(await page2.isVisible("#chapterForm"))) fail("after a reload the connected fetcher should still unlock chapters");
if (fetched.length) fail("a ?chapter= link must wait for a tap on Load, but the fetcher was already called");
await page2.fill("#chapterUrl", "https://reader.example/series-chapter-1/");
await page2.click('#chapterForm button[type="submit"]');
await page2.waitForFunction(() => document.querySelectorAll(".page canvas.translated").length >= 1, null, { timeout: 90000 });
const info1 = await page2.textContent("#chapterInfo");
const nPages1 = await page2.$$eval(".page", (els) => els.length);
const nextShown = await page2.isVisible("#navNext");
await page2.screenshot({ path: path.join(out, "web-chapter.png"), fullPage: true });
if (nPages1 !== 2) fail(`chapter 1 should show its 2 pages (logo excluded), shows ${nPages1}`);
if (!/Test Series 1/.test(info1)) fail("chapter title not shown: " + info1);
if (!nextShown) fail("Next chapter button not shown");
const imgFetch = fetched.find((f) => /cdn\.reader\.example/.test(f.url));
if (!imgFetch || imgFetch.referer !== "https://reader.example/") fail("page images must go through the fetcher with the chapter site's origin as Referer: " + JSON.stringify(imgFetch));
await page2.click("#navNext");
await page2.waitForFunction(() => /Test Series 2/.test(document.querySelector("#chapterInfo").textContent), null, { timeout: 30000 });
if (!page2.url().includes(encodeURIComponent("https://reader.example/series-chapter-2/"))) fail("the address bar should carry the open chapter: " + page2.url());
if (await page2.isVisible("#navNext")) fail("chapter 2 has no next link, the button should hide");
await page2.fill("#chapterUrl", "https://guarded.example/ch/1/");
await page2.click('#chapterForm button[type="submit"]');
await page2.waitForFunction(() => /⚠/.test(document.querySelector("#chapterInfo").textContent), null, { timeout: 30000 });
const challengeMsg = await page2.textContent("#chapterInfo");
if (!/checking your browser/i.test(challengeMsg)) fail("a bot-check site should be explained: " + challengeMsg);
// the free allowance: this device's requests today, in the tab and in the manage panel
const usage = await page2.textContent("#fetcherUsage");
const used = Number(((/^≈([\d,]+) \/ 100,000 free today/.exec(usage) || [])[1] || "").replace(/,/g, ""));
if (!(used >= 6)) fail("the tab should show today's requests from this device: " + usage);
// the estimate counts the browser's permission checks (OPTIONS) too, so in Chromium it matches what the fetcher received
const preflights = served.filter((r) => r.startsWith("OPTIONS")).length;
if (used !== served.length || preflights < 4) fail(`the device count should match the requests the fetcher received, permission checks included: ${used} counted, ${served.length} received (${preflights} OPTIONS)`);
await page2.click("#btnFetcherManage");
// opening the panel asks the fetcher for Cloudflare's count (/usage), itself one more request on this device
// wait for that request to be counted in the chip and the meter (it lands a moment after the panel opens), rather than racing it
const countNow = () => Number(((/^≈([\d,]+) \//.exec(document.querySelector("#fetcherUsage").textContent) || [])[1] || "").replace(/,/g, ""));
await page2.waitForFunction((want) => {
  const chip = Number(((/^≈([\d,]+) \//.exec(document.querySelector("#fetcherUsage").textContent) || [])[1] || "").replace(/,/g, ""));
  return chip >= want && Number(document.querySelector("#usageMeter").getAttribute("aria-valuenow")) >= want;
}, used + 1, { timeout: 10000 }).catch(() => {});
const usedNow = await page2.evaluate(countNow);
if (usedNow !== used + 1 || served.length !== usedNow) fail(`asking for the live count is a request too: ${used} → ${usedNow} (the fetcher received ${served.length})`);
const meterNow = Number(await page2.getAttribute("#usageMeter", "aria-valuenow"));
const usageNote = await page2.textContent("#usageNote");
await page2.screenshot({ path: path.join(out, "web-fetcher-manage.png"), fullPage: true });
if (meterNow !== usedNow || !/2 chapters/.test(usageNote) || !/starts again at/.test(usageNote)) fail(`the manage panel's meter should show the same count (${meterNow} vs ${usedNow}) and the chapters opened: ${usageNote}`);
// without the analytics secrets on the Worker, the panel offers the live-count setup
await page2.waitForSelector("#liveSetup", { state: "visible", timeout: 10000 }).catch(() => fail("a fetcher without the analytics secrets should offer the live-count setup"));
if ((await page2.textContent("#usageSource")) !== "This device") fail("the device count should say it is this device's");
// with them, the count comes from Cloudflare: the same number on every device
fetcherEnv.CF_API_TOKEN = "cf-token-test"; fetcherEnv.CF_ACCOUNT_ID = "acc-test";
await page2.click("#liveCheck");
await page2.waitForFunction(() => /^1,256 \/ 100,000 free today$/.test(document.getElementById("fetcherUsage").textContent), null, { timeout: 10000 })
  .catch(async () => fail("the live count should replace the estimate: " + (await page2.textContent("#fetcherUsage"))));
const liveSource = await page2.textContent("#usageSource"), liveNote = await page2.textContent("#usageNote");
if (!/^Cloudflare · /.test(liveSource) || !(await page2.isHidden("#liveSetup")) || !/gytakusub 1,200, other Workers 56/.test(liveNote)) fail(`the panel should show Cloudflare's count and its Workers: ${liveSource} / ${liveNote}`);
if (Number(await page2.getAttribute("#usageMeter", "aria-valuenow")) !== 1256) fail("the meter should follow the live count");
await page2.screenshot({ path: path.join(out, "web-fetcher-live.png"), fullPage: true });
await page2.click("#mgDone");
// past the allowance Cloudflare answers with its own error page (1027); with no answer at all, both likely causes are named
const chapterAt = `http://127.0.0.1:${FETCHER_PORT}/chapter?*`;
await page2.route(chapterAt, (r) => r.fulfill({ status: 500, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/html" }, body: "<title>Worker exceeded resource limits | Cloudflare</title><span>Error 1027</span>" }));
await page2.fill("#chapterUrl", "https://reader.example/series-chapter-1/");
await page2.click('#chapterForm button[type="submit"]');
await page2.waitForFunction(() => /⚠/.test(document.querySelector("#chapterInfo").textContent), null, { timeout: 30000 });
const limitMsg = await page2.textContent("#chapterInfo");
if (!/used today's 100,000 free requests/.test(limitMsg) || !/works again at/.test(limitMsg)) fail("a used-up allowance should be explained: " + limitMsg);
await page2.unroute(chapterAt);
await page2.route(chapterAt, (r) => r.abort("connectionrefused"));
await page2.click('#chapterForm button[type="submit"]');
await page2.waitForFunction((prev) => document.querySelector("#chapterInfo").textContent !== prev && /⚠/.test(document.querySelector("#chapterInfo").textContent), limitMsg, { timeout: 30000 });
const silentMsg = await page2.textContent("#chapterInfo");
if (!/free requests are used up/.test(silentMsg) || !/10 ms/.test(silentMsg)) fail("no answer from a connected fetcher should name the likely causes: " + silentMsg);
await page2.unroute(chapterAt);
const wrongKey = await page2.evaluate(async (port) => (await fetch(`http://127.0.0.1:${port}/ping`, { headers: { Authorization: "Bearer nope" } })).status, FETCHER_PORT);
if (wrongKey !== 401) fail("the fetcher must refuse a wrong key from the browser, got " + wrongKey);
if (errors2.length) fail("chapter mode page errors: " + errors2.slice(0, 3).join(" | "));
console.log(`chapter mode: ${nPages1} pages, info "${info1}", next shown ${nextShown}; bot-check message: "${challengeMsg.slice(0, 80)}…"; fetches: ${fetched.length}`);
// another device: the connection link fills in address and key, and waits for Connect
const link = await page2.evaluate(async () => { const m = await import("./fetcher-client.js"); return m.connectionLink(JSON.parse(localStorage.getItem("gytakusub.settings"))); });
const ctx3 = await browser.newContext();
const page3 = await ctx3.newPage();
await page3.addInitScript(() => localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test" })));
await page3.goto(link); await page3.waitForTimeout(500);
if (!(await page3.isVisible("#fetcherWizard")) || (await page3.inputValue("#wzKeyInput")) !== KEY || /connect=/.test(page3.url())) fail("a connection link should fill in the fetcher, wait for Connect, and leave the address bar: " + page3.url());
await page3.click("#wzConnect");
await page3.waitForSelector("#chapterForm", { state: "visible", timeout: 15000 }).catch(() => fail("the connection link's fetcher should connect on another device"));
// …or pasted into the "Got a connection link?" box (iPhone: the Home Screen app doesn't receive links opened in Safari)
const page4 = await (await browser.newContext()).newPage();
await page4.addInitScript(() => localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test" })));
await page4.goto(`http://127.0.0.1:${WEB_PORT}/`); await page4.click('.tab[data-mode="chapter"]'); await page4.waitForTimeout(300);
await page4.fill("#wzLink", "not a link"); await page4.click("#wzLinkConnect");
if (!/isn't a connection link/.test(await page4.textContent("#wzLinkMsg"))) fail("pasting something that isn't a connection link should say so");
await page4.fill("#wzLink", link); await page4.click("#wzLinkConnect");
await page4.waitForSelector("#chapterForm", { state: "visible", timeout: 15000 }).catch(() => fail("a pasted connection link should connect"));
await page4.context().close();
await page2.click('.tab[data-mode="chapter"]');
await page2.setViewportSize({ width: 390, height: 844 });
await ctx3.close();
fetcherSrv.close(); oldSrv.close();

// ---------- install guide ----------
// Desktop: a QR code with the app's address for the phone; "Not now" hides it for good; Settings brings it back.
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${WEB_PORT}/`); await pg.waitForTimeout(400);
  const qr = await pg.$("#installQr svg");
  if (!(await pg.isVisible("#installCard")) || !qr || !(await pg.isVisible('[data-platform="desktop"]'))) fail("on a computer the install card should show a QR code for the phone");
  if (!(await pg.isVisible("#settings"))) fail("on a computer the first visit should still ask for the Claude key");
  await pg.keyboard.press("Escape");
  await pg.click("#btnInstallLater"); await pg.reload(); await pg.waitForTimeout(300);
  if (await pg.isVisible("#installCard")) fail("“Not now” should keep the install card closed");
  await pg.click("#btnSettings"); await pg.click("#btnShowInstall");
  if (!(await pg.isVisible("#installCard"))) fail("Settings → Install should bring the install card back");
  await ctx.close();
}
// iPhone (Safari): the Home Screen steps come first, before any key is asked for (the installed app keeps its own settings).
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${WEB_PORT}/`); await pg.waitForTimeout(800);
  const text = await pg.textContent("#installCard");
  if (!(await pg.isVisible('[data-platform="ios"]')) || !/Add to Home Screen/.test(text) || (await pg.isVisible('[data-platform="desktop"]'))) fail("on iPhone the install card should show the Add to Home Screen steps");
  if (await pg.isVisible("#settings")) fail("on an iPhone that hasn't installed the app, the key dialog must wait until after installing");
  await pg.click("#btnInstallLater");
  if (!(await pg.isVisible("#settings"))) fail("after “Not now” on iPhone, the app should ask for the Claude key");
  await pg.screenshot({ path: path.join(out, "web-install-iphone.png") });
  await ctx.close();
}
console.log(failures ? `WEB BROWSER TEST FAILED (${failures})` : "WEB BROWSER TEST PASSED");
await browser.close(); api.close(); statik.close();
fs.rmSync(web, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
