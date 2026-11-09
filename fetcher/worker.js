// Gytakusub chapter fetcher — your own Cloudflare Worker for the web app's
// "Chapter link" mode.
//
// Why it exists: a web page (the Gytakusub web app on github.io) may not read
// another site's pages or images unless that site allows it, and manga sites
// do not. A server may. This Worker is that server, run on your own free
// Cloudflare account: it fetches the chapter page you pasted, finds its page
// images, and relays those images to the app. Nothing is stored; your Claude
// key never passes through it. Setup: fetcher/README.md.
//
// Endpoints (all GET; all need `Authorization: Bearer <GYT_KEY>`):
//   /ping                         → {ok, version}
//   /chapter?url=<chapter page>   → {url, title, pages[], referer, next, prev, method}
//   /image?url=<image>&ref=<page> → the image bytes
// Errors are JSON {error, message} with a code the app explains:
//   challenge (the site shows a bot check), blocked (401/403), not-found,
//   no-images (nothing that looks like a chapter's pages), upstream, not-image,
//   bad-url, unauthorized.
//
// One file, no dependencies, so it can be pasted into the Cloudflare dashboard
// as is. The extraction functions are exported for the tests (tests/fetcher.test.mjs).

export const VERSION = "2.1.0";
const MAX_HTML = 2e6; // bytes of HTML read from a chapter page (real ones are 50–500 KB); bounds the free plan's 10 ms of CPU
const MAX_IMAGE = 40e6; // bytes; a manga page is well under this
const MIN_KEY = 24; // characters of GYT_KEY: the Worker's address is not secret, the key is
const MAX_REDIRECTS = 5;
// What the relay passes on: images only. Some CDNs label images application/octet-stream; those are checked by their first bytes.
const IMAGE_TYPES = /^image\/(?:jpeg|jpg|pjpeg|png|webp|avif|gif)$/i;
const IMG_EXT = /\.(?:jpe?g|jfif|png|webp|avif|gif)(?:[?#]|$)/i;

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return json(request, env, { error: "internal", message: String(e?.message || e) }, 500);
    }
  },
};

/** The request handler; `fetchFn` is injectable for tests. */
export async function handle(request, env = {}, fetchFn = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!originAllowed(origin, env)) return new Response("origin not allowed", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== "GET") return json(request, env, { error: "method", message: "GET only" }, 405);
  if (!env.GYT_KEY || env.GYT_KEY.length < MIN_KEY) return json(request, env, { error: "setup", message: `The Worker needs a GYT_KEY secret of at least ${MIN_KEY} random characters (Settings → Variables and Secrets); use the same value in the app.` }, 500);
  if (!authorized(request, env.GYT_KEY)) return json(request, env, { error: "unauthorized", message: "Wrong or missing access key." }, 401);

  const client = { ua: request.headers.get("User-Agent") || "Mozilla/5.0", lang: request.headers.get("Accept-Language") || "en" };
  switch (url.pathname.replace(/\/+$/, "") || "/") {
    case "/ping":
      return json(request, env, { ok: true, version: VERSION });
    case "/chapter": {
      const target = checkTarget(url.searchParams.get("url"));
      if (!target) return json(request, env, { error: "bad-url", message: "That is not a web address the fetcher may open." }, 400);
      const out = await chapter(target, client, fetchFn);
      return json(request, env, out.body, out.status, out.status === 200 ? { "Cache-Control": "private, max-age=300" } : {});
    }
    case "/image": {
      const target = checkTarget(url.searchParams.get("url"));
      const ref = url.searchParams.get("ref") ? checkTarget(url.searchParams.get("ref")) : null;
      if (!target) return json(request, env, { error: "bad-url", message: "That is not a web address the fetcher may open." }, 400);
      return image(request, env, target, ref, client, fetchFn);
    }
    default:
      return json(request, env, { error: "not-found", message: "Unknown endpoint." }, 404);
  }
}

// ---------- HTTP plumbing ----------

function originAllowed(origin, env) {
  if (!origin || !env.ALLOWED_ORIGINS) return true; // the key is the gate; ALLOWED_ORIGINS narrows it further
  return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean).includes(origin);
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(request, env, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env), ...extra } });
}

/** Constant-time comparison of the bearer token with the configured key. */
function authorized(request, key) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  const given = m ? m[1].trim() : "";
  if (given.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

/** A public http(s) URL on a default port, or null. Workers cannot reach private networks; this refuses them by name too. */
export function checkTarget(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const h = u.hostname.toLowerCase().replace(/\.+$/, ""); // "localhost." is localhost
  if (!h.includes(".") || h.startsWith("[")) return null; // single-label names and IPv6 literals
  if (/^\d+(?:\.\d+){3}$/.test(h)) return null; // IPv4 literals: manga sites have names, and Workers may not fetch by IP anyway
  if (h === "localhost" || /\.(?:localhost|local|internal|lan|home|arpa)$/.test(h)) return null;
  return u;
}

/** Signs that the response is a bot check (Cloudflare, DDoS-Guard) rather than the page. */
export function isChallenge(status, headers, text) {
  if ((headers.get("cf-mitigated") || "").toLowerCase() === "challenge") return true;
  if (status !== 403 && status !== 429 && status !== 503) return false;
  return /cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required! \| Cloudflare|ddos-guard|DDoS-Guard/i.test(text || "");
}

async function readText(res, max) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
    if (size >= max) { reader.cancel().catch(() => {}); break; }
  }
  const all = new Uint8Array(size); let o = 0;
  for (const c of chunks) { all.set(c.subarray(0, Math.min(c.length, size - o)), o); o += c.length; if (o >= size) break; }
  return new TextDecoder().decode(all);
}

/** The body, ending with an error once it passes `max` bytes (a missing Content-Length must not lift the cap). */
function capped(body, max) {
  let seen = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, ctl) { seen += chunk.byteLength; if (seen > max) ctl.error(new Error("too large")); else ctl.enqueue(chunk); },
  }));
}

/** JPEG, PNG, GIF, WebP or AVIF, by its first bytes; null otherwise. */
export function sniffImage(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 12 && String.fromCharCode(...b.slice(4, 8)) === "ftyp" && /^avi[fs]$/.test(String.fromCharCode(...b.slice(8, 12)))) return "image/avif";
  return null;
}

/** fetch() that follows at most MAX_REDIRECTS redirects itself, checking every hop like the first address. */
async function fetchChecked(fetchFn, target, init) {
  let url = target;
  for (let hop = 0; ; hop++) {
    const res = await fetchFn(url.toString(), { ...init, redirect: "manual" });
    const loc = res.status >= 300 && res.status < 400 && res.headers.get("Location");
    if (!loc) { Object.defineProperty(res, "finalUrl", { value: url.toString() }); return res; }
    const next = checkTarget(new URL(loc, url).toString());
    if (!next || hop >= MAX_REDIRECTS) return new Response("redirect refused", { status: 508 });
    url = next;
  }
}

function upstreamError(status, headers, text) {
  if (isChallenge(status, headers, text)) return { status: 502, body: { error: "challenge", message: "The site answered with a bot check (\"checking your browser\"), which a server cannot pass." } };
  if (status === 401 || status === 403) return { status: 502, body: { error: "blocked", message: `The site refused the fetcher (HTTP ${status}). It may need a login or block servers.` } };
  if (status === 404 || status === 410) return { status: 502, body: { error: "not-found", message: `The site says this page does not exist (HTTP ${status}).` } };
  if (status === 508) return { status: 502, body: { error: "upstream", message: "The site redirected to an address the fetcher may not open, or too many times." } };
  return { status: 502, body: { error: "upstream", message: `The site answered HTTP ${status}.` } };
}

// ---------- /chapter ----------

async function chapter(target, client, fetchFn) {
  const md = /(^|\.)mangadex\.org$/i.test(target.hostname) && /\/chapter\/([0-9a-f-]{36})/i.exec(target.pathname);
  if (md) return mangadex(md[1], target, fetchFn);

  const res = await fetchChecked(fetchFn, target, {
    headers: { "User-Agent": client.ua, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": client.lang },
  });
  const text = await readText(res, MAX_HTML);
  if (!res.ok) return upstreamError(res.status, res.headers, text);
  if (isChallenge(res.status, res.headers, text)) return upstreamError(503, res.headers, text);
  const finalUrl = res.finalUrl || target.toString();
  const found = await extractChapter(text, finalUrl);
  if (!found.pages.length) {
    return { status: 422, body: { error: "no-images", message: "No chapter pages found on that page. The site may load them with a script the fetcher cannot run, or need a login.", title: found.title } };
  }
  return { status: 200, body: { url: finalUrl, referer: finalUrl, ...found } };
}

/** MangaDex keeps pages behind its API (MangaDex@Home); its CORS policy requires a server to fetch them. */
async function mangadex(id, target, fetchFn) {
  const res = await fetchChecked(fetchFn, new URL(`https://api.mangadex.org/at-home/server/${id}?forcePort443=true`), {
    headers: { "User-Agent": `Gytakusub-fetcher/${VERSION} (+https://github.com/gywreb/gytakusub)`, Accept: "application/json" },
  });
  const text = await readText(res, MAX_HTML);
  if (!res.ok) return upstreamError(res.status, res.headers, text);
  const j = JSON.parse(text);
  const pages = (j.chapter?.data || []).map((f) => `${j.baseUrl}/data/${j.chapter.hash}/${f}`);
  if (!pages.length) return { status: 422, body: { error: "no-images", message: "MangaDex lists no pages for this chapter (it may be an external link)." } };
  return { status: 200, body: { url: target.toString(), referer: "https://mangadex.org/", title: "MangaDex chapter", pages, next: null, prev: null, method: "mangadex-api" } };
}

// ---------- /image ----------

async function image(request, env, target, ref, client, fetchFn) {
  const headers = { "User-Agent": client.ua, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", "Accept-Language": client.lang };
  // What a browser sends when it shows the image on that page (strict-origin-when-cross-origin).
  if (ref) headers.Referer = ref.origin === target.origin ? ref.toString() : ref.origin + "/";
  // Successful images stay in Cloudflare's edge cache (within your account) for a day; refusals and errors are never cached.
  const up = await fetchChecked(fetchFn, target, { headers, cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 86400, "300-599": 0 } } });
  const type = (up.headers.get("Content-Type") || "").split(";")[0].trim();
  if (!up.ok) {
    const e = upstreamError(up.status, up.headers, /text|json/i.test(type) ? await readText(up, 65536) : "");
    return json(request, env, e.body, e.status);
  }
  const len = Number(up.headers.get("Content-Length") || 0);
  if (len > MAX_IMAGE) { up.body?.cancel().catch(() => {}); return json(request, env, { error: "too-large", message: `Image is ${Math.round(len / 1e6)} MB.` }, 413); }
  // Only images leave the relay: an image type, or bytes that are one (CDNs that say octet-stream).
  const reader = up.body.getReader();
  const first = await reader.read();
  const head = first.value || new Uint8Array(0);
  const sniffed = sniffImage(head);
  if (!sniffed || (type && !IMAGE_TYPES.test(type) && !/^(?:application|binary)\/octet-stream$/i.test(type))) {
    const text = new TextDecoder().decode(head.slice(0, 65536));
    reader.cancel().catch(() => {});
    if (/cf-chl|challenge-platform|Just a moment\.\.\./i.test(text)) { const e = upstreamError(503, up.headers, text); return json(request, env, e.body, e.status); }
    return json(request, env, { error: "not-image", message: "The image address returned something that is not an image (a web page, a script or another file)." }, 502);
  }
  const body = new ReadableStream({
    start(ctl) { if (!first.done) ctl.enqueue(head); else ctl.close(); },
    async pull(ctl) { const { done, value } = await reader.read(); if (done) ctl.close(); else ctl.enqueue(value); },
    cancel(r) { return reader.cancel(r); },
  });
  return new Response(capped(body, MAX_IMAGE), { status: 200, headers: {
    "Content-Type": sniffed, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox", ...corsHeaders(request, env),
  } });
}

// ---------- extraction ----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#038": "&", "#38": "&", "#x26": "&", "#x2F": "/", "#47": "/", nbsp: " " };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (ENTITIES[e] !== undefined) return ENTITIES[e];
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });
}

/** Attributes of one tag's source text, lower-cased names, entity-decoded values. */
function attrsOf(tag) {
  const out = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  const body = tag.replace(/^<\s*[\w:-]+/, "").replace(/\/?>$/, "");
  while ((m = re.exec(body))) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** JS/JSON string escapes that hide URLs inside scripts: \/ / \x2F &. */
function unescapeJs(s) {
  return s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/");
}

function b64decode(s) {
  try {
    const bin = atob(s.replace(/\s+/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return ""; }
}

function resolve(u, base) {
  try {
    const v = u.trim();
    if (!v || /^(?:data|blob|javascript|about):/i.test(v)) return null;
    if (/^https?:\/\/[^\s"'<>\\]+$/i.test(v) && !/\/\.\.?\//.test(v)) return v; // already absolute: skip the (slow) URL parser
    const r = new URL(v, base);
    return r.protocol === "http:" || r.protocol === "https:" ? r.toString() : null;
  } catch { return null; }
}

/** The largest candidate of a srcset. */
function fromSrcset(v) {
  let best = null, bestW = -1;
  for (const part of v.split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    if (!u) continue;
    const w = d ? parseFloat(d) : 0;
    if (w >= bestW) { best = u; bestW = w; }
  }
  return best;
}

// Lazy-loading attributes used by manga reader themes, in the order the
// open-source Mihon/Tachiyomi sources prefer them (MangaThemesia, Madara, FMReader…).
const IMG_ATTRS = ["data-lazy-src", "data-src", "data-lzl-src", "data-cfsrc", "data-manga-src", "data-original", "data-img", "data-aload", "data-url", "data-full-url", "data-srcset", "srcset", "src"];

function imgUrl(a, base) {
  for (const k of IMG_ATTRS) {
    let v = a[k];
    if (!v || !v.trim()) continue;
    if (k.endsWith("srcset")) v = fromSrcset(v) || "";
    if (/^(?:data|blob):/i.test(v.trim())) continue; // a placeholder; a later attribute may hold the real one
    // FMReader-style themes base64-encode the address
    if (/^aHR0c[A-Za-z0-9+/=]+$/.test(v.trim())) { const d = b64decode(v); if (/^https?:\/\//.test(d)) v = d; }
    const r = resolve(v, base);
    if (r) return r;
  }
  return null;
}

// Things on a chapter page that are images but not pages. Judged by file name and
// by whole folder names only, so a series called "Ad Astra" or "Avatar" keeps its pages.
const JUNK_FILE = /(?:^|[_.\-])(?:logo|avatar|icon|favicon|banner|ads?|advert|sponsor|emoji|emoticon|gravatar|placeholder|loading|loader|spinner|thumb|thumbs|thumbnail|cover|poster|button|badge|sprite|discord|patreon|ko-?fi|paypal|facebook|twitter|reddit)(?=[_.\-]|\d|$)|-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp|avif)$/i;
const JUNK_DIR = /^(?:themes|plugins|emoji|emojis|avatars?|logos?|ads|banners?|icons?|thumbs?|thumbnails?|covers?|posters?|smilies|gravatar)$/i;
const JUNK_HOST = /(?:^|\.)(?:gravatar\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com)$/i;
const URL_PARTS = /^https?:\/\/([^/?#]+)([^?#]*)/i;
function isJunk(host, path) {
  const segs = path.split("/").filter(Boolean).map((x) => { if (!x.includes("%")) return x; try { return decodeURIComponent(x); } catch { return x; } });
  const file = segs.pop() || "";
  return JUNK_HOST.test(host) || JUNK_FILE.test(file) || segs.some((d) => JUNK_DIR.test(d));
}

function site(host) {
  const parts = host.toLowerCase().split(".");
  return parts.slice(-2).join(".");
}

/** Picks the pages out of every image address on the page: the largest group sharing a site and folder. */
export function pickPages(urls) {
  const seen = new Set(), list = [];
  for (const u of urls) {
    if (seen.has(u)) continue; seen.add(u);
    const m = URL_PARTS.exec(u);
    if (!m) continue;
    const p = { hostname: m[1].toLowerCase().replace(/:\d+$/, ""), pathname: m[2] || "/" };
    if (isJunk(p.hostname, p.pathname)) continue;
    list.push({ u, p, i: list.length });
  }
  if (list.length <= 1) return list.map((x) => x.u);
  const group = (keyOf) => {
    const g = new Map();
    for (const x of list) { const k = keyOf(x.p); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    let best = null;
    for (const v of g.values()) if (!best || v.length > best.length || (v.length === best.length && v[0].i < best[0].i)) best = v;
    return best;
  };
  const dir = (p) => site(p.hostname) + p.pathname.replace(/[^/]*$/, "");
  let best = group(dir);
  if (best.length < 3) {
    // one folder per image (Blogger, some CDNs): group by site and the first two folders instead
    const coarse = group((p) => site(p.hostname) + "/" + p.pathname.split("/").slice(1, 3).join("/"));
    if (coarse.length > best.length && coarse.length >= 3) best = coarse;
  }
  return best.sort((a, b) => a.i - b.i).map((x) => x.u);
}

const NEXT_TEXT = /^(?:next(?:\s+chapter|\s+ch\.?|\s+episode)?|next\s*[›»>→]|[›»→]|次(?:の話|へ)?|다음(?:\s*화)?|siguiente|próximo|proximo|suivant|selanjutnya|berikutnya|tiếp|chương sau|下一[章话話])\s*[›»>→]?$/i;
const PREV_TEXT = /^(?:[‹«←]?\s*)(?:prev(?:ious)?(?:\s+chapter|\s+ch\.?|\s+episode)?|[‹«←]|前(?:の話|へ)?|이전(?:\s*화)?|anterior|précédent|precedent|sebelumnya|trước|chương trước|上一[章话話])$/i;

const NAV_HINT = /next|prev|[›»‹«→←]|次|前|다음|이전|siguiente|anterior|pr[oó]ximo|suivant|pr[ée]c[ée]dent|selanjutnya|sebelumnya|berikutnya|ti[eế]p|tr[uư][oớ]c|下一|上一/i;

/** Next / previous chapter links: rel=next, reader JSON (nextUrl), or a link labelled Next / 次 / 다음 … on the same site. */
export function findNav(html, pageUrl) {
  const out = { next: null, prev: null };
  const page = new URL(pageUrl);
  const ok = (h) => {
    const r = resolve(h || "", pageUrl);
    if (!r) return null;
    const u = new URL(r);
    if (site(u.hostname) !== site(page.hostname) || u.href.replace(/#.*$/, "") === page.href.replace(/#.*$/, "")) return null;
    if (u.pathname === "/" || /^#/.test(h)) return null;
    return r;
  };
  // ts_reader / app JSON, also when the JSON sits inside an escaped string (\"nextUrl\":\"…\")
  const jsonLink = (key) => {
    const m = new RegExp(`\\\\?["']${key}\\\\?["']\\s*:\\s*\\\\?["']((?:[^"'\\\\]|\\\\/|\\\\u[0-9a-fA-F]{4})+)\\\\?["']`).exec(html);
    return m ? ok(unescapeJs(m[1])) : null;
  };
  if (html.includes("nextUrl")) out.next = jsonLink("nextUrl");
  if (html.includes("prevUrl")) out.prev = jsonLink("prevUrl");
  const linkRel = /<link\b[^<>]*>/gi; let m;
  while ((m = linkRel.exec(html))) {
    const a = attrsOf(m[0]);
    if (!out.next && /\bnext\b/i.test(a.rel || "")) out.next = ok(a.href);
    if (!out.prev && /\bprev\b/i.test(a.rel || "")) out.prev = ok(a.href);
  }
  // Links: each <a …> paired with the next </a> (one pass over both lists, so an unclosed <a> costs nothing extra).
  const closes = [];
  for (let i = html.indexOf("</a>"); i >= 0; i = html.indexOf("</a>", i + 4)) closes.push(i);
  let ci = 0;
  for (const m of html.matchAll(/<a\b([^<>]*)>/gi)) {
    if (out.next && out.prev) break;
    const from = m.index + m[0].length;
    while (ci < closes.length && closes[ci] < from) ci++;
    if (ci >= closes.length || closes[ci] - from > 600) continue;
    const inner = html.slice(from, closes[ci]);
    if (!NAV_HINT.test(m[1]) && !NAV_HINT.test(inner)) continue; // most links on a page are not chapter navigation; skip parsing them
    const a = attrsOf("<a " + m[1] + ">");
    const text = decodeEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const cls = `${a.class || ""} ${a.id || ""}`;
    if (!out.next && (/\bnext\b/i.test(a.rel || "") || /(?:^|[\s_-])next(?:[\s_-]|$)|ch-next|nav-next|next_page|btn-next/i.test(cls) || NEXT_TEXT.test(text))) out.next = ok(a.href);
    else if (!out.prev && (/\bprev\b/i.test(a.rel || "") || /(?:^|[\s_-])prev(?:ious)?(?:[\s_-]|$)|ch-prev|nav-previous|nav-prev|prev_page|btn-prev/i.test(cls) || PREV_TEXT.test(text))) out.prev = ok(a.href);
  }
  return out;
}

/** The text inside every <tag>…</tag> (script, title), found with indexOf so unclosed tags cost linear time. */
function elementText(html, tag) {
  const out = [], lower = html.toLowerCase(), openTag = "<" + tag, closeTag = "</" + tag;
  let i = 0;
  for (;;) {
    const start = lower.indexOf(openTag, i);
    if (start < 0) break;
    const c = lower.charCodeAt(start + openTag.length); // must be a whole tag name: <script>, <script src…, not <scripts
    const gt = lower.indexOf(">", start);
    if (gt < 0) break;
    if (!(c === 62 || c === 32 || c === 9 || c === 10 || c === 13 || c === 47)) { i = start + 1; continue; }
    const end = lower.indexOf(closeTag, gt);
    if (end < 0) break;
    out.push(html.slice(gt + 1, end));
    i = end + closeTag.length;
  }
  return out;
}

/** Everything on a chapter page that addresses an image, in page order: <img> tags, then addresses inside scripts. */
export async function extractChapter(html, pageUrl) {
  const baseTag = /<base\b[^<>]*?href\s*=\s*["']([^"'<>]+)["']/i.exec(html);
  const base = (baseTag && resolve(decodeEntities(baseTag[1]), pageUrl)) || pageUrl;
  const title = decodeEntities((elementText(html, "title")[0] || "").slice(0, 2000).replace(/\s+/g, " ").trim()).slice(0, 200);
  // Scripts some themes hide as base64 data: URLs (ts_reader.run, Madara's protector) — decoded once, read like inline scripts.
  const hidden = [];
  for (const m of html.matchAll(/<script\b[^<>]*?\bsrc\s*=\s*["']data:(?:text|application)\/javascript;base64,([A-Za-z0-9+/=\s]+)["']/gi)) if (m[1].length < 3e5) hidden.push(b64decode(m[1])); // reader scripts are a few KB
  const nav = findNav(html + "\n<script>" + hidden.join("\n") + "</script>", pageUrl);

  // Madara's "chapter protector": the page list is AES-encrypted in the page itself (key in the page too).
  const prot = await madaraProtector(html);
  if (prot.length) {
    const pages = pickPages(prot.map((u) => resolve(u, base)).filter(Boolean));
    if (pages.length) return { title, pages, ...nav, method: "madara-protector" };
  }

  const fromTags = [];
  for (const m of html.matchAll(/<img\b[^<>]*>/gi)) { const u = imgUrl(attrsOf(m[0]), base); if (u) fromTags.push(u); }

  // Image addresses inside scripts (reader JSON, Next.js payloads, `var pages = [...]`), absolute or site-relative.
  const fromScripts = [];
  const scan = (code) => {
    const s = unescapeJs(code);
    for (const r of s.matchAll(/https?:\/\/[^\s"'<>\\`)]+/g)) if (IMG_EXT.test(r[0])) fromScripts.push(r[0]);
    for (const r of s.matchAll(/["'](\/[^"'\s<>\\]{1,400}?\.(?:jpe?g|jfif|png|webp|avif|gif)(?:\?[^"'\s<>\\]{0,400})?)["']/gi)) { const u = resolve(r[1], base); if (u) fromScripts.push(u); }
  };
  for (const code of elementText(html, "script")) if (code.trim()) scan(code);
  hidden.forEach(scan);

  const tagPages = pickPages(fromTags);
  const scriptPages = pickPages(fromScripts);
  // Readers that build the page from a script (ts_reader, Next.js) leave few or no <img> tags; prefer whichever found more pages.
  if (scriptPages.length > tagPages.length) return { title, pages: scriptPages, ...nav, method: "script" };
  return { title, pages: tagPages, ...nav, method: tagPages.length ? "img" : "none" };
}

// ---------- Madara chapter protector (CryptoJS AES, OpenSSL key derivation) ----------

async function madaraProtector(html) {
  const at = html.search(/<script\b[^<>]*?id\s*=\s*["']chapter-protector-data["']/i);
  if (at < 0) return [];
  const open = html.indexOf(">", at);
  if (open < 0) return [];
  const a = attrsOf(html.slice(at, open + 1));
  const close = html.indexOf("</script>", open);
  const script = a.src && /^data:[^,]*;base64,/i.test(a.src) ? b64decode(a.src.replace(/^data:[^,]*,/, "")) : html.slice(open + 1, close < 0 ? open + 1 : close);
  const pass = /wpmangaprotectornonce\s*=\s*'([^']*)'/.exec(script)?.[1];
  const data = /chapter_data\s*=\s*'([^']*)'/.exec(script)?.[1];
  if (!pass || !data) return [];
  try {
    const obj = JSON.parse(data.replace(/\\\//g, "/"));
    const text = await cryptoJsDecrypt(obj.ct, obj.s, pass);
    let list = JSON.parse(text);
    if (typeof list === "string") list = JSON.parse(list);
    return Array.isArray(list) ? list.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

async function cryptoJsDecrypt(ctB64, saltHex, password) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const pass = new TextEncoder().encode(password);
  // EVP_BytesToKey(MD5): D_i = MD5(D_{i-1} || password || salt) until 48 bytes (32 key + 16 iv)
  let prev = new Uint8Array(0), derived = new Uint8Array(0);
  while (derived.length < 48) {
    const input = new Uint8Array(prev.length + pass.length + salt.length);
    input.set(prev, 0); input.set(pass, prev.length); input.set(salt, prev.length + pass.length);
    prev = md5(input);
    const n = new Uint8Array(derived.length + prev.length); n.set(derived); n.set(prev, derived.length); derived = n;
  }
  const key = await crypto.subtle.importKey("raw", derived.slice(0, 32), { name: "AES-CBC" }, false, ["decrypt"]);
  const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: derived.slice(32, 48) }, key, ct);
  return new TextDecoder().decode(plain);
}

/** MD5 (RFC 1321) of bytes; only for CryptoJS's key derivation above. */
export function md5(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const len = bytes.length, total = ((len + 8 >>> 6) + 1) * 64;
  const buf = new Uint8Array(total); buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (len * 8) >>> 0, true); dv.setUint32(total - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < total; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + dv.getUint32(off + g * 4, true)) >>> 0;
      A = D; D = C; C = B;
      const s = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16), o = new DataView(out.buffer);
  o.setUint32(0, a0, true); o.setUint32(4, b0, true); o.setUint32(8, c0, true); o.setUint32(12, d0, true);
  return out;
}
