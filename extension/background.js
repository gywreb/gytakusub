// Gytakusub – background service worker.
// Responsibilities: fetch image bytes (bypassing page CORS), downscale/slice,
// detect speech-bubble candidates locally and stamp numbered marks on them
// (set-of-mark prompting), call the Claude Messages API with vision, cache
// results, keep per-tab glossary context, and relay keyboard commands.

import "./bubble.js"; // defines globalThis.GyT
import { callClaude, normalizeItems, stampMarks, candidatesToBubbles, sliceGeometry, mergeContext, apiHeaders, API_URL } from "./prompt.js";
const G = globalThis.GyT;

const PROMPT_VERSION = 4; // bump when the prompt/coordinate format changes so old cache entries are ignored

export const DEFAULT_SETTINGS = {
  enabled: true, // master switch
  model: "claude-haiku-5-5",
  targetLang: "English",
  glossary: "",
  customPrompt: "",
  autoSites: [], // hostnames where auto-translate-on-scroll is on
  useContext: true, // feed recent dialogue from this tab into each request
  includeSource: false, // ask the model to transcribe the original too (slower)
  uppercase: false,
  fontFamily: "",
  syncApiKey: false,
  excludedSites: "",
  // Image prep
  maxLongEdge: 1600, // px sent to Claude for a normal page
  stripWidth: 1000, // px width for tall webtoon strips
  sliceHeight: 1800, // px per slice for tall strips
};

// ---------- settings ----------

async function getSettings() {
  const synced = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const local = await chrome.storage.local.get({ apiKey: "" });
  const syncedKey = (await chrome.storage.sync.get({ apiKey: "" })).apiKey;
  return { ...DEFAULT_SETTINGS, ...synced, apiKey: local.apiKey || syncedKey || "" };
}

async function updateBadge() {
  const s = await getSettings();
  await chrome.action.setBadgeText({ text: s.enabled ? "" : "off" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
}
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes) => { if (changes.enabled) updateBadge(); });

// ---------- small utils ----------

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function sha1(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- image preparation ----------

// Returns slices with the image bytes Claude will see (bubbles stamped with
// numbered marks) plus the detected bubble candidates in full-image fractions.
async function prepareSlices(blob, settings) {
  const bitmap = await createImageBitmap(blob);
  const W = bitmap.width, H = bitmap.height;
  const slices = [];
  const bubbles = [];
  for (const s of sliceGeometry(W, H, settings)) {
    const cw = Math.max(1, Math.round(s.w * s.scale));
    const ch = Math.max(1, Math.round(s.h * s.scale));
    const canvas = new OffscreenCanvas(cw, ch);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(bitmap, s.x, s.y, s.w, s.h, 0, 0, cw, ch);
    const cands = G.detectBubbles(ctx.getImageData(0, 0, cw, ch));
    const firstId = bubbles.length + 1;
    bubbles.push(...candidatesToBubbles(cands, s, cw, ch, W, H, firstId));
    stampMarks(ctx, cands, cw, firstId);
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
    const dataUrl = await blobToDataUrl(jpeg);
    slices.push({ b64: dataUrl.split(",")[1], mediaType: "image/jpeg", x: s.x, y: s.y, w: s.w, h: s.h, cw, ch, tagFrom: firstId, tagTo: firstId + cands.length - 1 });
  }
  bitmap.close();
  return { slices, bubbles, width: W, height: H };
}

// ---------- per-tab chapter context (names + recent dialogue) ----------

async function getTabCtx(tabId) {
  const key = `ctx:${tabId}`;
  const v = (await chrome.storage.session.get({ [key]: null }))[key];
  return v && Array.isArray(v.terms) && Array.isArray(v.recent) ? v : { terms: [], recent: [] };
}

async function updateTabCtx(tabId, newTerms, newLines) {
  const key = `ctx:${tabId}`;
  await chrome.storage.session.set({ [key]: mergeContext(await getTabCtx(tabId), newTerms, newLines) });
}

// ---------- main handler ----------

async function handleTranslate(msg, sender) {
  const settings = await getSettings();
  if (!settings.enabled) throw new Error("Gytakusub is switched off (toolbar popup).");
  if (!settings.apiKey) throw new Error("No API key set. Open Gytakusub options and paste your Claude API key.");

  const tabId = sender.tab?.id ?? -1;
  const cacheKey = "cache:" + (await sha1(`${PROMPT_VERSION}|${settings.model}|${settings.targetLang}|${settings.includeSource}|${settings.useContext}|${msg.url || msg.dataUrl?.slice(0, 512) + msg.dataUrl?.length}`));
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  if (cached && !msg.force) return { ...cached, fromCache: true };

  // 1. bytes
  let blob;
  if (msg.dataUrl) {
    blob = dataUrlToBlob(msg.dataUrl);
  } else {
    const res = await fetch(msg.url, { credentials: "omit" });
    if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
    blob = await res.blob();
  }
  if (!blob.type.startsWith("image/")) blob = new Blob([await blob.arrayBuffer()], { type: "image/jpeg" });

  // 2. prepare (downscale, detect bubbles, stamp marks)
  const { slices, bubbles, width, height } = await prepareSlices(blob, settings);

  // 3. translate each slice (slices of one strip run in parallel)
  const ctx = await getTabCtx(tabId);
  const results = await Promise.all(slices.map((s) => callClaude(settings, s, ctx)));

  const items = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const newTerms = [];
  slices.forEach((s, idx) => {
    const r = results[idx];
    items.push(...normalizeItems(r.items, s, width, height));
    newTerms.push(...r.terms);
    if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; }
  });
  if (tabId >= 0) await updateTabCtx(tabId, newTerms, items.map((i) => i.text));

  // 4. the content script needs the pixels for painting; hand back the original bytes
  const originalDataUrl = msg.dataUrl || (await blobToDataUrl(blob));
  const result = { items, bubbles, width, height, usage, imageDataUrl: originalDataUrl };
  try { await chrome.storage.session.set({ [cacheKey]: result }); }
  catch (e) { console.warn("Gytakusub: cache write failed", e); }
  return result;
}

async function testKey() {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("No API key saved yet.");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: apiHeaders(settings.apiKey),
    body: JSON.stringify({ model: settings.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with OK" }] }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(`${res.status}: ${j?.error?.message || res.statusText}`);
  }
  return { ok: true, model: settings.model };
}

// ---------- messaging ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) => p.then((r) => sendResponse(r)).catch((e) => sendResponse({ error: e.message || String(e) }));
  switch (msg?.type) {
    case "TRANSLATE": reply(handleTranslate(msg, sender)); return true;
    case "GET_SETTINGS": reply(getSettings()); return true;
    case "TEST_KEY": reply(testKey()); return true;
    case "CLEAR_CACHE": reply(chrome.storage.session.clear().then(() => ({ ok: true }))); return true;
    case "RELAY_TO_TAB":
      reply(chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab?.id) throw new Error("No active tab");
        return chrome.tabs.sendMessage(tab.id, msg.payload);
      }));
      return true;
    default: return false;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab?.id) return;
  const map = { "translate-visible": "TRANSLATE_VISIBLE", "toggle-overlays": "TOGGLE_OVERLAYS" };
  if (map[command]) chrome.tabs.sendMessage(tab.id, { type: map[command] }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`ctx:${tabId}`).catch(() => {});
});
