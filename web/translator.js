// Gytakusub Web – translation pipeline in the browser main thread.
// Mirrors the extension's background worker: downscale/slice, detect bubbles,
// stamp marks, call Claude, normalise, then typeset onto a canvas.
import { callClaude, normalizeItems, stampMarks, candidatesToBubbles, sliceGeometry, mergeContext, apiHeaders, API_URL } from "./prompt.js";

const G = globalThis.GyT;

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
  imageProxy: "", // optional: https://your-worker.workers.dev/?url=
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

function canvasToJpegB64(canvas, quality = 0.82) {
  return new Promise((res, rej) => canvas.toBlob(async (b) => {
    if (!b) return rej(new Error("toBlob failed"));
    res((await blobToDataUrl(b)).split(",")[1]);
  }, "image/jpeg", quality));
}

/** Fetch an image, optionally through the configured CORS proxy. */
export async function fetchImageBlob(url, settings) {
  const attempt = async (u) => {
    const r = await fetch(u, { mode: "cors", credentials: "omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.blob();
  };
  try { return await attempt(url); }
  catch (e) {
    if (settings.imageProxy) return attempt(settings.imageProxy + encodeURIComponent(url));
    throw new Error(`Could not load image directly (${e.message}). The site blocks cross-origin reads; set an image proxy in Settings, or use screenshot mode.`);
  }
}

/**
 * Translate one page image.
 * @param {HTMLImageElement} img  decoded page
 * @param {object} settings
 * @param {{terms:Array, recent:Array}} ctx  chapter context (mutated via return)
 * @returns {{items, bubbles, width, height, usage, ctx}}
 */
export async function translateImage(img, settings, ctx = { terms: [], recent: [] }) {
  if (!settings.apiKey) throw new Error("No API key set — open Settings (⚙) and paste your Claude API key.");
  const W = img.naturalWidth, H = img.naturalHeight;
  const slices = [], bubbles = [];
  for (const s of sliceGeometry(W, H, settings)) {
    const cw = Math.max(1, Math.round(s.w * s.scale)), ch = Math.max(1, Math.round(s.h * s.scale));
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const cx = c.getContext("2d", { willReadFrequently: true });
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cw, ch);
    cx.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, cw, ch);
    const cands = G.detectBubbles(cx.getImageData(0, 0, cw, ch));
    const firstId = bubbles.length + 1;
    bubbles.push(...candidatesToBubbles(cands, s, cw, ch, W, H, firstId));
    stampMarks(cx, cands, cw, firstId);
    slices.push({ b64: await canvasToJpegB64(c), mediaType: "image/jpeg", x: s.x, y: s.y, w: s.w, h: s.h, cw, ch, tagFrom: firstId, tagTo: firstId + cands.length - 1 });
  }
  const results = await Promise.all(slices.map((s) => callClaude(settings, s, ctx)));
  const items = [], terms = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  slices.forEach((s, i) => {
    items.push(...normalizeItems(results[i].items, s, W, H));
    terms.push(...results[i].terms);
    if (results[i].usage) { usage.input_tokens += results[i].usage.input_tokens || 0; usage.output_tokens += results[i].usage.output_tokens || 0; }
  });
  return { items, bubbles, width: W, height: H, usage, ctx: mergeContext(ctx, terms, items.map((i) => i.text)) };
}

/**
 * Render original + overlay into two canvases at a capped resolution.
 * @returns {{original:HTMLCanvasElement, translated:HTMLCanvasElement, drawn:number}}
 */
export function renderPage(img, result, settings, maxEdge = 2200) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale)), H = Math.max(1, Math.round(img.naturalHeight * scale));
  const original = document.createElement("canvas"); original.width = W; original.height = H;
  const octx = original.getContext("2d", { willReadFrequently: true });
  octx.drawImage(img, 0, 0, W, H);
  const pixels = octx.getImageData(0, 0, W, H);
  const overlay = document.createElement("canvas"); overlay.width = W; overlay.height = H;
  const drawn = G.typeset(overlay.getContext("2d"), pixels, result, W, H, { fontFamily: settings.fontFamily, uppercase: settings.uppercase });
  const translated = document.createElement("canvas"); translated.width = W; translated.height = H;
  const tctx = translated.getContext("2d");
  tctx.drawImage(original, 0, 0); tctx.drawImage(overlay, 0, 0);
  return { original, translated, drawn };
}

export async function testKey(settings) {
  const res = await fetch(API_URL, {
    method: "POST", headers: apiHeaders(settings.apiKey),
    body: JSON.stringify({ model: settings.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK" }] }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(`${res.status}: ${j?.error?.message || res.statusText}`); }
  return true;
}

// ---------- MangaDex ----------

export function parseMangaDexChapter(input) {
  const m = String(input).match(/chapter\/([0-9a-f-]{36})/i) || String(input).match(/^([0-9a-f-]{36})$/i);
  return m ? m[1] : null;
}

export async function mangaDexPages(chapterId, dataSaver = false) {
  const r = await fetch(`https://api.mangadex.org/at-home/server/${chapterId}?forcePort443=true`);
  if (!r.ok) throw new Error(`MangaDex API ${r.status}`);
  const j = await r.json();
  const files = dataSaver ? j.chapter.dataSaver : j.chapter.data;
  return files.map((f) => `${j.baseUrl}/${dataSaver ? "data-saver" : "data"}/${j.chapter.hash}/${f}`);
}
