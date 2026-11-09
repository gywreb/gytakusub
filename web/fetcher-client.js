// Gytakusub Web – talks to your chapter fetcher (fetcher/worker.js, a Cloudflare
// Worker on your own account). The app cannot read other sites itself — the
// browser forbids it — so chapter links go through the fetcher, which opens the
// page, lists its images and relays them. Setup: fetcher/README.md.

/** The fetcher's base address from whatever the user pasted (trailing slash, an old `?url=` proxy form). */
export function fetcherBase(raw) {
  const v = String(raw || "").trim().replace(/\?url=?$/, "").replace(/\/+$/, "");
  if (!v) return "";
  try { const u = new URL(v.includes("://") ? v : "https://" + v); return u.origin + u.pathname.replace(/\/+$/, ""); } catch { return ""; }
}

export const hasFetcher = (s) => !!(fetcherBase(s.fetcherUrl) && s.fetcherKey);

// What each error code from the fetcher means for the reader, and what to do instead.
const ADVICE = {
  challenge: "This site puts a “checking your browser” wall in front of servers, so the fetcher can't open it. Use screenshot mode here, or the browser extension on a computer.",
  blocked: "This site refuses the fetcher (it may need a login, or it blocks servers). Use screenshot mode here, or the browser extension on a computer.",
  "no-images": "No chapter pages were found on that page. If the site needs a login or builds its pages with a script, use screenshot mode.",
  "not-found": "The site says that page does not exist. Check the link.",
  unauthorized: "Your fetcher refused the access key. Check Settings → Chapter fetcher.",
  "bad-url": "That doesn't look like a web address of a chapter.",
};

class FetcherError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function call(settings, path, params) {
  const base = fetcherBase(settings.fetcherUrl);
  if (!base || !settings.fetcherKey) throw new FetcherError("setup", "Set up your chapter fetcher first: Settings → Chapter fetcher.");
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${settings.fetcherKey}` }, credentials: "omit" });
  } catch {
    throw new FetcherError("unreachable", `No answer from your fetcher at ${base}. If Settings → Test fetcher fails too, check the address and that the Worker is deployed. If the test works, the fetcher stopped on this page: Cloudflare's free plan allows 10 ms of work per request, and a very large page can exceed it.`);
  }
  if (res.ok) return res;
  let body = {};
  try { body = await res.json(); } catch { /* not JSON: a Cloudflare error page */ }
  const code = body.error || `http-${res.status}`;
  throw new FetcherError(code, ADVICE[code] ? `${ADVICE[code]}${body.message && code !== "unauthorized" ? ` (${body.message})` : ""}` : body.message || `The fetcher answered HTTP ${res.status}.`);
}

/** Checks the address and key: resolves to the fetcher's version. */
export async function testFetcher(settings) {
  const j = await (await call(settings, "/ping", {})).json();
  return j.version;
}

/** The chapter at `url`: {url, title, pages[], referer, next, prev, method}. */
export async function loadChapter(settings, url) {
  return (await call(settings, "/chapter", { url })).json();
}

/** One page image through the fetcher, with the chapter page as its referrer. */
export async function fetchPageImage(settings, url, referer) {
  return (await call(settings, "/image", referer ? { url, ref: referer } : { url })).blob();
}
