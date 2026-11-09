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
import { chromium } from "playwright";
import { startMock } from "./mock-api.mjs";
import { handle as fetcherHandle } from "../../fetcher/worker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/web"); fs.mkdirSync(out, { recursive: true });
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const API_PORT = 8787, WEB_PORT = 8788, FETCHER_PORT = 8789;

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
const fakeWeb = async (url, init = {}) => {
  fetched.push({ url: String(url), referer: init.headers?.Referer || null });
  if (/^https:\/\/cdn\.reader\.example\/series\/\d+\/0\d\.png$/.test(String(url))) return new Response(png, { headers: { "Content-Type": "image/png" } });
  const r = fakeSite[String(url)];
  return r ? new Response(r.body, { status: r.status || 200, headers: { "Content-Type": r.type } }) : new Response("nope", { status: 404 });
};
const fetcherSrv = http.createServer(async (req, res) => {
  const request = new Request(`http://127.0.0.1:${FETCHER_PORT}${req.url}`, { method: req.method, headers: req.headers });
  const r = await fetcherHandle(request, { GYT_KEY: KEY }, fakeWeb);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => fetcherSrv.listen(FETCHER_PORT, "127.0.0.1", r));

const page2 = await browser.newPage({ viewport: { width: 900, height: 1200 } });
const errors2 = [];
page2.on("pageerror", (e) => errors2.push(String(e)));
await page2.addInitScript(([port, key]) => localStorage.setItem("gytakusub.settings", JSON.stringify({ apiKey: "sk-ant-test", useContext: true, fetcherUrl: `http://127.0.0.1:${port}/`, fetcherKey: key })), [FETCHER_PORT, KEY]);
await page2.goto(`http://127.0.0.1:${WEB_PORT}/?chapter=${encodeURIComponent("https://reader.example/series-chapter-1/")}`);
await page2.waitForTimeout(500);
if (fetched.length) fail("a ?chapter= link must wait for a tap on Load, but the fetcher was already called");
if ((await page2.inputValue("#chapterUrl")) !== "https://reader.example/series-chapter-1/") fail("a ?chapter= link should fill in the chapter address");
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
const wrongKey = await page2.evaluate(async (port) => (await fetch(`http://127.0.0.1:${port}/ping`, { headers: { Authorization: "Bearer nope" } })).status, FETCHER_PORT);
if (wrongKey !== 401) fail("the fetcher must refuse a wrong key from the browser, got " + wrongKey);
if (errors2.length) fail("chapter mode page errors: " + errors2.slice(0, 3).join(" | "));
console.log(`chapter mode: ${nPages1} pages, info "${info1}", next shown ${nextShown}; bot-check message: "${challengeMsg.slice(0, 80)}…"; fetches: ${fetched.length}`);
fetcherSrv.close();
console.log(failures ? `WEB BROWSER TEST FAILED (${failures})` : "WEB BROWSER TEST PASSED");
await browser.close(); api.close(); statik.close();
fs.rmSync(web, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
