// Gytakusub Web – talks to your chapter fetcher (fetcher/worker.js, a Cloudflare
// Worker on your own account). The app cannot read other sites itself — the
// browser forbids it — so chapter links go through the fetcher, which opens the
// page, lists its images and relays them. Setup happens in the Chapter link tab.

// The fetcher code this app was built with (copied in by scripts/sync-shared.mjs).
import { VERSION } from "./fetcher-worker.js";

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
  challenge: "This site puts a “checking your browser” wall in front of servers, so the fetcher can't open it. Use screenshot mode here, or the browser extension on a computer.",
  blocked: "This site refuses the fetcher (it may need a login, or it blocks servers). Use screenshot mode here, or the browser extension on a computer.",
  "no-images": "No chapter pages were found on that page. If the site needs a login or builds its pages with a script, use screenshot mode.",
  "not-found": "The site says that page does not exist. Check the link.",
  unauthorized: "Your fetcher refused the access key: the key here is not the GYT_KEY on your Worker.",
  setup: "Your fetcher has no key yet (or one shorter than 24 characters). Do step 4: in Cloudflare open the Worker → Settings → Variables and Secrets, add the Secret GYT_KEY with your key, Deploy, then Connect again.",
  "bad-url": "That doesn't look like a web address of a chapter.",
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
// Every call carries the key in an Authorization header, so before a new address the browser asks
// the fetcher for permission (a CORS preflight, an OPTIONS request), and Cloudflare counts that too:
// a chapter page costs two requests. The browser keeps that permission per address for a while
// (Chromium up to 2 hours, Firefox up to 24); the count assumes 10 minutes, and counts again what the
// browser serves from its own cache, so it errs high, never low.
export const FREE_DAILY = 100_000;
const USAGE_KEY = "gytakusub.fetcherUsage";
const utcDay = () => new Date().toISOString().slice(0, 10);
const listeners = new Set();
const PREFLIGHT_KEEP = 10 * 60e3;
const preflightAt = new Map(); // address → when a permission check was last counted for it

/** Whether the browser (probably) asked permission before calling `url`; erring towards yes. */
function preflightCounted(url, now = Date.now()) {
  const at = preflightAt.get(url);
  if (at !== undefined && now - at < PREFLIGHT_KEEP) return false;
  if (preflightAt.size > 2000) for (const [u, t] of preflightAt) if (now - t >= PREFLIGHT_KEEP) preflightAt.delete(u);
  preflightAt.set(url, now);
  return true;
}

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
    if (e.code === "not-found") throw new FetcherError("usage-old", `Update your fetcher to ${USAGE_VERSION} or newer for Cloudflare's count.`);
    throw e;
  }
}

/** Calls fn() whenever the count changes. */
export function onUsage(fn) { listeners.add(fn); }

function countRequest(base, path, ok, url) {
  const u = usageToday(base);
  u.requests += preflightCounted(url) ? 2 : 1;
  if (path === "/chapter" && ok) u.chapters++;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify({ day: utcDay(), base, ...u })); } catch { /* not counted */ }
  for (const fn of listeners) fn();
}

/** When the free allowance starts again, in the reader's own time: midnight UTC, e.g. "7:00 AM". */
export function resetTime() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const LIMIT_REACHED = () => `Your fetcher has used today's ${FREE_DAILY.toLocaleString()} free requests on Cloudflare. It works again at ${resetTime()}, and nothing is charged. Screenshot mode still works.`;

// `inUse`: the fetcher was connected before, so a silent failure is about this request, not the address.
async function call(path, params, base, key, inUse = false) {
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, credentials: "omit" });
  } catch {
    throw new FetcherError("unreachable", inUse
      ? `No answer from your fetcher. Check that you're online. Otherwise, either today's ${FREE_DAILY.toLocaleString()} free requests are used up (it works again at ${resetTime()}, and nothing is charged), or this page needed more work than Cloudflare's free plan allows per request (10 ms). Screenshot mode still works.`
      : `No answer from ${base}. Check the address (copy it from the Worker's page in Cloudflare) and that the deploy finished.`);
  }
  countRequest(base, path, res.ok, url);
  if (res.ok) return res;
  const text = await res.text().catch(() => "");
  let body = {};
  try { body = JSON.parse(text); } catch { /* not JSON: not a Gytakusub fetcher, or a Cloudflare error page */ }
  const code = body.error || `http-${res.status}`;
  // Cloudflare's own error pages, when the browser may read them
  if (!body.error && /\b1027\b/.test(text)) throw new FetcherError("daily-limit", LIMIT_REACHED());
  if (!body.error && /\b1102\b/.test(text)) throw new FetcherError("cpu", "This page needed more work than Cloudflare's free plan allows per request (10 ms). Try again; if it keeps failing, use screenshot mode for this chapter.");
  if (!body.error) throw new FetcherError(code, `${base} answered HTTP ${res.status}, not like a Gytakusub fetcher. Check the address.`);
  const extra = body.message && !["unauthorized", "setup"].includes(code) ? ` (${body.message})` : "";
  const err = new FetcherError(code, ADVICE[code] ? ADVICE[code] + extra : body.message || `The fetcher answered HTTP ${res.status}.`);
  if (body.version) err.version = body.version;
  throw err;
}

/**
 * Checks an address and key against the fetcher. On success returns the settings fields to save
 * ({fetcherUrl, fetcherKey, fetcherCheck}); throws a FetcherError with a reader-facing message otherwise.
 */
export async function connectFetcher(url, key) {
  const base = fetcherBase(url);
  if (!base) throw new FetcherError("no-address", "Enter your fetcher's address: https://….workers.dev");
  if ((key || "").length < MIN_KEY) throw new FetcherError("short-key", `The access key must be at least ${MIN_KEY} characters (generate one in step 1).`);
  const j = await (await call("/ping", {}, base, key)).json();
  if (!j.ok || !j.version) throw new FetcherError("not-fetcher", `${base} answered, but not like a Gytakusub fetcher.`);
  if (!atLeast(j.version, MIN_FETCHER_VERSION)) throw new FetcherError("outdated", `Your fetcher is version ${j.version}; this app needs ${MIN_FETCHER_VERSION} or newer. On GitHub, open your gytakusub copy → Sync fork → Update branch; wait a minute, then Connect again.`);
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
