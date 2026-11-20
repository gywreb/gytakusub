// Real-browser test of a reader page laid out like one seen in a user's report: a site logo, a
// cover thumbnail and reaction emoji (large files shown small), and a whole chapter as one tall
// image. With auto-translate on:
//  1. only the chapter is translated: the logo, the cover and the emoji are not pages
//  2. the tall image goes part by part: the parts near the screen first, the rest as you scroll
//     to them, each asked once (2.12.0 sent the whole image at once)
//  3. the page count says one page, and the debug report holds one page with its parts
//  4. the button follows the image as the page scrolls under the pointer
// Usage: node strip.mjs [--ext ../../extension] [--out /tmp/gyt-browser/strip]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createCanvas, loadImage } from "canvas";
import { extensionCopy, agree } from "./ext-copy.mjs";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const extSrc = path.resolve(here, arg("--ext", "../../extension"));
const out = arg("--out", "/tmp/gyt-browser/strip"); fs.mkdirSync(out, { recursive: true });
const PORT = 8791, VW = 1200, VH = 900;

// the page and its images (synthetic: the demo page stacked six times is the "chapter")
const files = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-strip-"));
const demo = await loadImage(path.resolve(here, "../fixtures/demo-page.png"));
const W = 800, pageH = Math.round(demo.height * W / demo.width), COPIES = 6, H = pageH * COPIES;
const strip = createCanvas(W, H), sctx = strip.getContext("2d");
for (let k = 0; k < COPIES; k++) sctx.drawImage(demo, 0, k * pageH, W, pageH);
fs.writeFileSync(path.join(files, "strip.png"), strip.toBuffer("image/png"));
const picture = (w, h, colour, text) => {
  const c = createCanvas(w, h), x = c.getContext("2d");
  x.fillStyle = colour; x.fillRect(0, 0, w, h);
  x.fillStyle = "#000"; x.font = `bold ${Math.round(h / 4)}px sans-serif`; x.fillText(text, w * 0.08, h * 0.6);
  return c.toBuffer("image/png");
};
fs.writeFileSync(path.join(files, "logo.png"), picture(1156, 318, "#f6d365", "SITE LOGO"));
fs.writeFileSync(path.join(files, "cover.png"), picture(281, 400, "#a1c4fd", "COVER"));
fs.writeFileSync(path.join(files, "emoji.png"), picture(512, 512, "#ffd200", "OK"));
fs.writeFileSync(path.join(files, "reader.html"), `<!doctype html><title>Reader</title><body style="margin:0;background:#222">
  <header style="height:60px;display:flex;gap:12px;align-items:center;padding:0 12px"><img src="/files/logo.png" style="width:182px;height:50px">
  <img src="/files/cover.png" style="width:84px;height:120px"></header>
  <div style="display:flex;justify-content:center"><img id="chapter" src="/files/strip.png" style="width:${W}px;display:block"></div>
  <footer style="padding:12px">${"<img src='/files/emoji.png' style='width:42px;height:42px'>".repeat(3)}</footer></body>`);
// the same chapter at another address (nothing cached), alone on its page: no other overlay to move the button
fs.writeFileSync(path.join(files, "reader2.html"), `<!doctype html><title>Reader</title><body style="margin:0;background:#222"><div style="height:60px"></div>
  <div style="display:flex;justify-content:center"><img id="chapter" src="/files/strip.png?again" style="width:${W}px;display:block"></div></body>`);
// the parts the engine makes of it (prompt.js sliceGeometry with the default settings: 1800 px)
const PARTS = Math.ceil(H / 1800);

const ext = extensionCopy(extSrc, { apiUrl: `http://127.0.0.1:${PORT}/v1/messages` });
const { srv, calls, arrived } = await startMock(PORT, path.resolve(here, "../fixtures/demo-page.png"), { files, delayMs: 3000 });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--window-size=${VW},${VH}`],
  viewport: { width: VW, height: VH },
});
const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
await agree(sw);
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], autoSites: ["127.0.0.1"], debugOverlay: true, useContext: false, includeSource: false, model: "claude-sonnet-5-5" });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await new Promise((r) => setTimeout(r, 300));

let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failures++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(250); } return false; };

const page = await context.newPage();
await page.goto(`http://127.0.0.1:${PORT}/files/reader.html`);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
const state = () => sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "GET_STATE" }), tabId).catch(() => null);

// 1–2. at the top: the parts within two screens, nothing else
await until(async () => { const st = await state(); return st && st.done >= 1 && !st.working; }, 90000);
await wait(2500); // anything else that was going to start, would have
const near = Math.ceil((60 + 3 * VH) / 1800); // parts whose top is within two screens below this one
const atTop = calls.map((c) => `${c.w}×${c.h}`);
check("only the chapter is translated (no logo, cover or emoji)", calls.every((c) => c.w === W), atTop.join(", "));
check(`at the top, the ${near} part(s) near the screen are asked, not the whole image (${PARTS} parts)`, calls.length === near, `${calls.length} question(s): ${atTop.join(", ")}`);
await page.screenshot({ path: path.join(out, "1-top.png") });

// 2. scrolling down the image: the rest of its parts, each once
for (let y = 2200; y <= H; y += 700) { await page.evaluate((y) => scrollTo(0, y), y); await wait(400); }
await until(async () => { const st = await state(); return calls.length >= PARTS && st && !st.working; }, 120000);
await wait(2500);
check(`scrolled to the end: every part asked once (${PARTS})`, calls.length === PARTS, `${calls.length} question(s)`);
await page.screenshot({ path: path.join(out, "2-end.png") });

// 3. one page, and one page in the report, with its parts
const st = await state();
check("the page count says 1 (the chapter), not the logo, cover and emoji", st?.done === 1 && st.working === 0, JSON.stringify(st));
const rep = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "DEBUG_REPORT" }), tabId);
check(`the debug report has the image's ${PARTS} parts and their lines`, rep?.parts?.length === PARTS && rep.items?.length > PARTS && rep.natural?.[1] === H, `${rep?.parts?.length} parts, ${rep?.items?.length} lines`);
const exp = await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: "EXPORT_REPORT" }), tabId);
check("the exported report holds one page with its debug render", exp?.ok && exp.pages === 1 && exp.files.includes("page-01.debug.png"), JSON.stringify(exp?.files));
const asked = calls.length;
await wait(1500);
check("exporting the report asked Claude nothing", calls.length === asked, `${calls.length - asked} question(s)`);

// 4. the button follows the image while the page scrolls under the pointer
const cdp = await context.newCDPSession(page);
const barBox = async () => {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  let id = null;
  const walk = (n) => { if (id) return; if (n.nodeName === "DIV" && (n.attributes || []).join(" ").match(/class bar( |$)/)) { id = n.nodeId; return; } for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); };
  walk(root);
  if (!id) return null;
  const { model } = await cdp.send("DOM.getBoxModel", { nodeId: id }).catch(() => ({ model: null }));
  return model ? { left: model.border[0], top: model.border[1], right: model.border[2] } : null; // (the border box: style.left/top)
};
const chapterBox = () => page.evaluate(() => { const r = document.getElementById("chapter").getBoundingClientRect(); return { top: r.top, right: r.right }; });
// (a fresh copy of the chapter, while its first parts are with Claude: no overlay yet, so nothing
// else places the button)
const asked0 = arrived.length;
await page.goto(`http://127.0.0.1:${PORT}/files/reader2.html`);
await until(() => arrived.length > asked0, 30000);
await page.mouse.move(VW / 2, VH / 2);
await wait(400);
const before = await barBox(), img0 = await chapterBox();
check("the button sits at the image's top right corner", before && Math.abs(before.top - Math.max(4, img0.top + 8)) <= 2 && Math.abs(before.right - (img0.right - 8)) <= 12, `${JSON.stringify(before)}; image top ${img0.top}, right ${img0.right}`);
await page.mouse.wheel(0, 2200); // the pointer stays on the image: no new mouseover
await wait(800);
const after = await barBox(), img = await chapterBox();
check("after scrolling 2200 px under the pointer, the button is at the top of the screen, at the image's right edge", after && Math.abs(after.top - 4) <= 2 && Math.abs(after.right - (img.right - 8)) <= 12, `${JSON.stringify(after)}; image top ${img.top}`);

await context.close(); srv.close();
console.log(failures ? `\n${failures} FAILED` : "\nSTRIP TEST PASSED");
process.exit(failures ? 1 : 0);
