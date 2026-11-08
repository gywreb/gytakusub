// Gytakusub – background service worker.
// Responsibilities: fetch image bytes (bypassing page CORS), run the page
// engine (OpenCV analysis, numbered stamps for set-of-mark prompting, erase +
// layout after the model answers), call the Claude Messages API with vision,
// cache translations, keep per-tab glossary context, relay keyboard commands.

import { callClaude, mergeContext, apiHeaders, API_URL } from "./prompt.js";
import { preparePage, finishPage } from "./engine/page.js";

const PROMPT_VERSION = 6; // bump when the prompt/coordinate format changes so old cache entries are ignored

export const DEFAULT_SETTINGS = {
  enabled: true, // master switch
  model: "claude-haiku-5-5",
  targetLang: "English",
  glossary: "",
  customPrompt: "",
  enabledSites: [], // hostnames where the content script is injected (hover button + hotkeys)
  autoSites: [], // hostnames where auto-translate-on-scroll is on (implies enabled)
  useContext: true, // feed recent dialogue from this tab into each request
  includeSource: false, // ask the model to transcribe the original too (slower)
  uppercase: false,
  fontFamily: "",
  syncApiKey: false,
  excludedSites: "",
  debugOverlay: false, // draw detection boxes and log results (for diagnosing placement)
  peekOnHover: true, // hovering a translated bubble shows the original lettering
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
// ---------- content script registration ----------
// The content script is not declared statically: it is registered only for
// sites the user enabled, and injected on demand elsewhere (popup / hotkey).

const CS_ID = "gytakusub-main";
const CS_FILES = ["vendor/hyphen-en.js", "text.js", "content.js"];

function hostPatterns(hosts) {
  const out = [];
  for (const h of hosts) {
    const host = String(h).trim().toLowerCase().replace(/^\*\./, "");
    if (!/^[a-z0-9.-]+$/.test(host)) continue;
    out.push(`*://${host}/*`, `*://*.${host}/*`);
  }
  return [...new Set(out)];
}

async function syncRegistration() {
  const s = await getSettings();
  const hosts = s.enabled ? [...new Set([...(s.enabledSites || []), ...(s.autoSites || [])])] : [];
  const matches = hostPatterns(hosts);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CS_ID] }).catch(() => []);
  if (!matches.length) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CS_ID] }).catch(() => {});
    return;
  }
  const spec = { id: CS_ID, js: CS_FILES, matches, runAt: "document_idle", persistAcrossSessions: true };
  if (existing.length) await chrome.scripting.updateContentScripts([spec]);
  else await chrome.scripting.registerContentScripts([spec]);
}

/** Make sure the content script is present in a tab; inject it if not. */
async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (r?.ok) return true;
  } catch { /* not injected */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: CS_FILES });
  return true;
}

chrome.runtime.onInstalled.addListener(() => { updateBadge(); syncRegistration(); });
chrome.runtime.onStartup.addListener(() => { updateBadge(); syncRegistration(); });
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) updateBadge();
  if (changes.enabled || changes.enabledSites || changes.autoSites) syncRegistration();
});

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
async function decode(blob) {
  const bitmap = await createImageBitmap(blob);
  try { return await preparePage(bitmap, await getSettings()); } finally { bitmap.close(); }
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

// ---------- image bytes (only http(s) URLs or inline data from our own content script) ----------

const MAX_BYTES = 25 * 1024 * 1024;
async function fetchImageBlob({ url, dataUrl }) {
  let blob;
  if (dataUrl) {
    if (!/^data:image\//i.test(dataUrl)) throw new Error("Unsupported image data");
    blob = dataUrlToBlob(dataUrl);
  } else {
    let u;
    try { u = new URL(url); } catch { throw new Error("Invalid image URL"); }
    if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) images are supported");
    const res = await fetch(u.href, { credentials: "omit" });
    if (!res.ok) throw new Error(`Could not fetch image (${res.status})`);
    blob = await res.blob();
  }
  if (blob.size > MAX_BYTES) throw new Error("Image is too large (over 25 MB)");
  if (!blob.type.startsWith("image/")) blob = new Blob([await blob.arrayBuffer()], { type: "image/jpeg" });
  return blob;
}

// ---------- main handler ----------

async function handleTranslate(msg, sender) {
  const settings = await getSettings();
  if (!settings.enabled) throw new Error("Gytakusub is switched off (toolbar popup).");
  if (!settings.apiKey) throw new Error("No API key set. Open Gytakusub options and paste your Claude API key.");

  const tabId = sender.tab?.id ?? -1;
  const cacheKey = "cache:" + (await sha1(`${PROMPT_VERSION}|${settings.model}|${settings.targetLang}|${settings.includeSource}|${settings.useContext}|${msg.url || msg.dataUrl?.slice(0, 512) + msg.dataUrl?.length}`));
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  const timing = {}; let t = performance.now();
  const lap = (k) => { const n = performance.now(); timing[k] = Math.round(n - t); t = n; };

  // Cache holds the model's answer only (not image bytes, which would exhaust
  // storage.session after a few pages); the page is re-analysed on a hit.
  const blob = await fetchImageBlob(msg); lap("fetch");
  const job = await decode(blob); lap("analyze");
  let results, usage, newTerms = [];
  if (cached && !msg.force) {
    results = cached.results; usage = cached.usage;
  } else {
    const ctx = await getTabCtx(tabId);
    const withRetry = async (slice) => {
      try { return await callClaude(settings, slice, ctx); }
      catch (e) {
        if (/Claude API (429|529|503)/.test(e.message)) { await new Promise((r) => setTimeout(r, 2500)); return callClaude(settings, slice, ctx); }
        throw e;
      }
    };
    const raw = await Promise.all(job.slices.map(withRetry));
    results = raw.map((r) => ({ items: r.items }));
    usage = { input_tokens: 0, output_tokens: 0 };
    for (const r of raw) { newTerms.push(...r.terms); if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; } }
    try { await chrome.storage.session.set({ [cacheKey]: { results, usage } }); }
    catch (e) { console.warn("Gytakusub: cache write failed", e); }
  }
  lap("model");

  const page = await finishPage(job, results); lap("layout");
  // The user's own corrections to this page's lines live beside the cached answer
  // (a Redo asks the model again and drops them).
  const editsKey = "edits:" + cacheKey;
  if (msg.force) await chrome.storage.session.remove(editsKey).catch(() => {});
  const edits = msg.force ? {} : (await chrome.storage.session.get(editsKey))[editsKey] || {};
  for (const [i, text] of Object.entries(edits)) {
    if (page.items[i]) page.items[i].text = text;
    for (const p of page.placements) if (p.item === +i) p.text = text;
  }
  if (tabId >= 0 && newTerms.length) await updateTabCtx(tabId, newTerms, page.items.map((i) => i.text));
  else if (tabId >= 0 && !cached) await updateTabCtx(tabId, [], page.items.map((i) => i.text));
  // Only the erased areas travel to the page (patches); the whole cleaned page
  // is encoded only when asked for (diagnostic export).
  const patches = await Promise.all(page.patches.map(async (p) => ({ x: p.x, y: p.y, w: p.w, h: p.h, dataUrl: await blobToDataUrl(await p.canvas.convertToBlob({ type: "image/png" })) })));
  let cleanDataUrl = null;
  if (msg.wantClean) {
    const big = page.work.W * page.work.H > 2.6e6;
    cleanDataUrl = await blobToDataUrl(await page.canvas.convertToBlob(big ? { type: "image/jpeg", quality: 0.92 } : { type: "image/png" }));
  }
  lap("encode");
  timing.patchBytes = patches.reduce((s, p) => s + p.dataUrl.length, 0);
  return {
    items: page.items, placements: page.placements, regions: page.regions, letter: page.letter, engine: page.engine,
    work: page.work, width: job.width, height: job.height, usage, timing,
    patches, cleanDataUrl, fromCache: !!(cached && !msg.force), cacheKey,
  };
}

/** Remember a corrected line for a page (applied on every re-render until a Redo). */
async function editItem({ cacheKey, item, text }) {
  if (typeof cacheKey !== "string" || !/^cache:[0-9a-f]{40}$/.test(cacheKey)) throw new Error("Bad cache key");
  if (!Number.isInteger(item) || item < 0) throw new Error("Bad item");
  const key = "edits:" + cacheKey;
  const edits = (await chrome.storage.session.get(key))[key] || {};
  edits[item] = String(text ?? "").slice(0, 2000);
  await chrome.storage.session.set({ [key]: edits });
  return { ok: true };
}

/** Append "from = to" to the glossary unless an equivalent line exists. */
async function addGlossary({ from, to }) {
  from = String(from ?? "").trim().slice(0, 200); to = String(to ?? "").trim().slice(0, 200);
  if (!from || !to) throw new Error("Both the original and the translation are needed");
  const s = await getSettings();
  const lines = s.glossary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dup = lines.some((l) => l.split("=")[0].trim().toLowerCase() === from.toLowerCase());
  const glossary = (dup ? lines.map((l) => (l.split("=")[0].trim().toLowerCase() === from.toLowerCase() ? `${from} = ${to}` : l)) : [...lines, `${from} = ${to}`]).join("\n");
  await chrome.storage.sync.set({ glossary });
  return { ok: true, replaced: dup };
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
    case "EDIT_ITEM": reply(editItem(msg)); return true;
    case "FETCH_IMAGE": reply(fetchImageBlob(msg).then(async (b) => ({ dataUrl: await blobToDataUrl(b), type: b.type }))); return true; // diagnostic export needs the original bytes
    case "ADD_GLOSSARY": reply(addGlossary(msg)); return true;
    case "RELAY_TO_TAB":
      reply(chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id) throw new Error("No active tab");
        if (!/^https?:/.test(tab.url || "")) throw new Error("Not a web page");
        if (msg.inject) await ensureContentScript(tab.id);
        return chrome.tabs.sendMessage(tab.id, msg.payload);
      }));
      return true;
    case "ACTIVE_TAB_INFO":
      reply(chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        let host = null;
        try { host = /^https?:/.test(tab?.url || "") ? new URL(tab.url).hostname : null; } catch { /* ignore */ }
        return { host };
      }));
      return true;
    default: return false;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) return;
  const map = { "translate-visible": "TRANSLATE_VISIBLE", "toggle-overlays": "TOGGLE_OVERLAYS" };
  if (!map[command]) return;
  try {
    if (command === "translate-visible") await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: map[command] });
  } catch (e) { console.warn("Gytakusub command failed", e); }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`ctx:${tabId}`).catch(() => {});
});
