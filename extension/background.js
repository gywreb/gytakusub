// Gytakusub – background service worker.
// Responsibilities: fetch image bytes (bypassing page CORS), run the page
// engine (OpenCV analysis, numbered stamps for set-of-mark prompting, erase +
// layout after the model answers), call the Claude Messages API with vision,
// cache translations, keep per-tab glossary context, relay keyboard commands.

import { callClaude, mergeContext, sliceGeometry } from "./prompt.js";
import { addCall, addPage, emptyLog } from "./usage.js";
import { preparePage, prefillPage, finishPage, warmInpainter, inpainterWarm, setEnginePrefs, releasePage } from "./engine/index.js";
import { DEFAULT_SETTINGS, getSettings, CS_FILES, ensureContentScript } from "./settings.js";
import { createLane, Cancelled } from "./lane.js";
import { consentGiven, hasAccess, openWelcome, CONSENT_VERSION } from "./access.js";
import { sniffImageType, readCapped } from "./imagecheck.js";
import { t, langTag, messagesWithPrefix, localeLoaded } from "./i18n.js";
import { useLanguageOf } from "./locale.js";
import { uiLocaleFor, languageForLocale, letteringFor, LANGUAGES } from "./languages.js";
import { devReloadSoon } from "./devreload.js";

devReloadSoon(); // loaded unpacked: new code in the folder? (devreload.js; pages asking check again)

// Claude usage log (usage.js) in chrome.storage.local, read by the popup and Options. This worker is
// its only writer; a page's slices answer in parallel, so the writes queue up instead of racing.
let usageWrites = Promise.resolve();
function recordUsage(r) {
  if (!r?.usage) return;
  usageWrites = usageWrites.then(async () => {
    const { claudeUsage } = await chrome.storage.local.get({ claudeUsage: null });
    await chrome.storage.local.set({ claudeUsage: addCall(claudeUsage?.v === 1 ? claudeUsage : emptyLog(), { model: r.model, usage: r.usage, limits: r.limits }) });
  }).catch((e) => console.warn("Gytakusub: usage log write failed", e));
}
/** One page translated by Claude: all its slices answered (their requests are already counted). */
function recordPage(raw) {
  if (!raw.length || !raw.every((r) => r?.usage)) return;
  usageWrites = usageWrites.then(async () => {
    const { claudeUsage } = await chrome.storage.local.get({ claudeUsage: null });
    await chrome.storage.local.set({ claudeUsage: addPage(claudeUsage?.v === 1 ? claudeUsage : emptyLog(), { model: raw[0].model, usages: raw.map((r) => r.usage) }) });
  }).catch((e) => console.warn("Gytakusub: usage log write failed", e));
}

// The extension ships the LaMa inpainter (vendor/lama.onnx), used on a graphics card (ADR 0015)
setEnginePrefs({ lama: true });

const PROMPT_VERSION = 8; // bump when the prompt/coordinate format changes so old cache entries are ignored

export { DEFAULT_SETTINGS }; // defined in settings.js, shared with the popup and options pages

// ---------- settings ----------

async function updateBadge() {
  const s = await getSettings();
  await chrome.action.setBadgeText({ text: s.enabled ? "" : "off" });
  await chrome.action.setBadgeBackgroundColor({ color: "#6b7280" });
}
// ---------- content script registration ----------
// The content script is not declared statically: it is registered only for
// sites the user enabled, and injected on demand elsewhere (popup / hotkey).

const CS_ID = "gytakusub-main";

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
  // without the site access asked for at first use (access.js), nothing is registered
  const hosts = s.enabled && await hasAccess() ? [...new Set([...(s.enabledSites || []), ...(s.autoSites || [])])] : [];
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
chrome.runtime.onInstalled.addListener(async ({ reason, previousVersion }) => {
  updateBadge(); syncRegistration();
  // A new user sees what is sent where, and agrees, first. On an update, only someone who never
  // saw this page (coming from before 2.7.0) or who agreed to an older version of it; not someone
  // who withdrew on purpose.
  if (reason === "update") chrome.storage.sync.remove(["creditPlan", "creditCustom", "creditRenews"]).catch(() => {}); // the monthly-credit fields removed in 2.7.0
  const { consent } = await chrome.storage.local.get("consent");
  if (reason === "install") {
    // a first guess at the language to translate into, and so of the interface: the browser's own (the setup page asks first thing)
    const guess = languageForLocale(chrome.i18n.getUILanguage());
    const { targetLang } = await chrome.storage.sync.get("targetLang");
    if (guess && !targetLang) await chrome.storage.sync.set({ targetLang: guess.name });
  }
  if (reason === "install" && !consent) openWelcome();
  if (reason === "update" && (consent ? (consent.version || 0) < CONSENT_VERSION : olderThan(previousVersion, "2.7.0"))) openWelcome("#update");
});
/** "2.6.1" < "2.7.0", numerically per part. */
function olderThan(a = "0", b) {
  const x = String(a).split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
}
chrome.permissions.onAdded.addListener(() => syncRegistration());
chrome.permissions.onRemoved.addListener(() => syncRegistration());
chrome.runtime.onStartup.addListener(() => { updateBadge(); syncRegistration(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (changes.enabled) updateBadge();
  if (changes.enabled || changes.enabledSites || changes.autoSites) syncRegistration();
  // a new target language: load its words first, so the pages that ask again get them
  if (area === "sync" && changes.targetLang) speak(changes.targetLang.newValue).finally(tellTabsSettingsChanged);
  else if (area === "sync" || (area === "local" && changes.apiKey)) tellTabsSettingsChanged();
});

// The content script runs inside other people's pages. Chrome lets it read storage.local and
// storage.sync by default, and the API key lives there: keep both to the extension's own pages
// and this worker. The content script asks for its settings (GET_SETTINGS, without the key),
// and hears about changes from tellTabsSettingsChanged.
for (const area of [chrome.storage.local, chrome.storage.sync]) {
  area.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch((e) => console.warn("Gytakusub: storage access level", e));
}
async function tellTabsSettingsChanged() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: "SETTINGS_CHANGED" }).catch(() => {}); // tabs without the content script just refuse
}

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
// The page analysed, and the page at its own size when it was analysed smaller (the erased areas
// come back at its resolution; the caller closes it). A part of a tall image (`index`: one of its
// slices, prompt.js sliceGeometry) keeps only its own rows.
async function decode(blob, checkpoint, index = null) {
  let bitmap = await createImageBitmap(blob), part = null;
  const settings = await getSettings();
  if (index != null) {
    const geometry = sliceGeometry(bitmap.width, bitmap.height, settings), s = geometry.length > 1 ? geometry[index] : null;
    if (!s) { bitmap.close(); throw new Error(`Gytakusub: this image has no part ${index}`); }
    part = { W: bitmap.width, H: bitmap.height, index, y0: s.y };
    const rows = await createImageBitmap(bitmap, 0, s.y, bitmap.width, s.h);
    bitmap.close(); bitmap = rows;
  }
  let job;
  try { job = await preparePage(bitmap, settings, { checkpoint, part }); }
  catch (e) { bitmap.close(); throw e; }
  if (job.scale < 0.999) return { job, natural: bitmap };
  bitmap.close();
  return { job, natural: null };
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
// Only what is really an image, and never more than MAX_BYTES (imagecheck.js): the URL comes
// from a page, and the bytes may go back to the content script (FETCH_IMAGE).
async function fetchImageBlob({ url, dataUrl }, signal = undefined) {
  let bytes;
  if (dataUrl) {
    if (!/^data:image\//i.test(dataUrl)) throw new Error(t("bg_bad_data"));
    const blob = dataUrlToBlob(dataUrl);
    if (blob.size > MAX_BYTES) throw new Error(t("bg_too_large", { mb: 25 }));
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    let u;
    try { u = new URL(url); } catch { throw new Error(t("bg_bad_url")); }
    if (!/^https?:$/.test(u.protocol)) throw new Error(t("bg_http_only"));
    let res;
    try { res = await fetch(u.href, { credentials: "omit", signal }); }
    catch (e) {
      if (e?.name === "AbortError") throw e;
      if (!(await hasAccess())) throw coded(t("bg_no_access", { host: u.hostname }), "no-access");
      throw coded(t("bg_download_failed", { host: u.hostname, error: e.message || "network error" }), "network");
    }
    if (!res.ok) throw coded(t("bg_fetch_status", { status: res.status }), `http-${res.status}`);
    bytes = await readCapped(res, MAX_BYTES);
  }
  const type = sniffImageType(bytes);
  if (!type) throw new Error(t("bg_not_image"));
  return new Blob([bytes], { type });
}

// ---------- page order: the page on screen first ----------
// The content script numbers its pages and reports how far each is from the middle of the
// screen and whether it is on screen (TRANSLATE carries the first values, JOBS updates them
// while the user scrolls). The engine work of all tabs goes through one lane (lane.js),
// nearest page first. When the models run on the CPU (no WebGPU), pages off screen are held
// while a page on screen is in progress: their model runs would block this worker's one thread
// for seconds at a time, and the page on screen would wait for its own reply from Claude in
// between. On the GPU a model run leaves the thread free and takes a fraction of a second, and
// holding them would only keep their questions from going to Claude alongside its (a chapter
// translated one answer at a time, 20 s apart when Claude is slow). A page that auto-translate
// picked up and the user then scrolled far past is cancelled, but only until Claude is
// asked: after that its tokens are spent, so it finishes and is cached.
// The hold lasts at most HOLD_MS from when the page on screen started, so a slow or stuck
// answer from Claude doesn't stop the pages around it for long.
const HOLD_MS = 20000;
const lane = createLane();
const jobs = new Map(); // "tabId:page:jobId" → { distance, onScreen, since, ctl: AbortController, asked: boolean }
let engineOnCpu = true; // until a page's analysis says where its models ran
const heldFor = (work) => () => engineOnCpu && !work.onScreen && [...jobs.values()].some((j) => j !== work && j.onScreen && Date.now() - j.since < HOLD_MS);

function updateJobs(tabId, { page = "", update = [], cancel = [] } = {}) {
  for (const u of update) {
    const j = jobs.get(`${tabId}:${page}:${u?.id}`);
    if (!j) continue;
    if (Number.isFinite(u.distance)) j.distance = u.distance;
    if (typeof u.onScreen === "boolean") j.onScreen = u.onScreen;
  }
  for (const id of cancel) { const j = jobs.get(`${tabId}:${page}:${id}`); if (j && !j.asked) j.ctl.abort(); }
  lane.wake();
  return { ok: true };
}

// A page that goes away (reload, next chapter: its line from the content script drops): its pages
// not yet sent to Claude are dropped; those already sent are paid for and finish (their answers are
// cached, for when the reader comes back), but no longer count as on screen or near it.
chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id || !port.name.startsWith("gyt-page:")) return;
  devReloadSoon();
  const prefix = `${port.sender.tab?.id ?? -1}:${port.name.slice("gyt-page:".length)}:`;
  port.onMessage.addListener(() => {}); // the page's word while you read: receiving it keeps this worker (and its models) alive
  port.onDisconnect.addListener(() => {
    for (const [key, j] of jobs) {
      if (!key.startsWith(prefix)) continue;
      if (!j.asked) j.ctl.abort();
      j.onScreen = false; j.distance = Infinity;
      jobs.delete(key);
    }
    lane.wake();
  });
});

// ---------- main handler ----------

async function handleTranslate(msg, sender) {
  const settings = await getSettings();
  await speak(settings.targetLang);
  if (!settings.enabled) throw new Error(t("bg_off"));
  if (!(await consentGiven())) throw new Error(t("bg_not_set_up"));
  if (!settings.apiKey) throw new Error(t("bg_no_key"));
  const tabId = sender.tab?.id ?? -1;
  const jobKey = msg.jobId != null ? `${tabId}:${msg.page ?? ""}:${msg.jobId}` : null;
  const work = { distance: Number.isFinite(msg.distance) ? msg.distance : 0, onScreen: msg.onScreen === true, since: Date.now(), ctl: new AbortController(), asked: false };
  let holdEnds = null;
  if (jobKey) { jobs.set(jobKey, work); lane.wake(); holdEnds = setTimeout(() => lane.wake(), HOLD_MS + 50); }
  try { return await translatePage(msg, settings, tabId, work); }
  finally {
    clearTimeout(holdEnds);
    if (jobKey && jobs.get(jobKey) === work) { jobs.delete(jobKey); lane.wake(); } // held pages may go on now
  }
}

// Pages being analysed (or waiting to be). The learned fill's model loads and runs once
// (engine/page.js warmInpainter) beside the lane, but its first run holds the engine's models for
// its length (seconds, on a worker's first start): the pages near the screen are analysed first,
// so their questions go out, unless that takes longer than 5 s. A page whose answer is in and
// needs the model starts it at once.
let analysing = 0, quiet = null;
function warmWhenQuiet() {
  if (inpainterWarm()) return warmInpainter();
  return (quiet ??= (async () => {
    const t = performance.now();
    while (analysing && performance.now() - t < 5000) await new Promise((r) => setTimeout(r, 100));
    return warmInpainter();
  })());
}

async function translatePage(msg, settings, tabId, work) {
  const { signal } = work.ctl;
  const priority = () => work.distance;
  const held = heldFor(work);
  const part = Number.isInteger(msg.part) && msg.part >= 0 && msg.part < 1000 ? msg.part : null; // one slice of a tall image
  const cacheKey = "cache:" + (await sha1(`${PROMPT_VERSION}|${settings.model}|${settings.targetLang}|${settings.useContext}|${msg.url || msg.dataUrl}${part != null ? "#part" + part : ""}`)); // the whole data URL: two images can share a beginning
  const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
  // start: when the page began (epoch ms); with the steps' durations below and each fill's own
  // start (fill.runs), the debug report lays the pages' work out on one timeline
  const timing = { start: Date.now() }; let t = performance.now();
  const lap = (k) => { const n = performance.now(); timing[k] = Math.round(n - t); t = n; };

  // Cache holds the model's answer only (not image bytes, which would exhaust
  // storage.session after a few pages); the page is re-analysed on a hit.
  const blob = await fetchImageBlob(msg, signal); lap("fetch");
  // time spent waiting for the engine before the analysis and the finish could start (other pages first)
  let asked = performance.now();
  timing.wait = 0;
  analysing++;
  let job, natural;
  try { ({ job, natural } = await lane.run((checkpoint) => { timing.wait += Math.round(performance.now() - asked); return decode(blob, checkpoint, part); }, priority, signal, held)); }
  finally { analysing--; }
  lap("analyze");
  engineOnCpu = !/detect:webgpu/.test(job.slices?.[0]?.analysis?.backend || "");
  // the page's analysis is freed here however it ends: answered, cancelled, Claude's answer failed
  // (answerPage lets any prefill of it return first)
  try {
    return await answerPage(msg, settings, tabId, work, { job, natural, cached, cacheKey, timing, lap, priority, held });
  } finally { natural?.close(); releasePage(job); }
}

// The prefill's place in the lane: behind every other task, so it only ever uses time the engine
// would have spent idle (lower runs sooner; pages are ranked by their distance from the screen).
const PREFILL_RANK = 1e9;

// Answers on their way, by cache key (see answerPage).
const answering = new Map();

/** Claude's answer for the page's slices: the results, the tokens, the new terms; cached. */
async function askClaude(settings, job, tabId, cacheKey) {
  const ctx = await getTabCtx(tabId);
  const call = (slice) => callClaude(settings, slice, ctx).then((r) => { recordUsage(r); return r; });
  const withRetry = async (slice) => {
    try { return await call(slice); }
    catch (e) {
      // a busy moment is worth one more try; a spent budget is not
      if (/Claude API (429|529|503)/.test(e.message) && !/spend (cap|limit)/i.test(e.message)) { await new Promise((r) => setTimeout(r, 2500)); return call(slice); }
      throw e;
    }
  };
  const raw = await Promise.all(job.slices.map(withRetry));
  recordPage(raw);
  const results = raw.map((r) => ({ items: r.items, ...(r.cut != null ? { cut: r.cut } : {}) }));
  const usage = { input_tokens: 0, output_tokens: 0 }, newTerms = [];
  for (const r of raw) { newTerms.push(...r.terms); if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; } }
  try { await chrome.storage.session.set({ [cacheKey]: { results, usage } }); }
  catch (e) { console.warn("Gytakusub: cache write failed", e); }
  return { results, usage, newTerms };
}

async function answerPage(msg, settings, tabId, work, { job, natural, cached, cacheKey, timing, lap, priority, held }) {
  const { signal } = work.ctl;
  let results, usage, newTerms = [];
  if (cached && !msg.force) {
    results = cached.results; usage = cached.usage;
  } else {
    if (signal.aborted) throw new Cancelled(); // (the page is released by translatePage)
    work.asked = true; // from here the page is paid for: it finishes even if the user scrolls away
    // While Claude answers (seconds), the engine fills this page's textured areas ahead
    // (engine/page.js prefillPage), so the finish finds them done; it stops at its next area
    // once the answer is in. A page off screen does this only in time the engine would have spent
    // idle; a page on screen at its own rank, since the reader is looking at it.
    // Areas that need the learned fill's model before it is loaded are left for a second pass: the
    // model loads beside the lane (engine/page.js warmInpainter), never inside it, and only once a
    // page has such an area (so the page on screen starts it while its answer is on the way).
    const pre = new AbortController();
    const rank = () => priority() + (work.onScreen ? 0 : PREFILL_RANK);
    const pass = () => lane.run((checkpoint) => prefillPage(job, { natural, checkpoint }), rank, pre.signal, held);
    const prefilled = (async () => {
      const { later } = await pass();
      if (!later) return;
      await Promise.race([warmWhenQuiet(), new Promise((r) => pre.signal.addEventListener("abort", r, { once: true }))]);
      if (!pre.signal.aborted) await pass();
    })().catch(() => {});
    let failed = null;
    const c0 = performance.now();
    try {
      // the same page already on its way to Claude (the reader reloaded, or opened it twice): wait
      // for that answer rather than pay for a second
      // (or already answered while this one was being analysed: the cache was read before that)
      const shared = !msg.force && answering.get(cacheKey);
      const meanwhile = !msg.force && !shared ? (await chrome.storage.session.get(cacheKey).catch(() => ({})))[cacheKey] : null;
      if (shared) ({ results, usage } = await shared);
      else if (meanwhile) ({ results, usage } = meanwhile);
      else {
        const asking = askClaude(settings, job, tabId, cacheKey);
        answering.set(cacheKey, asking);
        try { ({ results, usage, newTerms } = await asking); }
        finally { if (answering.get(cacheKey) === asking) answering.delete(cacheKey); }
      }
      // Claude's own time: "model" is this plus the wait for a fill under way ahead of the answer
      timing.claude = Math.round(performance.now() - c0);
    } catch (e) { failed = e; }
    finally { pre.abort(); await prefilled; } // (stopped before the analyses are used or freed)
    if (failed) throw failed;
  }
  lap("model");

  // Everything from here to the answer takes the lane too, at the page's priority. A page on
  // screen then waits at most for one model run of another page's analysis (that one hands
  // over at its next checkpoint), and nothing of it is left to wait behind the next page's
  // analysis, whose model runs hold the worker's one thread for seconds at a time.
  // The learned fill's model, when this page needs it and it isn't loaded yet: waited for here,
  // outside the lane. (Which areas need it, if no prefill got through them: they're filled now,
  // the others with them, and the finish finds them done.)
  if (!inpainterWarm()) {
    if (job.later == null) { const a = performance.now(); await lane.run((checkpoint) => { timing.wait += Math.round(performance.now() - a); return prefillPage(job, { natural, checkpoint }); }, priority, undefined, held); }
    if (job.later > 0) { const w0 = performance.now(); await warmInpainter(); timing.modelWait = Math.round(performance.now() - w0); }
  }
  const asked = performance.now();
  const { page, patches, cleanDataUrl } = await lane.run(async () => {
    timing.wait += Math.round(performance.now() - asked);
    const page = await finishPage(job, results, { natural });
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
      const big = page.canvas.width * page.canvas.height > 2.6e6;
      cleanDataUrl = await blobToDataUrl(await page.canvas.convertToBlob(big ? { type: "image/jpeg", quality: 0.92 } : { type: "image/png" }));
    }
    return { page, patches, cleanDataUrl };
  }, priority, undefined, held);
  lap("finish"); // layout, erase, the user's edits, encode
  timing.patchBytes = patches.reduce((s, p) => s + p.dataUrl.length, 0);
  if (page.detectMs) timing.detect = page.detectMs; // parts of "analyze": the text detector's and the bubble model's shares
  if (page.segmentMs) timing.segment = page.segmentMs;
  if (page.backend) timing.backend = page.backend; // where the models ran: webgpu / wasm / opencv
  if (page.fill) timing.fill = page.fill; // part of "finish": the erased areas by fill, and the texture fills' time
  if (page.dropped?.length) timing.dropped = page.dropped; // the lines labelled sound effects or logos, left as drawn
  if (page.answer?.length) timing.answer = page.answer; // what the answer contract repaired (engine/contract.js checkAnswer)
  if (page.look?.boxes) timing.look = page.look; // part of "finish": the second look at lines with no lettering found (boxes, lines found, ms)
  if (page.textMask) timing.textMask = page.textMask; // the learned text mask, when on: where it ran, its time (in the prefill, else "finish")
  return {
    items: page.items, placements: page.placements, regions: page.regions, letter: page.letter, engine: page.engine,
    work: page.work, width: job.width, height: job.height, usage, timing,
    patches, cleanDataUrl, cleanTop: page.canvasTop || 0, part: job.part, fromCache: !!(cached && !msg.force), cacheKey,
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
  if (!from || !to) { await speak((await getSettings()).targetLang); throw new Error(t("bg_gloss_both")); }
  const s = await getSettings();
  const lines = s.glossary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dup = lines.some((l) => l.split("=")[0].trim().toLowerCase() === from.toLowerCase());
  const glossary = (dup ? lines.map((l) => (l.split("=")[0].trim().toLowerCase() === from.toLowerCase() ? `${from} = ${to}` : l)) : [...lines, `${from} = ${to}`]).join("\n");
  await chrome.storage.sync.set({ glossary });
  return { ok: true, replaced: dup };
}

/**
 * The original image for the debug report (content.js exportReport). Its bytes go back into
 * the page's process, so: only with the debug overlay on, only for a tab, and only something
 * that really decodes as an image.
 */
async function fetchForReport(msg, sender) {
  if (!sender.tab) throw new Error("Not from a tab");
  const settings = await getSettings();
  await speak(settings.targetLang);
  if (!settings.debugOverlay) throw new Error(t("bg_report_needs_debug"));
  const blob = await fetchImageBlob(msg);
  try { (await createImageBitmap(blob)).close(); } catch { throw new Error(t("bg_not_image")); }
  return { dataUrl: await blobToDataUrl(blob), type: blob.type };
}

// The worker's own words (errors the page shows, the content script's labels) follow the target
// language like every page does; the messages are loaded again only when that language changes.
let workerLocale = null;
async function speak(targetLang) {
  // (and again when the last read failed: the words must not stay missing for the worker's life)
  if (uiLocaleFor(targetLang) !== workerLocale || !localeLoaded()) workerLocale = await useLanguageOf(targetLang);
  return workerLocale;
}
// Hyphenation patterns for the page script, which can't read our files from inside someone
// else's page. Only names languages.js uses; read once per worker.
const HYPHEN_NAMES = new Set(LANGUAGES.map((l) => l.hyphen).filter((h) => h && h !== "en-us"));
const hyphenCache = new Map();
function hyphenationPatterns(name) {
  if (!HYPHEN_NAMES.has(name)) return Promise.reject(new Error("Unknown hyphenation patterns"));
  if (!hyphenCache.has(name)) {
    hyphenCache.set(name, fetch(chrome.runtime.getURL(`vendor/hyphen/${name}.json`)).then((r) => r.json()).then((patterns) => ({ patterns })));
    hyphenCache.get(name).catch(() => hyphenCache.delete(name));
  }
  return hyphenCache.get(name);
}

/** An Error the content script can act on by its code, whatever language the message is in. */
const coded = (message, code) => Object.assign(new Error(message), { code });

// ---------- messaging ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false; // only this extension's own pages and content scripts
  if (sender.tab) devReloadSoon(); // a page asking (every page asks for its settings first)
  const reply = (p) => p.then((r) => sendResponse(r)).catch((e) => sendResponse({ error: e.message || String(e) }));
  switch (msg?.type) {
    case "TRANSLATE": handleTranslate(msg, sender).then(sendResponse, (e) => sendResponse(e instanceof Cancelled || e?.name === "AbortError" ? { cancelled: true } : { error: e.message || String(e), code: e.code })); return true;
    case "JOBS": sendResponse(updateJobs(sender.tab?.id ?? -1, msg)); return false;
    // the content script runs inside other people's pages: it gets the settings, but not the API key
    // with the words it shows on the page, in the reader's language (it can't read our files itself)
    // and how to letter the target language (line breaking, hyphenation patterns, upper case)
    case "GET_SETTINGS": reply(getSettings().then(async ({ apiKey, ...rest }) => ({ ...rest, hasKey: !!apiKey, uiLang: langTag(await speak(rest.targetLang)), ui: messagesWithPrefix("content_"), lettering: letteringFor(rest.targetLang) }))); return true;
    case "GET_HYPHENATION": reply(hyphenationPatterns(msg.name)); return true;
    case "EDIT_ITEM": reply(editItem(msg)); return true;
    case "FETCH_IMAGE": reply(fetchForReport(msg, sender)); return true;
    case "ADD_GLOSSARY": reply(addGlossary(msg)); return true;
    default: return false;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const map = { "translate-visible": "TRANSLATE_VISIBLE", "toggle-overlays": "TOGGLE_OVERLAYS" };
  if (!map[command] || !tab?.id) return;
  // before the user has seen what is sent and agreed, a shortcut opens that page instead of reading this one
  if (command === "translate-visible" && !(await consentGiven())) { openWelcome(); return; }
  // the address is visible with site access, or through the activeTab grant the shortcut gives;
  // when it's missing, try anyway: a page scripts can't run on (chrome://, the store) fails below
  if (tab.url && !/^https?:/.test(tab.url)) return;
  try {
    if (command === "translate-visible") await ensureContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: map[command] });
  } catch (e) { console.warn("Gytakusub command failed", e); }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`ctx:${tabId}`).catch(() => {});
});
