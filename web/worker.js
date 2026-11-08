// Optional Cloudflare Worker: CORS image proxy for Gytakusub Web.
// Only needed if a manga site's image CDN refuses cross-origin reads.
// Deploy: dash.cloudflare.com → Workers → Create → paste this → Deploy.
// Then in Gytakusub Settings set "Image proxy" to  https://<name>.<you>.workers.dev/?url=
//
// It proxies images only, from an allowlist of hosts, and never sees your API key.

const ALLOW = [/(^|\.)mangadex\.(org|network)$/i];

export default {
  async fetch(req) {
    const target = new URL(req.url).searchParams.get("url");
    if (!target) return new Response("missing ?url=", { status: 400 });
    let u;
    try { u = new URL(target); } catch { return new Response("bad url", { status: 400 }); }
    if (!ALLOW.some((re) => re.test(u.hostname))) return new Response("host not allowed", { status: 403 });
    const upstream = await fetch(u.toString(), { headers: { Referer: "https://mangadex.org/", "User-Agent": "Gytakusub/1.0" }, cf: { cacheEverything: true, cacheTtl: 86400 } });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.startsWith("image/")) return new Response("upstream error", { status: 502 });
    return new Response(upstream.body, {
      headers: { "content-type": type, "access-control-allow-origin": "*", "cache-control": "public, max-age=86400" },
    });
  },
};
