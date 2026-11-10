// Gytakusub Web – translation pipeline. The page engine (OpenCV analysis,
// stamps, erase, layout) runs in engine-worker.js; this module calls Claude
// and draws the text, mirroring the extension's service worker + content script.
import { callClaude, mergeContext, apiHeaders, API_URL } from "./prompt.js";
import { limitsOf, explainApiError } from "./usage.js";
import { recordClaudeUsage } from "./claude-usage.js";

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
  creditPlan: "none", // a Max or Team plan's monthly Claude API credit (usage.js CREDIT_PLANS)
  creditCustom: 0, // USD a month, for creditPlan "custom"
  creditRenews: "", // YYYY-MM-DD, from the Console's Billing page
  fetcherUrl: "", // your chapter fetcher (fetcher/worker.js on Cloudflare), e.g. https://gytakusub.<you>.workers.dev
  fetcherKey: "", // its access key (the Worker's GYT_KEY secret)
  maxLongEdge: 1600,
  stripWidth: 1000,
  sliceHeight: 1800,
};

const SETTINGS_KEY = "gytakusub.settings";
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}

export function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Could not decode image")); im.src = src; });
}

/**
 * Translate one page image.
 * @param {HTMLImageElement} img  decoded page
 * @param {object} settings
 * @param {{terms:Array, recent:Array}} ctx  chapter context (mutated via return)
 * @returns {{items, placements, regions, work, letter, clean:ImageBitmap, width, height, usage, ctx}}
 */
export async function translateImage(img, settings, ctx = { terms: [], recent: [] }) {
  if (!settings.apiKey) throw new Error("No API key set — open Settings (⚙) and paste your Claude API key.");
  const bitmap = await createImageBitmap(img);
  const prep = await rpc({ type: "prepare", bitmap, settings: { maxLongEdge: settings.maxLongEdge, stripWidth: settings.stripWidth, sliceHeight: settings.sliceHeight } }, [bitmap]);
  let results;
  try { results = await Promise.all(prep.slices.map((s) => callAndRecord(settings, s, ctx))); }
  catch (e) { rpc({ type: "drop", jobId: prep.jobId }).catch(() => {}); throw e; }
  const terms = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const r of results) { terms.push(...r.terms); if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; } }
  const fin = await rpc({ type: "finish", jobId: prep.jobId, results: results.map((r) => ({ items: r.items })) });
  return { items: fin.items, placements: fin.placements, regions: fin.regions, work: fin.work, letter: fin.letter, clean: fin.clean, width: prep.width, height: prep.height, usage, ctx: mergeContext(ctx, terms, fin.items.map((i) => i.text)) };
}

/**
 * Render original + translated canvases at the engine's working resolution.
 * @returns {{original:HTMLCanvasElement, translated:HTMLCanvasElement, drawn:number}}
 */
export function renderPage(img, result, settings) {
  const { W, H } = result.work;
  const original = document.createElement("canvas"); original.width = W; original.height = H;
  original.getContext("2d").drawImage(img, 0, 0, W, H);
  const translated = document.createElement("canvas"); translated.width = W; translated.height = H;
  const tctx = translated.getContext("2d");
  tctx.drawImage(result.clean, 0, 0);
  const drawn = GyText.draw(tctx, result.placements, { fontFamily: settings.fontFamily, uppercase: settings.uppercase });
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
