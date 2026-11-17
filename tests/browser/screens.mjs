// Every screen size and pixel density, in the real extension (2.11.0). A responsive reader (the
// page at 100% width, max 1400 px) is translated once; then, on 1×, 2× and 3× screens and at
// 390, 768, 1366 and 2560 px wide:
//  - the overlay has the screen's own pixels (backing = size on screen × devicePixelRatio), not
//    the engine's working size stretched;
//  - in a narrow window, where lines are drawn under 9 px, resting the pointer on one shows it at
//    a readable size;
//  - a page far from the screen gives its pixels back and is drawn again on return.
// A crop of one bubble per size is saved for review (--out).
//   node browser/screens.mjs [--out dir] [--ext path-to-extension] [--page image] [--dpr 1,2,3] [--measure-only]
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
const out = arg("--out", "/tmp/gyt-browser/screens"); fs.mkdirSync(out, { recursive: true });
const extDir = path.resolve(arg("--ext", path.resolve(here, "../../extension")));
const measureOnly = process.argv.includes("--measure-only"); // the build under test may predate these features
const PORT = Number(arg("--port", 8797));
const pageImage = path.resolve(arg("--page", path.resolve(here, "../fixtures/demo-page.png"))); // any page: the mock answers per stamped region
const DPRS = arg("--dpr", "1,2,3").split(",").map(Number);
const truthFile = pageImage.replace(/-page\.png$/, "-truth.json");
const { srv } = await startMock(PORT, pageImage, { truth: truthFile !== pageImage && fs.existsSync(truthFile) ? truthFile : undefined });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const READER = `<!doctype html><meta name="viewport" content="width=device-width"><title>Reader</title><body style="margin:0;background:#111">
  <div style="height:60px"></div><img id="p1" src="/page.png" style="width:100%;max-width:1400px;display:block;margin:0 auto"><div id="tail" style="height:9000px"></div></body>`;

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const rows = [];
const rel0 = {}; // per density: each line's size / page width at the first size

for (const dpr of DPRS) {
  const ext = extensionCopy(extDir, { apiUrl: `http://127.0.0.1:${PORT}/v1/messages` });
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-")), {
    channel: process.env.GYT_CHANNEL || "chromium", headless: false,
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: { width: 1366, height: 900 }, deviceScaleFactor: dpr,
  });
  const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
  await agree(sw);
  await sw.evaluate(async () => {
    await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], useContext: false, includeSource: false });
    await chrome.storage.local.set({ apiKey: "sk-ant-test" });
  });
  await wait(400);
  const page = await context.newPage();
  await page.route("**/reader", (r) => r.fulfill({ status: 200, contentType: "text/html", body: READER }));
  await page.goto(`http://127.0.0.1:${PORT}/reader`); await page.waitForLoadState("load"); await wait(500);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:*/*", active: true }))[0]?.id);
  const send = (m) => sw.evaluate(({ tabId, m }) => chrome.tabs.sendMessage(tabId, m), { tabId, m });
  await send({ type: "TRANSLATE_VISIBLE", force: true });
  let state = null;
  for (let i = 0; i < 300; i++) { state = await send({ type: "GET_STATE" }).catch(() => null); if (state?.done >= 1 && !state.working) break; await wait(300); }
  check(`${dpr}×: the page is translated`, state?.done >= 1, JSON.stringify(state));
  const first = await send({ type: "DEBUG_REPORT" });
  const pl = first.placements.slice().sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];

  for (const width of [390, 768, 1366, 2560]) {
    await page.setViewportSize({ width, height: 900 }); await wait(250);
    const r = await page.evaluate(() => { const b = document.querySelector("#p1").getBoundingClientRect(); return { left: b.left, top: b.top + scrollY, width: b.width, height: b.height }; });
    const s = r.width / first.work.W; // CSS px per work px
    const cy = r.top + (pl.rect.y - pl.letter) * s;
    await page.evaluate((y) => scrollTo(0, Math.max(0, y - 40)), cy); await wait(1100); // the redraw follows the resize after it settles
    const rep = await send({ type: "DEBUG_REPORT" });
    // the screen's pixels, within the overlay's budget of 16 million (content.js MAX_BACKING)
    const cap = Math.min(1, Math.sqrt(16e6 / (r.width * dpr * r.height * dpr)));
    const want = [Math.round(r.width * dpr * cap), Math.round(r.height * dpr * cap)];
    const got = rep.overlay?.backing || [rep.work.W, rep.work.H];
    const ratio = got[0] / want[0];
    const sizes = rep.overlay?.lineSizes || [];
    const smallest = sizes.length ? Math.min(...sizes) : +(pl.letter * s).toFixed(1);
    const row = { dpr, width, imageCss: Math.round(r.width), backing: got, screenPixels: [Math.round(r.width * dpr), Math.round(r.height * dpr)], backingPerScreenPixel: +(got[0] / (r.width * dpr)).toFixed(2), smallestLineCss: smallest };
    rows.push(row); console.log(JSON.stringify(row));
    // never stretched (≥ 99% of the screen's pixels); at most 11% more (it shrinks lazily)
    if (!measureOnly) check(`${dpr}× at ${width} px: the overlay has the screen's pixels`, ratio >= 0.99 && ratio <= 1.11, `${got.join("×")} for ${want.join("×")}`);
    if (!measureOnly) {
      // the overlay sits exactly on the image's picture, and each line keeps its size relative to the page
      const [a, b] = [rep.overlay.rect, rep.overlay.image];
      const off = Math.max(...a.map((v, j) => Math.abs(v - b[j])));
      check(`${dpr}× at ${width} px: the overlay sits on the picture`, off < 0.6, `off by ${off.toFixed(2)} px (${a.join(",")} vs ${b.join(",")})`);
      const rel = sizes.map((v) => v / r.width);
      if (!rel0[dpr]) rel0[dpr] = rel;
      else { const worst = Math.max(...rel.map((v, j) => Math.abs(v / rel0[dpr][j] - 1))); check(`${dpr}× at ${width} px: every line keeps its size relative to the page`, worst < 0.03, `worst ${(worst * 100).toFixed(1)}%`); }
    }
    // a crop of the biggest line, for review
    const sy = await page.evaluate(() => scrollY);
    const cx = r.left + (pl.rect.x - pl.letter) * s, cw = (pl.rect.w + 2 * pl.letter) * s, ch = (pl.rect.h + 2 * pl.letter) * s;
    await page.screenshot({ path: path.join(out, `dpr${dpr}-w${width}.png`), clip: { x: Math.max(0, cx), y: cy - sy, width: Math.min(cw, width), height: Math.min(ch, 860) } });

    // narrow: rest the pointer on the smallest line → a readable copy appears
    if (width === 390 && !measureOnly) {
      check(`${dpr}× at 390 px: lines are drawn under 9 px (the case for the readable view)`, smallest < 9, `smallest ${smallest} px`);
      const i = sizes.indexOf(smallest), p = rep.placements[i];
      const k = r.width / rep.work.W;
      const px = r.left + (p.rect.x + p.rect.w / 2) * k, py = r.top - sy + (p.rect.y + p.rect.h / 2) * k;
      let lastShot = null;
      const shoot = async () => {
        lastShot = await page.screenshot({ clip: { x: 0, y: 0, width, height: 900 } });
        const im = await loadImage(lastShot), c = createCanvas(im.width, im.height), x = c.getContext("2d");
        x.drawImage(im, 0, 0); return x.getImageData(0, 0, im.width, im.height);
      };
      await page.mouse.move(5, 5); await wait(400);
      const before = await shoot();
      await page.mouse.move(px, py); await page.mouse.move(px + 1, py); await wait(700);
      const after = await shoot();
      let changed = 0;
      for (let q = 0; q < before.data.length; q += 4) if (Math.abs(before.data[q] - after.data[q]) + Math.abs(before.data[q + 1] - after.data[q + 1]) > 60) changed++;
      fs.writeFileSync(path.join(out, `dpr${dpr}-w390-readable.png`), lastShot);
      check(`${dpr}× at 390 px: resting on a small line shows it readable`, changed > 2000 * dpr * dpr, `${changed} device pixels changed`);
      await page.mouse.move(5, 5); await wait(400);
      const gone = await shoot();
      let still = 0;
      for (let q = 0; q < before.data.length; q += 4) if (Math.abs(before.data[q] - gone.data[q]) > 60) still++;
      check(`${dpr}× at 390 px: …and it goes when the pointer leaves`, still < 200 * dpr * dpr, `${still} device pixels still changed`);
    }
  }

  // far from the screen: pixels released; back: drawn again
  if (!measureOnly) {
    await page.setViewportSize({ width: 1366, height: 900 }); await wait(300);
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await wait(1200);
    const far = await send({ type: "DEBUG_REPORT" });
    check(`${dpr}×: a page far from the screen gives its pixels back`, far.overlay?.backing?.[0] === 0, JSON.stringify(far.overlay?.backing));
    await page.evaluate(() => scrollTo(0, 0)); await wait(1200);
    const back = await send({ type: "DEBUG_REPORT" });
    check(`${dpr}×: …and is drawn again on return`, back.overlay?.backing?.[0] > 0, JSON.stringify(back.overlay?.backing));
  }
  await context.close();
}
fs.writeFileSync(path.join(out, "screens.json"), JSON.stringify(rows, null, 1));
srv.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
