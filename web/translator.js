// Gytakusub Web – translation pipeline. The page engine (OpenCV analysis,
// stamps, erase, layout) runs in engine-worker.js; this module calls Claude
// and draws the text, mirroring the extension's service worker + content script.
import { callClaude, mergeContext, apiHeaders, API_URL, sliceGeometry } from "./prompt.js";
import { limitsOf, explainApiError } from "./usage.js";
import { recordClaudeUsage, recordClaudePage } from "./claude-usage.js";
import { letteringFor } from "./languages.js";
import { t } from "./i18n.js";
import { lamaAllowed, lamaSeen } from "./lama-guard.js";

// every answer is logged as it arrives, so a page whose other slice fails still counts what it cost
const callAndRecord = (settings, slice, ctx) => callClaude(settings, slice, ctx).then((r) => { recordClaudeUsage(r); return r; });

const GyText = globalThis.GyText;

let worker = null, seq = 0;
const pending = new Map();
function rpc(msg, transfer = []) {
  if (!worker) {
    const w = worker = new Worker("./engine-worker.js", { type: "module" });
    w.onmessage = (e) => {
      if (e.data.event === "lama") return lamaSeen(e.data.state);
      const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error));
    };
    // An error the engine did not answer may have left it dead (out of memory on a phone): it is
    // dropped, the next call starts a fresh one, and the calls it held fail as `gone`, which
    // translateImage() does again on the fresh engine (2.13; pages failed until Redo before)
    w.postMessage({ id: ++seq, type: "prefs", lama: lamaAllowed() }); // (its answer needs no one)
    w.onerror = (e) => {
      console.warn("Gytakusub: the engine failed", e.message);
      if (worker === w) { worker = null; w.terminate(); }
      for (const p of pending.values()) p.rej(Object.assign(new Error(e.message || "engine worker failed"), { gone: true }));
      pending.clear();
    };
  }
  const id = ++seq;
  const sent = new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, ...msg }, transfer); });
  return sent;
}

/** Tries `run` again (twice at most) when the engine was lost under it. */
async function onFreshEngine(run) {
  for (let lost = 0; ; lost++) {
    try { return await run(); }
    catch (e) { if (!e.gone || lost >= 2) throw e; console.warn("Gytakusub: the engine stopped; starting it again", e); }
  }
}

export const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-haiku-5-5",
  targetLang: "English",
  glossary: "",
  customPrompt: "",
  useContext: true,
  uppercase: false,
  fontFamily: "",
  rtlSpreads: true,
  // the eraser finds lettering with the learned text mask where the rules are weak (engine/textmask.js,
  // ADR 0022). On by default from 3.4 (ADR 0026), under a new name so the old preview's saved "off" doesn't keep it off
  learnedTextMask: true,
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
 * @param {(partial: object, done: number, total: number) => void} [onPart] a long strip is done part by
 *   part (the extension's way): each finished part is shown at once (`partial`, the parts so far)
 * @returns {{items, placements, regions, work, letter, patches:Array<{x,y,w,h,bitmap:ImageBitmap}>, width, height, usage, engine, timing, ctx}}
 *   patches: the erased areas in page pixels, at the page's own resolution
 */
export async function translateImage(img, settings, ctx = { terms: [], recent: [] }, onPart = null) {
  if (!settings.apiKey) throw new Error(t("web_no_key"));
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const parts = sliceGeometry(W, H, settings);
  if (parts.length < 2) {
    const one = await translateRows(img, settings, ctx, null);
    return { ...one.page, usage: one.usage, ctx: mergeContext(ctx, one.terms, one.page.items.map((i) => i.text)) };
  }
  // A long strip, part by part (2.14; the web app waited for the whole strip before): every part is
  // analysed and asked about at once (the engine takes them one at a time), and each is shown as it
  // is finished, in whatever order that is.
  const done = [];
  const merged = () => {
    const page = { items: [], placements: [], regions: [], patches: [], width: W, height: H, work: done[0].page.work, letter: done[0].page.letter, engine: done[0].page.engine };
    for (const d of [...done].sort((a, b) => a.index - b.index)) {
      const base = page.items.length;
      page.items.push(...d.page.items);
      page.placements.push(...d.page.placements.map((p) => ({ ...p, item: p.item != null ? p.item + base : p.item, part: d.index })));
      page.regions.push(...d.page.regions.map((r) => ({ ...r, part: d.index })));
      page.patches.push(...d.page.patches);
    }
    const ts = done.map((d) => d.page.timing).sort((a, b) => a.start - b.start);
    page.timing = { start: ts[0].start, parts: [...done].sort((a, b) => a.index - b.index).map((d) => ({ part: d.index, ...d.page.timing })) };
    return page;
  };
  await Promise.all(parts.map((_, index) => translateRows(img, settings, ctx, { W, H, index, y0: parts[index].y, h: parts[index].h }).then((d) => {
    done.push({ index, ...d });
    if (onPart && done.length < parts.length) onPart(merged(), done.length, parts.length);
  })));
  const page = merged();
  const terms = done.sort((a, b) => a.index - b.index).flatMap((d) => d.terms);
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const d of done) { usage.input_tokens += d.usage.input_tokens; usage.output_tokens += d.usage.output_tokens; }
  return { ...page, usage, ctx: mergeContext(ctx, terms, page.items.map((i) => i.text)) };
}

/** The page, or one part of a long strip (`part`: {W, H, index, y0, h}: its rows), translated. */
async function translateRows(img, settings, ctx, part) {
  // the times of each step, as the extension's debug report has them (analyze, model, finish)
  // (start: epoch ms, for a timeline with each fill's own start, fill.runs; "model" is Claude's time)
  const timing = { start: Date.now() }; let t0 = performance.now();
  const lap = (k) => { const n = performance.now(); timing[k] = Math.round(n - t0); t0 = n; };
  const rows = () => (part ? createImageBitmap(img, 0, part.y0, part.W, part.h) : createImageBitmap(img));
  const prepare = async () => {
    const bitmap = await rows();
    return rpc({ type: "prepare", bitmap, settings: { maxLongEdge: settings.maxLongEdge, stripWidth: settings.stripWidth, sliceHeight: settings.sliceHeight, learnedTextMask: settings.learnedTextMask !== false }, ...(part ? { part: { W: part.W, H: part.H, index: part.index, y0: part.y0 } } : {}) }, [bitmap]);
  };
  let prep = await onFreshEngine(prepare);
  lap("analyze");
  // While Claude answers, the engine fills the page's textured areas ahead (the finish then finds
  // them done). The page at its own size goes with it when the analysis worked on a smaller copy.
  // (anything failing before the finish drops the page, so the engine frees its analysis)
  let results;
  try {
    const natural = prep.work.W < prep.width ? await rows() : null;
    rpc({ type: "prefill", jobId: prep.jobId, natural }, natural ? [natural] : []).catch(() => {});
    results = await Promise.all(prep.slices.map((s) => callAndRecord(settings, s, ctx)));
  } catch (e) { rpc({ type: "drop", jobId: prep.jobId }).catch(() => {}); throw e; }
  lap("model");
  recordClaudePage(results);
  const terms = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  for (const r of results) { terms.push(...r.terms); if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; } }
  // (an engine lost before the finish lost the page's analysis too: it is done again, the same way,
  // and Claude's answers, which were for the same slices, are kept rather than asked for again)
  let first = true;
  const fin = await onFreshEngine(async () => {
    if (!first) prep = await prepare();
    first = false;
    return rpc({ type: "finish", jobId: prep.jobId, results: results.map((r) => ({ items: r.items, ...(r.cut != null ? { cut: r.cut } : {}) })) });
  });
  lap("finish");
  if (fin.detectMs) timing.detect = fin.detectMs;
  if (fin.segmentMs) timing.segment = fin.segmentMs;
  if (fin.backend) timing.backend = fin.backend;
  if (fin.fill) timing.fill = fin.fill;
  if (fin.dropped?.length) timing.dropped = fin.dropped; // the lines labelled sound effects or logos, left as drawn
  if (fin.answer?.length) timing.answer = fin.answer; // what the answer contract repaired (engine/contract.js checkAnswer)
  if (fin.look?.boxes) timing.look = fin.look;
  if (fin.textMask) timing.textMask = fin.textMask; // the learned text mask, when on: where it ran, its time
  if (fin.modelWait != null) timing.modelWait = fin.modelWait; // (waiting for the learned fill's model to load)
  const page = { items: fin.items, placements: fin.placements, regions: fin.regions, work: fin.work, letter: fin.letter, patches: fin.patches, width: prep.width, height: prep.height, engine: fin.engine, timing };
  return { page, usage, terms };
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

// iOS Safari refuses a canvas over ~16.7 million pixels; a page that big (a long strip) is drawn smaller.
const MAX_CANVAS_PIXELS = 16e6;

/**
 * Render original + translated canvases at the page's own size or the screen's, whichever is
 * larger (so a saved page, or one zoomed on a phone, is as sharp as the original, and the text
 * is as sharp as the screen on a tablet or an unfolded foldable): the original, the erased areas
 * over it, then the text, scaled from the engine's working pixels.
 * `look`: prepareLettering()'s answer (the target language's rules).
 * @param {{minWidth?: number}} [opts] minWidth: the page's width on screen in device pixels
 * @returns {{original:HTMLCanvasElement, translated:HTMLCanvasElement, drawn:number}}
 */
export function renderPage(img, result, settings, look = {}, opts = {}) {
  const grow = Math.max(1, (opts.minWidth || 0) / result.width);
  const k = Math.min(grow, Math.sqrt(MAX_CANVAS_PIXELS / (result.width * result.height)));
  const W = Math.max(1, Math.round(result.width * k)), H = Math.max(1, Math.round(result.height * k));
  const original = document.createElement("canvas"); original.width = W; original.height = H;
  original.getContext("2d").drawImage(img, 0, 0, W, H);
  const translated = document.createElement("canvas"); translated.width = W; translated.height = H;
  const tctx = translated.getContext("2d");
  tctx.drawImage(img, 0, 0, W, H);
  tctx.setTransform(W / result.width, 0, 0, H / result.height, 0, 0);
  for (const p of result.patches || []) tctx.drawImage(p.bitmap, p.x, p.y, p.w, p.h);
  tctx.setTransform(W / result.work.W, 0, 0, H / result.work.H, 0, 0);
  const sizes = [], fits = []; // the size each line was drawn at (work pixels), for the text layer (app.js); how each fitted
  const drawn = GyText.draw(tctx, result.placements, { fontFamily: settings.fontFamily, uppercase: settings.uppercase, lang: look.lang ?? null, hyphenator: look.hyphenator ?? null, sizes, fits });
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  return { original, translated, drawn, sizes, fits };
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
