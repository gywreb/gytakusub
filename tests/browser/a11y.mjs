// Real-browser test of the overlay without a mouse, and of what the browser can read (2.12.1):
//  1. the translated lines are in the accessibility tree: one group per image, a button per line
//  2. the keyboard reaches them (Tab), moves between them (arrows) without the page seeing the
//     keys, and Enter opens the editor
//  3. the editor is a modal dialog: Ctrl+Enter saves, Esc cancels, the focus comes back to the line
//  4. the readable view (small lines): shown on focus and on hover, kept while the pointer moves
//     onto it, put away with Esc; a long press (touch) shows it with Edit, which opens the editor
//  5. the popup's and Options' toggles are switches
// Usage: node a11y.mjs [--ext ../../extension] [--out /tmp/gyt-browser/a11y]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extensionCopy, agree } from "./ext-copy.mjs";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const extSrc = path.resolve(here, arg("--ext", "../../extension"));
const out = arg("--out", "/tmp/gyt-browser/a11y"); fs.mkdirSync(out, { recursive: true });
const PORT = 8793;
const pageImage = path.resolve(here, "../fixtures/demo-page.png");
const { srv } = await startMock(PORT, pageImage, { truth: pageImage.replace(/-page\.png$/, "-truth.json") });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failures++; };

// the page counts the keys it sees, as a reader with arrow-key page turning would
const READER = (width) => `<!doctype html><title>Reader</title><body style="margin:0;background:#111">
  <a href="#" id="before">a link on the page</a><div style="height:40px"></div>
  <img id="p1" src="/page.png" style="width:${width}px;display:block;margin:0 auto"><div style="height:2000px"></div>
  <script>window.keysSeen = []; document.addEventListener("keydown", (e) => keysSeen.push(e.key));</script></body>`;

const ext = extensionCopy(extSrc, { apiUrl: `http://127.0.0.1:${PORT}/v1/messages` });
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-")), {
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1200, height: 900 },
});
const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
await agree(sw);
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], useContext: false, includeSource: false });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await wait(400);

const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Accessibility.enable");
async function openReader(width) {
  await page.route("**/reader*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: READER(width) }));
  await page.goto(`http://127.0.0.1:${PORT}/reader?w=${width}`); await page.waitForLoadState("load"); await wait(500);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:*/*", active: true }))[0]?.id);
  await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "TRANSLATE_VISIBLE", force: true }), { tabId });
  for (let i = 0; i < 300; i++) {
    const st = await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "GET_STATE" }), { tabId }).catch(() => null);
    if (st?.done >= 1 && !st.working) break;
    await wait(300);
  }
  await wait(300);
  return sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "DEBUG_REPORT" }), { tabId });
}
const ax = async () => (await cdp.send("Accessibility.getFullAXTree")).nodes;
const name = (n) => n.name?.value || "";
// (the document has the focus too: the innermost focused node is the last)
const focusedNode = async () => (await ax()).filter((n) => n.properties?.some((p) => p.name === "focused" && p.value.value) && n.role?.value !== "RootWebArea").pop();
// the shadow root's own elements, by class (the root is closed: only the protocol sees into it)
async function shadowBox(cls) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  let node = null;
  const walk = (n) => { if (node) return; if ((n.attributes || []).join(" ").match(new RegExp(`class ${cls}( |$)`))) { node = n; return; } for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); };
  walk(root);
  if (!node) return null;
  const attrs = Object.fromEntries((node.attributes || []).reduce((a, v, i, all) => (i % 2 ? a : [...a, [v, all[i + 1]]]), []));
  const { model } = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId }).catch(() => ({ model: null }));
  return { attrs, box: model ? { left: model.border[0], top: model.border[1], right: model.border[2], bottom: model.border[5] } : null };
}
const shown = async (cls) => { const b = await shadowBox(cls); return !!(b && b.box && !("hidden" in b.attrs)); };

// ---- 1. the lines, as the browser sees them (a page shown large: no readable view) ----
const rep = await openReader(1000);
const lines = rep.placements.map((p) => p.text);
let nodes = await ax();
const group = nodes.find((n) => n.role?.value === "group" && name(n) === "Translated text");
const buttons = nodes.filter((n) => n.role?.value === "button" && lines.includes(name(n)));
check("the translations are in the accessibility tree: a group with a button per line", group && buttons.length === lines.length, `${buttons.length} of ${lines.length} lines; group ${!!group}`);
const canvases = nodes.filter((n) => n.role?.value === "canvas" && !n.ignored);
check("the drawn overlay itself is hidden from it (no duplicate)", canvases.length === 0, `${canvases.length} canvas node(s)`);

// ---- 2. the keyboard ----
await page.focus("#before");
await page.keyboard.press("Tab");
let f = await focusedNode();
check("Tab from the page reaches the first line", f && name(f) === lines[0], `focused: ${f && name(f)}`);
await page.evaluate(() => { window.keysSeen.length = 0; });
await page.keyboard.press("ArrowDown");
f = await focusedNode();
check("ArrowDown moves to the next line", f && name(f) === lines[1], `focused: ${f && name(f)}`);
await page.keyboard.press("End");
f = await focusedNode();
check("End goes to the last line", f && name(f) === lines[lines.length - 1], `focused: ${f && name(f)}`);
await page.keyboard.press("Home");
const seen = await page.evaluate(() => window.keysSeen.slice());
check("the page doesn't see the arrow keys used between lines (no page turn)", !seen.some((k) => /^Arrow|Home|End/.test(k)), JSON.stringify(seen));

// ---- 3. the editor ----
await page.keyboard.press("Enter"); await wait(200);
nodes = await ax();
const dlg = nodes.find((n) => n.role?.value === "dialog" && name(n) === "Edit translation");
check("Enter on a line opens the editor, a modal dialog", dlg && dlg.properties?.some((p) => p.name === "modal" && p.value.value), dlg ? JSON.stringify(dlg.properties?.map((p) => p.name)) : "no dialog");
await page.keyboard.press("Control+a"); await page.keyboard.type("KEYBOARD EDIT");
await page.screenshot({ path: path.join(out, "1-editor.png") });
await page.keyboard.press("Control+Enter"); await wait(300);
nodes = await ax();
f = await focusedNode();
check("Ctrl+Enter saves: the line reads the new text", nodes.some((n) => n.role?.value === "button" && name(n) === "KEYBOARD EDIT"), "");
check("closing gives the focus back to the line", f && name(f) === "KEYBOARD EDIT", `focused: ${f && name(f)}`);
await page.keyboard.press("Enter"); await wait(200);
await page.keyboard.press("Control+a"); await page.keyboard.type("NOT SAVED");
await page.keyboard.press("Escape"); await wait(300);
nodes = await ax();
check("Esc closes the editor without saving", !nodes.some((n) => name(n) === "NOT SAVED") && nodes.some((n) => name(n) === "KEYBOARD EDIT") && !nodes.some((n) => n.role?.value === "dialog" && name(n) === "Edit translation"), "");
await page.screenshot({ path: path.join(out, "1-keyboard.png") });

// ---- 4. the readable view: the page shown small, so its lines are drawn under 9 px ----
// (280 px, the narrowest image translated: since 2.14.1 sets text to the bubble's shape, larger,
// the first line is 9.6 px at 330)
const small = await openReader(280);
await page.focus("#before"); await page.keyboard.press("Tab"); await wait(200);
check("a small line with the keyboard on it shows the readable view", await shown("readable"), "");
await page.keyboard.press("Escape"); await wait(150);
check("Esc puts it away", !(await shown("readable")), "");
await page.keyboard.press("ArrowDown"); await wait(200);
check("the next line shows it again", await shown("readable"), "");
await page.screenshot({ path: path.join(out, "2-readable-focus.png") });
await page.evaluate(() => document.activeElement.blur()); await wait(150);

const img = await page.evaluate(() => { const r = document.getElementById("p1").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; });
const k = img.width / small.work.W, p0 = small.placements[0];
const at = { x: img.left + (p0.rect.x + p0.rect.w / 2) * k, y: img.top + (p0.rect.y + p0.rect.h / 2) * k };
await page.mouse.move(5, 5); await wait(400);
await page.mouse.move(at.x, at.y); await page.mouse.move(at.x + 1, at.y); await wait(600);
const view = await shadowBox("readable");
check("resting the pointer on a small line shows it", view && !("hidden" in view.attrs), "");
if (view?.box) {
  // across the gap and onto the view: it stays
  const tx = (view.box.left + view.box.right) / 2, ty = (view.box.top + view.box.bottom) / 2;
  for (let s = 1; s <= 6; s++) { await page.mouse.move(at.x + (tx - at.x) * s / 6, at.y + (ty - at.y) * s / 6); await wait(40); }
  await wait(600);
  check("moving the pointer onto the view keeps it (WCAG 1.4.13)", await shown("readable"), "");
  await page.keyboard.press("Escape"); await wait(150);
  check("Esc puts it away with the pointer still on it", !(await shown("readable")), "");
  await page.mouse.move(at.x, at.y); await page.mouse.move(at.x + 1, at.y); await wait(600);
  check("…and it doesn't come back on the same line until the pointer goes elsewhere", !(await shown("readable")), "");
}
await page.mouse.move(5, 5); await wait(500);

// long press (touch), on a line of any size: the view, with Edit
await openReader(1000);
const big = await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ url: "http://127.0.0.1:*/*", active: true }); return chrome.tabs.sendMessage(t.id, { type: "DEBUG_REPORT" }); });
const img2 = await page.evaluate(() => { const r = document.getElementById("p1").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; });
const k2 = img2.width / big.work.W, q = big.placements[1];
const tp = { x: Math.round(img2.left + (q.rect.x + q.rect.w / 2) * k2), y: Math.round(img2.top + (q.rect.y + q.rect.h / 2) * k2) };
if (tp.y > 860) { await page.evaluate((y) => scrollBy(0, y), tp.y - 400); tp.y = 400; await wait(300); }
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tp.x, y: tp.y }] });
await wait(800);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await wait(200);
const pressed = await shadowBox("readable");
check("a long press on a line shows it, with Edit", pressed && !("hidden" in pressed.attrs), "");
await page.screenshot({ path: path.join(out, "3-long-press.png") });
nodes = await ax();
const edit = nodes.find((n) => n.role?.value === "button" && name(n) === "Edit");
if (edit && pressed?.box) {
  const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: edit.backendDOMNodeId });
  const ex = (model.border[0] + model.border[2]) / 2, ey = (model.border[1] + model.border[5]) / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ex, y: ey }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await wait(300);
  nodes = await ax();
  check("tapping Edit opens the editor", nodes.some((n) => n.role?.value === "dialog" && name(n) === "Edit translation"), "");
  await page.keyboard.press("Escape"); await wait(200);
} else check("tapping Edit opens the editor", false, "no Edit button");

// ---- 5. switches ----
const extId = sw.url().split("/")[2];
for (const [file, min] of [["popup.html", 4], ["options.html", 6]]) { // (options: 6 since 2.14, the original-text option gone)
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/${file}`); await wait(600);
  const c2 = await context.newCDPSession(p);
  const all = (await c2.send("Accessibility.getFullAXTree")).nodes;
  const sws = all.filter((n) => n.role?.value === "switch");
  check(`${file}: its toggles are switches, each with a name`, sws.length >= min && sws.every((n) => name(n)), `${sws.length} switches; ${sws.filter((n) => !name(n)).length} unnamed`);
  await p.close();
}

await context.close(); srv.close();
console.log(failures ? `\n${failures} FAILED` : "\nA11Y TEST PASSED");
process.exit(failures ? 1 : 0);
