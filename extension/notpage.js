// Images on a chapter's page that are not its pages, judged by their address: a cover, a
// thumbnail, a logo, an ad. The same rule as the chapter fetcher's (fetcher/worker.js isJunk),
// which the web app's chapter mode uses; tests/notpage.test.mjs keeps the two the same. Judged by
// file name and by whole folder names only, so a series called "Ad Astra" or "Avatar" keeps its
// pages. A page given as blob: or data: (a reader that decodes its own pages) is never judged.
// Loaded before content.js (settings.js CS_FILES).
(function (root) {
  const JUNK_FILE = /(?:^|[_.\-])(?:logo|avatar|icon|favicon|banner|ads?|advert|sponsor|emoji|emoticon|gravatar|placeholder|loading|loader|spinner|thumb|thumbs|thumbnail|cover|poster|button|badge|sprite|discord|patreon|ko-?fi|paypal|facebook|twitter|reddit)(?=[_.\-]|\d|$)|-\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp|avif)$/i;
  const JUNK_DIR = /^(?:themes|plugins|emoji|emojis|avatars?|logos?|ads|banners?|icons?|thumbs?|thumbnails?|covers?|posters?|smilies|gravatar)$/i;
  const JUNK_HOST = /(?:^|\.)(?:gravatar\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com)$/i;
  const URL_PARTS = /^https?:\/\/([^/?#]+)([^?#]*)/i;
  function isJunk(host, path) {
    const segs = path.split("/").filter(Boolean).map((x) => { if (!x.includes("%")) return x; try { return decodeURIComponent(x); } catch { return x; } });
    const file = segs.pop() || "";
    return JUNK_HOST.test(host) || JUNK_FILE.test(file) || segs.some((d) => JUNK_DIR.test(d));
  }
  /** True when the image at `src` is a cover, a thumbnail, a logo or the like, not a page. */
  function notPage(src) {
    const m = URL_PARTS.exec(String(src || ""));
    return !!m && isJunk(m[1], m[2]);
  }
  // A chapter's pages come from one site and folder: the chapter fetcher (fetcher/worker.js
  // pickPages) keeps the largest such group. Here the rule is narrower, as a reader may show two
  // chapters at once (one still loading): of the page-sized images on the page, one alone in its
  // site and folder is not a page while three or more share one. Naver's end-of-episode ad, from
  // its ad server beside the episode's 121 images, was translated as a page (2.15). Sites that give
  // each page its own folder (Blogger, some CDNs) are grouped by site and their first two folders
  // instead, as the fetcher does. Pages given as blob: or data: are never judged.
  const site = (host) => host.toLowerCase().replace(/:\d+$/, "").split(".").slice(-2).join(".");
  const fine = (host, path) => site(host) + path.replace(/[^/]*$/, "");
  const coarse = (host, path) => site(host) + "/" + path.split("/").slice(1, 3).join("/");
  /** Of these image addresses (the page-sized images on a page), the ones that stand alone beside a chapter: a Set. */
  function strays(srcs) {
    const list = [];
    for (const src of new Set(srcs)) { const m = URL_PARTS.exec(String(src || "")); if (m) list.push({ src, host: m[1], path: m[2] || "/" }); }
    for (const key of [fine, coarse]) {
      const count = new Map();
      for (const x of list) { const k = key(x.host, x.path); count.set(k, (count.get(k) || 0) + 1); }
      if (Math.max(0, ...count.values()) >= 3) return new Set(list.filter((x) => count.get(key(x.host, x.path)) === 1).map((x) => x.src));
    }
    return new Set();
  }
  root.GyNotPage = { notPage, strays };
})(typeof globalThis !== "undefined" ? globalThis : this);
