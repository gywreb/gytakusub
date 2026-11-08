// Real-browser test of the web app (the phone path): serves web/ statically,
// points it at the mock API, uploads the synthetic page through the file input
// and checks a translated canvas appears without an error status.
// Usage: node web.mjs [--out /tmp/gyt-browser/web]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/web"); fs.mkdirSync(out, { recursive: true });
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const API_PORT = 8787, WEB_PORT = 8788;

// Test copy of the web app with the shared files synced and the API URL mocked.
execFileSync("sh", [path.join(root, "scripts/sync-shared.sh")], { stdio: "ignore" });
const web = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-web-"));
fs.cpSync(path.join(root, "web"), web, { recursive: true });
const pj = path.join(web, "prompt.js");
fs.writeFileSync(pj, fs.readFileSync(pj, "utf8").replace(/export const API_URL = "[^"]+"/, `export const API_URL = "http://127.0.0.1:${API_PORT}/v1/messages"`));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ttf": "font/ttf", ".wasm": "application/wasm", ".txt": "text/plain" };
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
console.log(failures ? `WEB BROWSER TEST FAILED (${failures})` : "WEB BROWSER TEST PASSED");
await browser.close(); api.close(); statik.close();
fs.rmSync(web, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
