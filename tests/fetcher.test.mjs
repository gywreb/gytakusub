// Chapter fetcher (fetcher/worker.js): page extraction on the reader themes most
// manga sites run on, and the Worker's request handling — key, CORS, address
// checks, bot-check and no-pages errors, the image relay and its Referer —
// with the network mocked. Run: node fetcher.test.mjs
import fs from "node:fs";
import crypto from "node:crypto";
import { extractChapter, pickPages, findNav, checkTarget, md5, handle, sniffImage } from "../fetcher/worker.js";

let failures = 0, passes = 0;
const ok = (cond, name, extra = "") => { if (cond) { passes++; console.log("ok -", name); } else { failures++; console.log("not ok -", name, extra); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fx = (f) => fs.readFileSync(new URL(`./fixtures/fetcher/${f}`, import.meta.url), "utf8");
const expect = JSON.parse(fx("expect.json"));

// ---------- extraction per theme ----------
for (const [file, e] of Object.entries(expect)) {
  const got = await extractChapter(fx(file), e.url);
  ok(eq(got.pages, e.pages), `[${file}] pages: exactly the chapter's, in order`, `\n   got  ${JSON.stringify(got.pages)}\n   want ${JSON.stringify(e.pages)}`);
  ok(got.next === e.next && got.prev === e.prev, `[${file}] next/prev chapter links`, `got next=${got.next} prev=${got.prev}`);
}

// Madara's chapter protector: the page list is AES-encrypted CryptoJS-style in the page.
{
  const pages = ["https://madara.example.org/wp-content/uploads/WP-manga/data/manga_9/c1/01.jpg", "https://madara.example.org/wp-content/uploads/WP-manga/data/manga_9/c1/02.jpg", "https://madara.example.org/wp-content/uploads/WP-manga/data/manga_9/c1/03.jpg"];
  const pass = "f3a9c2", salt = crypto.randomBytes(8);
  let prev = Buffer.alloc(0), d = Buffer.alloc(0);
  while (d.length < 48) { prev = crypto.createHash("md5").update(Buffer.concat([prev, Buffer.from(pass), salt])).digest(); d = Buffer.concat([d, prev]); }
  const c = crypto.createCipheriv("aes-256-cbc", d.subarray(0, 32), d.subarray(32, 48));
  const ct = Buffer.concat([c.update(JSON.stringify(JSON.stringify(pages))), c.final()]).toString("base64");
  const data = JSON.stringify({ ct, iv: d.subarray(32, 48).toString("hex"), s: salt.toString("hex") }).replace(/\//g, "\\/");
  const script = `var wpmangaprotectornonce='${pass}';var chapter_data='${data}';`;
  const html = `<html><head><title>Protected</title></head><body><div class="reading-content"></div><script id="chapter-protector-data" src="data:text/javascript;base64,${Buffer.from(script).toString("base64")}"></script></body></html>`;
  const got = await extractChapter(html, "https://madara.example.org/manga/x/chapter-1/");
  ok(eq(got.pages, pages) && got.method === "madara-protector", "[madara protector] decrypts the page list", JSON.stringify(got));
}

// MD5 matches Node's (it derives the protector key)
for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "y".repeat(200)]) {
  const want = crypto.createHash("md5").update(s).digest("hex");
  const got = Buffer.from(md5(new TextEncoder().encode(s))).toString("hex");
  ok(got === want, `md5(${s.length} bytes)`);
}

// ---------- page picking ----------
ok(eq(pickPages(["https://x.example/a/avatar/1.jpg", "https://x.example/series/ad-astra/1/01.jpg", "https://x.example/series/ad-astra/1/02.jpg"]), ["https://x.example/series/ad-astra/1/01.jpg", "https://x.example/series/ad-astra/1/02.jpg"]),
  "a series named like junk (Ad Astra) keeps its pages; an avatars folder does not");
ok(eq(pickPages(["https://c.example/w/9/longstrip.jpg"]), ["https://c.example/w/9/longstrip.jpg"]), "a one-image chapter (webtoon strip) is returned");
ok(eq(pickPages(["https://c.example/a/1.jpg", "https://c.example/a/1.jpg", "https://c.example/a/2.jpg"]), ["https://c.example/a/1.jpg", "https://c.example/a/2.jpg"]), "duplicates (noscript copies) are dropped");

// ---------- addresses ----------
for (const bad of ["http://localhost/x", "http://localhost./x", "http://127.0.0.1/x", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "http://198.18.0.1/", "http://8.8.8.8/", "file:///etc/passwd", "ftp://x.example/", "https://user:pw@x.example/", "https://x.example:8080/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::]/", "http://intranet/", "http://metadata.google.internal./", "http://router.lan/", "javascript:alert(1)"]) ok(checkTarget(bad) === null, `refuses ${bad}`);
for (const good of ["https://mangadex.org/chapter/abc", "http://raw.example.net/a", "https://x.example:443/p"]) ok(checkTarget(good) !== null, `accepts ${good}`);

// ---------- the Worker's request handling ----------
const KEY = "test-key-0123456789abcdefghij";
const env = { GYT_KEY: KEY };
const req = (path, { key = KEY, origin = "https://gywreb.github.io", method = "GET", ua = "Mozilla/5.0 (iPhone) Safari" } = {}) =>
  new Request(`https://fetcher.example.workers.dev${path}`, { method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(origin ? { Origin: origin } : {}), "User-Agent": ua } });
const site = (routes) => {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const r = routes[String(url)];
    if (!r) return new Response("nope", { status: 404 });
    const res = new Response(r.body, { status: r.status || 200, headers: r.headers || { "Content-Type": "text/html" } });
    Object.defineProperty(res, "url", { value: r.finalUrl || String(url) });
    return res;
  };
  return { f, calls };
};

{
  const r = await handle(req("/ping"), env);
  const j = await r.json();
  ok(r.status === 200 && j.ok && r.headers.get("Access-Control-Allow-Origin") === "https://gywreb.github.io", "/ping with the key: ok, CORS for the app's origin");
  ok((await handle(req("/ping", { key: "wrong-key-0123456789abcdefgh" }), env)).status === 401, "a wrong key is refused (401)");
  ok((await handle(req("/ping", { key: "short" }), { GYT_KEY: "short" })).status === 500, "a GYT_KEY shorter than 24 characters is refused (setup)");
  ok((await handle(req("/ping", { key: null }), env)).status === 401, "no key is refused (401)");
  ok((await handle(req("/ping"), {})).status === 500, "a Worker without GYT_KEY says so (500, setup)");
  const pre = await handle(req("/chapter", { method: "OPTIONS", key: null }), env);
  ok(pre.status === 204 && /Authorization/.test(pre.headers.get("Access-Control-Allow-Headers") || ""), "CORS preflight allows the Authorization header without a key");
  ok((await handle(req("/ping", { origin: "https://evil.example" }), { ...env, ALLOWED_ORIGINS: "https://gywreb.github.io" })).status === 403, "ALLOWED_ORIGINS refuses other origins");
  ok((await handle(req("/chapter?url=" + encodeURIComponent("http://169.254.169.254/latest/meta-data")), env)).status === 400, "/chapter refuses a private address (400)");
}

{
  const page = "https://scans.example.com/star-harbor-chapter-12/";
  const { f, calls } = site({ [page]: { body: fx("themesia-img.html") } });
  const r = await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f);
  const j = await r.json();
  ok(r.status === 200 && eq(j.pages, expect["themesia-img.html"].pages) && j.referer === page && j.next, "/chapter returns pages, referer and next link");
  ok(calls[0].headers["User-Agent"] === "Mozilla/5.0 (iPhone) Safari", "the page is fetched with the reader's own browser User-Agent");
}

{
  const page = "https://guarded.example/ch/1";
  const { f } = site({ [page]: { status: 403, body: fx("challenge.html"), headers: { "Content-Type": "text/html", "cf-mitigated": "challenge" } } });
  const j = await (await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f)).json();
  ok(j.error === "challenge", "a Cloudflare bot check is reported as 'challenge'", JSON.stringify(j));
  const { f: f2 } = site({ [page]: { status: 503, body: fx("challenge.html") } });
  ok((await (await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f2)).json()).error === "challenge", "…also without the cf-mitigated header (page markers)");
  const { f: f3 } = site({ [page]: { body: fx("spa-empty.html") } });
  const r3 = await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f3);
  ok(r3.status === 422 && (await r3.json()).error === "no-images", "a page with no chapter images is reported as 'no-images' (422)");
  const { f: f4 } = site({ [page]: { status: 404, body: "gone" } });
  ok((await (await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f4)).json()).error === "not-found", "a 404 is reported as 'not-found'");
}

{
  const id = "717027ec-4de7-4bd7-ba06-565caf633cbf";
  const api = `https://api.mangadex.org/at-home/server/${id}?forcePort443=true`;
  const { f, calls } = site({ [api]: { body: JSON.stringify({ baseUrl: "https://abc.mangadex.network", chapter: { hash: "h1", data: ["1-a.png", "2-b.png"] } }), headers: { "Content-Type": "application/json" } } });
  const j = await (await handle(req("/chapter?url=" + encodeURIComponent(`https://mangadex.org/chapter/${id}`)), env, f)).json();
  ok(eq(j.pages, ["https://abc.mangadex.network/data/h1/1-a.png", "https://abc.mangadex.network/data/h1/2-b.png"]) && j.method === "mangadex-api", "MangaDex chapters come from its at-home API");
  ok(/Gytakusub-fetcher/.test(calls[0].headers["User-Agent"]), "MangaDex's API gets an honest User-Agent naming the fetcher");
}

{
  const img = "https://cdn.examplecdn.net/star-harbor/12/01.jpg", ref = "https://scans.example.com/star-harbor-chapter-12/";
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const { f, calls } = site({ [img]: { body: bytes, headers: { "Content-Type": "image/jpeg", "Content-Length": "7" } } });
  const r = await handle(req(`/image?url=${encodeURIComponent(img)}&ref=${encodeURIComponent(ref)}`), env, f);
  const got = new Uint8Array(await r.arrayBuffer());
  ok(r.status === 200 && r.headers.get("Content-Type") === "image/jpeg" && eq([...got], [...bytes]) && r.headers.get("Access-Control-Allow-Origin"), "/image relays the bytes with CORS");
  ok(calls[0].headers.Referer === "https://scans.example.com/", "a cross-site image gets the page's origin as Referer (what a browser sends)");
  const same = "https://scans.example.com/wp-content/uploads/p/1.jpg";
  const { f: f2, calls: c2 } = site({ [same]: { body: bytes, headers: { "Content-Type": "image/jpeg" } } });
  await handle(req(`/image?url=${encodeURIComponent(same)}&ref=${encodeURIComponent(ref)}`), env, f2);
  ok(c2[0].headers.Referer === ref, "a same-site image gets the full page address as Referer");
  const { f: f3 } = site({ [img]: { body: "<html>Just a moment...</html>", headers: { "Content-Type": "text/html" } } });
  const j3 = await (await handle(req(`/image?url=${encodeURIComponent(img)}`), env, f3)).json();
  ok(j3.error === "challenge", "an image address answering with a bot-check page is reported as 'challenge'", JSON.stringify(j3));
  const { f: f4 } = site({ [img]: { body: "<html>login</html>", headers: { "Content-Type": "text/html" } } });
  ok((await (await handle(req(`/image?url=${encodeURIComponent(img)}`), env, f4)).json()).error === "not-image", "an image address answering with a web page is reported as 'not-image'");
  const { f: f5 } = site({ [img]: { status: 403, body: "denied", headers: { "Content-Type": "text/plain" } } });
  ok((await (await handle(req(`/image?url=${encodeURIComponent(img)}`), env, f5)).json()).error === "blocked", "a 403 from the image host is reported as 'blocked'");
}

// ---------- redirects are followed by the fetcher itself, each hop checked ----------
{
  const page = "https://short.example/c/1", final = "https://scans.example.com/star-harbor-chapter-12/";
  const routes = { [page]: { status: 301, body: "", headers: { Location: final } }, [final]: { body: fx("themesia-img.html") } };
  const { f, calls } = site(routes);
  const j = await (await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f)).json();
  ok(j.url === final && j.pages?.length === 4 && calls.every((c) => true), "a redirect is followed to the chapter, which becomes the referer", JSON.stringify(j).slice(0, 200));
  const { f: f2, calls: c2 } = site({ [page]: { status: 302, body: "", headers: { Location: "http://169.254.169.254/latest/meta-data" } } });
  const j2 = await (await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f2)).json();
  ok(j2.error === "upstream" && c2.length === 1, "a redirect to a private address is not followed", JSON.stringify(j2));
  const loop = { [page]: { status: 302, body: "", headers: { Location: page } } };
  const { f: f3, calls: c3 } = site(loop);
  await handle(req("/chapter?url=" + encodeURIComponent(page)), env, f3);
  ok(c3.length === 6, `a redirect loop stops after 5 hops (made ${c3.length} requests)`);
}

// ---------- the relay passes images only, and never more than 40 MB ----------
{
  const img = "https://cdn.examplecdn.net/x/1.jpg";
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
  const get = async (body, type, extraHeaders = {}) => {
    const { f } = site({ [img]: { body, headers: { ...(type ? { "Content-Type": type } : {}), ...extraHeaders } } });
    return handle(req(`/image?url=${encodeURIComponent(img)}`), env, f);
  };
  const r1 = await get(jpeg, "application/octet-stream");
  ok(r1.status === 200 && r1.headers.get("Content-Type") === "image/jpeg", "octet-stream holding a JPEG is relayed, labelled image/jpeg");
  ok(r1.headers.get("X-Content-Type-Options") === "nosniff" && /sandbox/.test(r1.headers.get("Content-Security-Policy") || ""), "relayed images carry nosniff and a sandboxing CSP");
  for (const [body, type, what] of [["alert(1)", "application/javascript", "a script"], ["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml", "an SVG"], ["%PDF-1.7", "application/pdf", "a PDF"], ["hello", "text/plain", "plain text"], [jpeg, "text/html", "JPEG bytes labelled as HTML"]]) {
    const r = await get(body, type);
    ok(r.status === 502 && (await r.json()).error === "not-image", `${what} is not relayed`);
  }
  ok((await get(jpeg, "image/jpeg", { "Content-Length": String(50e6) })).status === 413, "a declared 50 MB image is refused (413)");
  // 50 MB streamed with no Content-Length: the relay must stop at 40 MB
  const chunk = new Uint8Array(1 << 20); chunk.set(jpeg);
  let sent = 0;
  const big = new ReadableStream({ pull(c) { if (sent >= 50) return c.close(); c.enqueue(sent === 0 ? chunk : new Uint8Array(1 << 20)); sent++; } });
  const r2 = await get(big, "image/jpeg");
  let got = 0, threw = false;
  try { const rd = r2.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; } } catch { threw = true; }
  ok(threw && got <= 40e6 + (1 << 20), `a streamed 50 MB image without Content-Length is cut off (${(got / 1e6).toFixed(0)} MB passed)`);
  ok(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])) === "image/png" && sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")) === "image/webp", "PNG and WebP are recognised by their bytes");
}

// ---------- extraction time stays linear on hostile markup (free plan: 10 ms CPU per request) ----------
for (const [what, html] of [["100 KB of unclosed <img ", "<img ".repeat(20000)], ["100 KB of unclosed <title>", "<title>".repeat(14000)], ["100 KB of unclosed <script", "<script>".repeat(12000)], ["100 KB of unclosed <a ", "<a href=x>".repeat(10000)], ["1 MB of quotes and slashes", "'/a".repeat(330000)]]) {
  await extractChapter(html, "https://x.example/c/1");
  const t = performance.now();
  await extractChapter(html, "https://x.example/c/1");
  const ms = performance.now() - t;
  ok(ms < 40, `${what}: ${ms.toFixed(1)} ms (linear)`);
}

// ---------- the in-app setup guide stays tied to the sources the weekly guide check watches ----------
{
  const guide = JSON.parse(fs.readFileSync(new URL("../fetcher/guide-sources.json", import.meta.url), "utf8"));
  const html = fs.readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  ok(html.includes('href="https://github.com/gywreb/gytakusub"') && guide.probes.some((p) => p.url.startsWith("https://github.com/gywreb/gytakusub")), "the repository the guide tells people to fork is probed weekly");
  const toml = fs.readFileSync(new URL("../fetcher/wrangler.toml", import.meta.url), "utf8");
  const name = /^name\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  ok(name && html.includes(`<b>Project / Worker name:</b> <button type="button" class="chip" data-copy="${name}"`), `the Worker name the guide asks for is the one in wrangler.toml (${name}); Cloudflare fails the build otherwise`);
  ok(html.includes('<b>Path:</b> <button type="button" class="chip" data-copy="fetcher"'), "the guide's path (root directory) is the fetcher folder");
  const docLinks = [...html.matchAll(/href="(https:\/\/developers\.cloudflare\.com\/[^"]+)"/g)].map((m) => m[1]);
  ok(docLinks.length >= 2 && docLinks.every((u) => guide.pages.some((p) => p.url.replace(/index\.md$/, "") === u)), "every Cloudflare page the guide links to is watched by the weekly check", JSON.stringify(docLinks));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(guide.checked) && guide.pages.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.dateModified)), "the guide sources carry their check dates");
}

console.log(failures ? `FETCHER TESTS FAILED (${failures} of ${failures + passes})` : `FETCHER TESTS PASSED (${passes})`);
process.exitCode = failures ? 1 : 0;
