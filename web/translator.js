// Gytakusub Web – translation pipeline. The page engine (OpenCV analysis,
// stamps, erase, layout) runs in engine-worker.js; this module calls Claude
// and draws the text, mirroring the extension's service worker + content script.
import { callClaude, mergeContext, apiHeaders, API_URL } from "./prompt.js";
import { limitsOf, explainApiError } from "./usage.js";
import { recordClaudeUsage, recordClaudePage } from "./claude-usage.js";
import { letteringFor } from "./languages.js";
import { t } from "./i18n.js";

// every answer is logged as it arrives, so a page whose other slice fails still counts what it cost
const callAndRecord = (settings, slice, ctx) => callClaude(settings, slice, ctx).then((r) => { recordClaudeUsage(r); return r; });

const GyText = globalThis.GyText;

let worker = null, seq = 0;
const pending = new Map();
function rpc(msg, transfer = []) {
  if (!worker) {
    worker = new Worker("./engine-worker.js", { type: "module" });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
    worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error(e.message || "engine worker failed")); pending.clear(); };
  }
  const id = ++seq;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, ...msg }, transfer); });
}

export const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-haiku-5-5",
  targetLang: "English",
  glossary: "",
  customPrompt: "",
  useContext: true,
  includeSource: false,
  uppercase: false,
  fontFamily: "",
  rtlSpreads: true,
  fetcherUrl: "", // your chapter fetcher (fetcher/worker.js on Cloudflare), e.g. https://gytakusub.<you>.workers.dev
  fetcherKey: "", // its access key (the Worker's GYT_KEY secret)
  maxLongEdge: 1600,
  stripWidth: 1000,
  sliceHeight: 1800,
};

const SETTINGS_KEY = "gytakusub.settings";
export function loadSettings() {
  try {
    // creditPlan/creditCustom/creditRenews: the monthly-credit fields removed in 2.7.0 (see usage.js)
    const { creditPlan, creditCustom, creditRenews, ...saved } = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
  }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}

export function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(t("web_cannot_decode"))); im.src = src; });
}

/**
 * Translate one page image.
 * @param {HTMLImageElement} img  decoded page
 * @param {object} settings
 * @param {{terms:Array, recent:Array}} ctx  chapter context (mutated via return)
 * @returns {{items, placements, regions, work, letter, clean:ImageBitmap, width, height, usage, ctx}}
 */
export async function translateImage(img, settings, ctx = { terms: [], recent: [] }) {
  if (!settings.apiKey) throw new Error(t("web_no_key"));
  const bitmap = await createImageBitmap(img);
  const prep = await rpc({ type: "prepare", bitmap, settings: { maxLongEdge: settings.maxLongEdge, stripWidth: settings.stripWidth, sliceHeight: settings.sliceHeight } }, [bitmap]);
  let results;
  try { results = await Promise.all(prep.slices.map((s) => callAndRecord(settings, s, ctx))); }
  catch (e) { rpc({ type: "drop", jobId: prep.jobId }).catch(() => {}); throw e; }
  recordClaudePage(results);
  const terms = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const r of results) { terms.push(...r.terms); if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; } }
  const fin = await rpc({ type: "finish", jobId: prep.jobId, results: results.map((r) => ({ items: r.items })) });
  return { items: fin.items, placements: fin.placements, regions: fin.regions, work: fin.work, letter: fin.letter, clean: fin.clean, width: prep.width, height: prep.height, usage, ctx: mergeContext(ctx, terms, fin.items.map((i) => i.text)) };
}

// Hyphenation for the target language: English's patterns load with the page
// (vendor/hyphen-en.js); others from vendor/hyphen/<name>.json, once. None for the rest.
const hyphenators = new Map();
function hyphenatorFor(targetLang) {
  const { hyphen } = letteringFor(targetLang);
  if (!hyphen) return Promise.resolve(null);
  if (hyphen === "en-us") return Promise.resolve(globalThis.GyHyphen?.hyphenateEn || null);
  if (!hyphenators.has(hyphen)) {
    hyphenators.set(hyphen, fetch(`./vendor/hyphen/${hyphen}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((patterns) => GyHyphen.create(patterns))
      .catch((e) => { console.warn("Gytakusub: no hyphenation for", hyphen, e); hyphenators.delete(hyphen); return null; }));
  }
  return hyphenators.get(hyphen);
}

/** Everything drawing needs before the first page: the lettering fonts and the target language's hyphenation. */
export async function prepareLettering(settings) {
  const fonts = document.fonts ? (globalThis.GyFonts || []).map((f) => document.fonts.load(`${f.weight} 20px "${f.family}"`).catch(() => null)) : [];
  const [hyphenator] = await Promise.all([hyphenatorFor(settings.targetLang), ...fonts]);
  return { lang: letteringFor(settings.targetLang).lang, hyphenator };
}

/**
 * Render original + translated canvases at the engine's working resolution.
 * `look`: prepareLettering()'s answer (the target language's rules).
 * @returns {{original:HTMLCanvasElement, translated:HTMLCanvasElement, drawn:number}}
 */
export function renderPage(img, result, settings, look = {}) {
  const { W, H } = result.work;
  const original = document.createElement("canvas"); original.width = W; original.height = H;
  original.getContext("2d").drawImage(img, 0, 0, W, H);
  const translated = document.createElement("canvas"); translated.width = W; translated.height = H;
  const tctx = translated.getContext("2d");
  tctx.drawImage(result.clean, 0, 0);
  const drawn = GyText.draw(tctx, result.placements, { fontFamily: settings.fontFamily, uppercase: settings.uppercase, lang: look.lang ?? null, hyphenator: look.hyphenator ?? null });
  return { original, translated, drawn };
}

export async function testKey(settings) {
  const res = await fetch(API_URL, {
    method: "POST", headers: apiHeaders(settings.apiKey),
    body: JSON.stringify({ model: settings.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK" }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const hint = explainApiError(res.status, j); throw new Error(`${res.status}: ${j?.error?.message || res.statusText}${hint ? " " + hint : ""}`); }
  recordClaudeUsage({ usage: j.usage, model: j.model || settings.model, limits: limitsOf(res.headers) }); // the test costs a few tokens too
  return true;
}
