// Gytakusub Web – talks to your chapter fetcher (fetcher/worker.js, a Cloudflare
// Worker on your own account). The app cannot read other sites itself — the
// browser forbids it — so chapter links go through the fetcher, which opens the
// page, lists its images and relays them. Setup happens in the Chapter link tab.

// The fetcher code this app was built with (copied in by scripts/sync-shared.mjs):
// its version is the oldest fetcher this app accepts, and the setup guide offers its source.
import { VERSION } from "./fetcher-worker.js";

export const FETCHER_VERSION = VERSION;
export const DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/gywreb/gytakusub/tree/main/fetcher";
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
  return s.fetcherCheck.sig === (await signature(base, s.fetcherKey)) && atLeast(s.fetcherCheck.version, FETCHER_VERSION);
}

// What each error code from the fetcher means for the reader, and what to do instead.
const ADVICE = {
  challenge: "This site puts a “checking your browser” wall in front of servers, so the fetcher can't open it. Use screenshot mode here, or the browser extension on a computer.",
  blocked: "This site refuses the fetcher (it may need a login, or it blocks servers). Use screenshot mode here, or the browser extension on a computer.",
  "no-images": "No chapter pages were found on that page. If the site needs a login or builds its pages with a script, use screenshot mode.",
  "not-found": "The site says that page does not exist. Check the link.",
  unauthorized: "Your fetcher refused the access key: the key here is not the GYT_KEY on your Worker.",
  setup: "Your fetcher has no usable GYT_KEY yet (missing, still CHANGE_ME, or shorter than 24 characters). In Cloudflare open the Worker → Settings → Variables and Secrets, set GYT_KEY to your key, deploy, then Connect again.",
  "bad-url": "That doesn't look like a web address of a chapter.",
};

export class FetcherError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function call(path, params, base, key) {
  let res;
  try {
    res = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${key}` }, credentials: "omit" });
  } catch {
    throw new FetcherError("unreachable", `No answer from ${base}. Check the address (copy it from the Worker's page in Cloudflare) and that the deploy finished. If Connect worked before and only this chapter fails, the fetcher stopped on that page: Cloudflare's free plan allows 10 ms of work per request, and a very large page can exceed it.`);
  }
  if (res.ok) return res;
  let body = {};
  try { body = await res.json(); } catch { /* not JSON: not a Gytakusub fetcher, or a Cloudflare error page */ }
  const code = body.error || `http-${res.status}`;
  if (!body.error) throw new FetcherError(code, `${base} answered HTTP ${res.status}, not like a Gytakusub fetcher. Check the address.`);
  const extra = body.message && !["unauthorized", "setup"].includes(code) ? ` (${body.message})` : "";
  throw new FetcherError(code, ADVICE[code] ? ADVICE[code] + extra : body.message || `The fetcher answered HTTP ${res.status}.`);
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
  if (!atLeast(j.version, FETCHER_VERSION)) throw new FetcherError("outdated", `Your fetcher is version ${j.version}; this app needs ${FETCHER_VERSION} or newer. Update it (“Update your fetcher” below), then Connect again.`);
  return { fetcherUrl: base, fetcherKey: key, fetcherCheck: { sig: await signature(base, key), version: j.version, at: Date.now() } };
}

/** The chapter at `url`: {url, title, pages[], referer, next, prev, method}. */
export async function loadChapter(s, url) {
  return (await call("/chapter", { url }, fetcherBase(s.fetcherUrl), s.fetcherKey)).json();
}

/** One page image through the fetcher, with the chapter page as its referrer. */
export async function fetchPageImage(s, url, referer) {
  return (await call("/image", referer ? { url, ref: referer } : { url }, fetcherBase(s.fetcherUrl), s.fetcherKey)).blob();
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
