// Lettering in other languages, in the real extension: the mock model answers in the target
// language, and the page is checked for the font it was drawn in, the hyphenation the worker
// served, and the bundled fonts actually loading into the page.
//   node browser/lettering.mjs [--out dir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extensionCopy, agree } from "./ext-copy.mjs";
import { startMock } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const out = arg("--out", "/tmp/gyt-browser/lettering"); fs.mkdirSync(out, { recursive: true });
const PORT = 8794;
const pageImage = path.resolve(here, "../fixtures/demo-page.png");

// what the "model" says, per target language
const SAYS = {
  English: ["I never thought it would come to this.", "Wait!", "Are you sure about that?", "We leave at dawn. No excuses.", "That's impossible...", "Behind you!", "Fine. Have it your way."],
  Vietnamese: ["Tôi chưa bao giờ nghĩ mọi chuyện lại thành ra thế này.", "Khoan đã!", "Cậu chắc chứ?", "Bình minh ta lên đường. Không viện cớ.", "Không thể nào...", "Sau lưng cậu kìa!", "Được thôi. Tùy cậu."],
  Japanese: ["こんなことになるなんて、思ってもみなかった。", "待って！", "本当にそれでいいの？", "夜明けに出発だ。言い訳は聞かない。", "ありえない……", "後ろだ！", "いいよ。好きにすれば。"],
  "Chinese (Simplified)": ["我从没想过事情会变成这样。", "等等！", "你确定吗？", "我们黎明出发。不许找借口。", "这不可能……", "小心后面！", "好吧，随你。"],
  German: ["Ich hätte nie gedacht, dass es so weit kommt.", "Warte!", "Bist du dir da sicher?", "Wir brechen im Morgengrauen auf. Keine Ausreden.", "Unmöglich...", "Hinter dir!", "Schön. Wie du willst."],
  Russian: ["Никогда не думал, что до этого дойдёт.", "Стой!", "Ты в этом уверен?", "Выходим на рассвете. Без отговорок.", "Невозможно...", "Сзади!", "Ладно. Как хочешь."],
  Thai: ["ไม่เคยคิดเลยว่าเรื่องจะมาถึงขั้นนี้", "เดี๋ยวก่อน!", "แน่ใจเหรอ?", "เราออกเดินทางตอนรุ่งสาง ห้ามแก้ตัว", "เป็นไปไม่ได้...", "ข้างหลังนาย!", "ก็ได้ ตามใจนาย"],
};
// the font each should be drawn in (first family in the stack), and whether it hyphenates
const EXPECT = {
  English: ["Gytakusub Comic", true], Vietnamese: ["Gytakusub Mali", false], Japanese: ["Hiragino Maru Gothic ProN", false],
  "Chinese (Simplified)": ["PingFang SC", false], German: ["Gytakusub Comic", true], Russian: ["Gytakusub Comic Relief", false], Thai: ["Gytakusub Mali", false],
};
let current = "English";
const { srv } = await startMock(PORT, pageImage, { truth: pageImage.replace(/-page\.png$/, "-truth.json"), texts: () => SAYS[current] });

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ext = extensionCopy(path.resolve(here, "../../extension"), { apiUrl: `http://127.0.0.1:${PORT}/v1/messages` });
const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "gyt-prof-")), {
  channel: process.env.GYT_CHANNEL || "chromium", headless: false,
  args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--window-size=1200,900"],
  viewport: { width: 1200, height: 900 },
});
const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const extId = new URL(sw.url()).host;
await agree(sw);
await sw.evaluate(async () => {
  await chrome.storage.sync.set({ enabled: true, enabledSites: ["127.0.0.1"], useContext: false, includeSource: false });
  await chrome.storage.local.set({ apiKey: "sk-ant-test" });
});
await wait(400);

// the worker serves only the pattern files languages.js names
const opts = await context.newPage(); await opts.goto(`chrome-extension://${extId}/options.html`);
const ask = (m) => opts.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
const de = await ask({ type: "GET_HYPHENATION", name: "de-1996" });
check("the worker serves German hyphenation patterns", Array.isArray(de?.patterns) && de.patterns.length > 0);
const bad = await ask({ type: "GET_HYPHENATION", name: "../manifest" });
check("…and refuses a name it doesn't know", !bad?.patterns && /Unknown/.test(bad?.error || ""), bad?.error);
await opts.close();

for (const lang of Object.keys(SAYS)) {
  current = lang;
  await sw.evaluate((l) => chrome.storage.sync.set({ targetLang: l }), lang);
  await wait(300);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForLoadState("load"); await wait(500);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://127.0.0.1:*/*", active: true }))[0]?.id);
  await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "TRANSLATE_VISIBLE", force: true }), { tabId });
  let state = null;
  for (let i = 0; i < 300; i++) { state = await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "GET_STATE" }), { tabId }).catch(() => null); if (state?.done >= 1 && !state.working) break; await wait(200); }
  check(`${lang}: the page is translated`, state?.done >= 1, JSON.stringify(state));
  const report = await sw.evaluate(({ tabId }) => chrome.tabs.sendMessage(tabId, { type: "DEBUG_REPORT" }), { tabId });
  const [font, hyphenates] = EXPECT[lang];
  const first = (report?.lettering?.family || "").split(",")[0].replace(/"/g, "").trim();
  check(`${lang}: drawn in ${font}`, first === font, report?.lettering?.family);
  check(`${lang}: hyphenation ${hyphenates ? "on" : "off"}`, report?.lettering?.hyphenation === hyphenates, JSON.stringify(report?.lettering));
  check(`${lang}: the model's words are what's drawn`, report?.placements?.some((p) => p.text === SAYS[lang][1]), report?.placements?.map((p) => p.text).join(" | ").slice(0, 120));
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")));
  check(`${lang}: the bundled fonts are loaded in the page`, ["Gytakusub Comic", "Gytakusub Comic Relief", "Gytakusub Mali"].every((f) => loaded.includes(f)), loaded.join(", "));
  await page.screenshot({ path: path.join(out, `${lang.replace(/\W+/g, "-").toLowerCase()}.png`), clip: { x: 240, y: 120, width: 720, height: 780 } });
  await page.close();
}

await context.close(); srv.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
