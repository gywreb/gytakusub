// Gytakusub Web – talks to your chapter fetcher (fetcher/worker.js, a Cloudflare
// Worker on your own account). The app cannot read other sites itself — the
// browser forbids it — so chapter links go through the fetcher, which opens the
// page, lists its images and relays them. Setup happens in the Chapter link tab.

// The fetcher code this app was built with (copied in by scripts/sync-shared.mjs).
import { VERSION } from "./fetcher-worker.js";
import { t, langTag } from "./i18n.js";

export const FETCHER_VERSION = VERSION; // the newest fetcher: what "Sync fork" brings
// The oldest fetcher the app works with. Raise it only when chapters can't work otherwise:
// every user then has to update theirs. Newer features check their own version (USAGE_VERSION).
export const MIN_FETCHER_VERSION = "2.1.0";
export const USAGE_VERSION = "2.4.0"; // /usage: today's count from Cloudflare
export const MIN_KEY = 24;

/** The fetcher's base address from whatever the user pasted (trailing slash, a path, no scheme). */
export function fetcherBase(raw) {
  const v = String(raw || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (!v) return "";
  try {
    const u = new URL(v.includes("://") ? v : "https://" + v);
    if (u.protocol !== "https:" && !/^(?:127\.0\.0\.1|localhost)$/.test(u.hostname)) return "";
    return u.origin;
  } catch { return ""; }
}

/** A random access key: 32 characters from a 62-letter alphabet (about 190 bits), without modulo bias. */
export function generateKey() {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const limit = 4294967296 - (4294967296 % 62);
  const out = [];
  const buf = new Uint32Array(64);
  while (out.length < 32) {
    crypto.getRandomValues(buf);
    for (const n of buf) if (n < limit && out.length < 32) out.push(abc[n % 62]);
  }
  return out.join("");
}

/** a >= b for "x.y.z" versions. */
function atLeast(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return true;
}

async function signature(base, key) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base + "\n" + key));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** True when this address and key passed Connect, and the fetcher was new enough for this app. */
export async function isConnected(s) {
  const base = fetcherBase(s.fetcherUrl);
  if (!base || !s.fetcherKey || !s.fetcherCheck) return false;
  return s.fetcherCheck.sig === (await signature(base, s.fetcherKey)) && atLeast(s.fetcherCheck.version, MIN_FETCHER_VERSION);
}

// What each error code from the fetcher means for the reader, and what to do instead.
const ADVICE = {
  challenge: "web_fx_challenge",
  blocked: "web_fx_blocked",
  "no-images": "web_fx_no_images",
  "not-found": "web_fx_not_found",
  unauthorized: "web_fx_unauthorized",
  setup: "web_fx_setup",
  "bad-url": "web_fx_bad_url",
};

export class FetcherError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- the free allowance ----------
// Cloudflare's Workers Free plan allows 100,000 requests a day per account, counted from midnight UTC.
// Past that, requests fail (Cloudflare error 1027) until the reset; the free plan has no billing.
// A Worker can't read its account's usage without an extra Cloudflare API token, so the app counts
// the requests *this device* sends. Other devices, and people given the connection link, use the
// same allowance but are not in this count; Cloudflare's own count is in its dashboard.
// This device's own count: the requests this browser or app sent to the fetcher today, counted
// as they're sent. Only that is measured here. Cloudflare's count for the account is higher: it
// adds the browser's permission check before a new address (a CORS preflight, which the page
// can't see), other devices and other Workers. That total comes from Cloudflare (loadCloudUsage).
export const FREE_DAILY = 100_000;
const USAGE_KEY = "gytakusub.fetcherUsage";
const utcDay = () => new Date().toISOString().slice(0, 10);
const listeners = new Set();

/** Today's count for the fetcher at `base`: {requests, chapters}. */
export function usageToday(base) {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
    if (u.day === utcDay() && u.base === base) return { requests: u.requests || 0, chapters: u.chapters || 0 };
  } catch { /* storage unavailable */ }
  return { requests: 0, chapters: 0 };
}

/**
 * Today's count for the whole Cloudflare account, read by the fetcher from Cloudflare's analytics
 * (/usage): {requests, errors, limit, day, asOf, workers[], version}. The same number on every device.
 * Throws FetcherError "usage-old" (fetcher older than USAGE_VERSION), "usage-setup" (no token on the
 * Worker yet; err.version is the fetcher's), "usage-upstream" (Cloudflare refused), or a connection error.
 */
export async function loadCloudUsage(s) {
  const base = fetcherBase(s.fetcherUrl);
  try {
    return await (await call("/usage", {}, base, s.fetcherKey, true)).json();
  } catch (e) {
    if (e.code === "not-found") throw new FetcherError("usage-old", t("web_fx_usage_old", { version: USAGE_VERSION }));
    throw e;
  }
}

/** Calls fn() whenever the count changes. */
export function onUsage(fn) { listeners.add(fn); }

function countRequest(base, path, ok) {
  const u = usageToday(base);
  u.requests += 1;
  if (path === "/chapter" && ok) u.chapters++;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify({ day: utcDay(), base, ...u })); } catch { /* not counted */ }
  for (const fn of listeners) fn();
}

/** When the free allowance starts again, in the reader's own time: midnight UTC, e.g. "7:00 AM". */
export function resetTime() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toLocaleTimeString(langTag(), { hour: "numeric", minute: "2-digit" });
}

const LIMIT_REACHED = () => t("web_fx_limit", { limit: FREE_DAILY.toLocaleString(langTag()), time: resetTime() });

// `inUse`: the fetcher was connected before, so a silent failure is about this request, not the address.
async function call(path, params, base, key, inUse = false) {
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, credentials: "omit" });
  } catch {
    throw new FetcherError("unreachable", inUse
      ? t("web_fx_silent", { limit: FREE_DAILY.toLocaleString(langTag()), time: resetTime() })
      : t("web_fx_no_answer", { address: base }));
  }
  countRequest(base, path, res.ok);
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON: not a Gytakusub fetcher, or a Cloudflare error page */ }
  const code = body.error || `http-${res.status}`;
  // Cloudflare's own error pages, when the browser may read them
  if (!body.error && /\b1027\b/.test(text)) throw new FetcherError("daily-limit", LIMIT_REACHED());
  if (!body.error && /\b1102\b/.test(text)) throw new FetcherError("cpu", t("web_fx_cpu"));
  if (!body.error) throw new FetcherError(code, t("web_fx_not_fetcher_http", { address: base, status: res.status }));
  const extra = body.message && !["unauthorized", "setup"].includes(code) ? ` (${body.message})` : "";
  const err = new FetcherError(code, ADVICE[code] ? t(ADVICE[code]) + extra : body.message || t("web_fx_http", { status: res.status }));
  if (body.version) err.version = body.version;
  throw err;
}

/**
 * Checks an address and key against the fetcher. On success returns the settings fields to save
 * ({fetcherUrl, fetcherKey, fetcherCheck}); throws a FetcherError with a reader-facing message otherwise.
 */
export async function connectFetcher(url, key) {
  const base = fetcherBase(url);
  if (!base) throw new FetcherError("no-address", t("web_fx_no_address"));
  if ((key || "").length < MIN_KEY) throw new FetcherError("short-key", t("web_fx_short_key", { n: MIN_KEY }));
  const j = await (await call("/ping", {}, base, key)).json();
  if (!j.ok || !j.version) throw new FetcherError("not-fetcher", t("web_fx_not_fetcher", { address: base }));
  if (!atLeast(j.version, MIN_FETCHER_VERSION)) throw new FetcherError("outdated", t("web_fx_outdated", { version: j.version, needed: MIN_FETCHER_VERSION }));
  return { fetcherUrl: base, fetcherKey: key, fetcherCheck: { sig: await signature(base, key), version: j.version, at: Date.now() } };
}

/** The chapter at `url`: {url, title, pages[], referer, next, prev, method}. */
export async function loadChapter(s, url) {
  return (await call("/chapter", { url }, fetcherBase(s.fetcherUrl), s.fetcherKey, true)).json();
}

/** One page image through the fetcher, with the chapter page as its referrer. */
export async function fetchPageImage(s, url, referer) {
  return (await call("/image", referer ? { url, ref: referer } : { url }, fetcherBase(s.fetcherUrl), s.fetcherKey, true)).blob();
}

/** A link that fills in this fetcher on another device (address and key in the #fragment, which never reaches a server). */
export function connectionLink(s) {
  const data = btoa(JSON.stringify({ u: fetcherBase(s.fetcherUrl), k: s.fetcherKey })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${location.origin}${location.pathname}#connect=${data}`;
}

/** {url, key} from a connection link's fragment, or null. */
export function readConnectionLink(hash) {
  const m = /[#&]connect=([A-Za-z0-9_-]+)/.exec(hash || "");
  if (!m) return null;
  try {
    const j = JSON.parse(atob(m[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof j.u === "string" && typeof j.k === "string" ? { url: j.u, key: j.k } : null;
  } catch { return null; }
}
