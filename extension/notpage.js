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
  root.GyNotPage = { notPage };
})(typeof globalThis !== "undefined" ? globalThis : this);
