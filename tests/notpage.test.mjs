// extension/notpage.js: images that are covers, thumbnails or logos are not pages, by the same rule
// as the chapter fetcher (fetcher/worker.js), which the web app's chapter mode uses.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ctx = { globalThis: {} };
vm.runInNewContext(read("../extension/notpage.js"), ctx);
const { notPage } = ctx.globalThis.GyNotPage;
let checks = 0;
const is = (src, want) => { assert.equal(notPage(src), want, src); checks++; };

// the two copies of the rule are the same
const rules = (code) => ["JUNK_FILE", "JUNK_DIR", "JUNK_HOST", "URL_PARTS"].map((k) => code.match(new RegExp(`const ${k} = (/.*/[a-z]*);`))?.[1]);
const ours = rules(read("../extension/notpage.js")), fetcher = rules(read("../fetcher/worker.js"));
assert.ok(ours.every(Boolean), "notpage.js names its rules");
assert.deepEqual(ours, fetcher, "notpage.js has the fetcher's rule");
checks++;

// a MangaDex chapter's end showed the series' covers, translated as pages (2.14.2)
is("https://mangadex.org/covers/327fd7d1-47d6-4df4-979d-20bfb8899cf2/72e5e.jpg.512.jpg", true);
is("https://example.org/wp-content/uploads/2024/05/thumbnail-12.jpg", true);
is("https://cdn.site.com/series/one/chapter-3/logo.png", true);
is("https://example.org/uploads/page-300x400.jpg", true); // a resized copy (WordPress)
// pages
is("blob:https://mangadex.org/f29ad846-0017-4094-a87a-bfe74b78706a", false);
is("data:image/png;base64,iVBORw0KGgo=", false);
is("https://cdn.site.com/series/ad-astra/chapter-3/01.jpg", false); // a series named "Ad Astra"
is("https://cdn.site.com/manga/avatar-the-last/12/003.webp", false);
is("https://uploads.mangadex.org/data/abc123/1-0123456789abcdef.png", false);
// an image alone in its site and folder beside a chapter's pages is not a page (Naver's
// end-of-episode ad, 2.15); two chapters at once, and folders of fewer than three, are left alone
const { strays } = ctx.globalThis.GyNotPage;
const strayIs = (srcs, want, why) => { assert.deepEqual([...strays(srcs)].sort(), [...want].sort(), why); checks++; };
const episode = Array.from({ length: 6 }, (_, i) => `https://image-comic.pstatic.net/webtoon/773797/279/2026_IMAG01_${i + 1}.jpg`);
strayIs([...episode, "https://ssl.pstatic.net/melona/libs/1583/1583185/20d37c54548a.jpg"], ["https://ssl.pstatic.net/melona/libs/1583/1583185/20d37c54548a.jpg"], "the ad beside the episode");
strayIs(episode, [], "the episode alone");
strayIs(episode.map((u) => u.replace("image-comic", "image-comic2")), [], "pages from two hosts of one site are one group");
strayIs([...episode.slice(0, 3), ...episode.slice(0, 3).map((u) => u.replace("/279/", "/280/"))], [], "two chapters at once");
strayIs(["https://x.org/a/1.jpg", "https://ads.example.net/b/2.jpg"], [], "no chapter: nothing judged");
strayIs(["https://x.org/a/1.jpg", "https://x.org/a/2.jpg", "https://ads.example.net/b/2.jpg"], [], "fewer than three pages: nothing judged");
// one folder per page (Blogger): grouped by site and the first two folders
const blogger = Array.from({ length: 4 }, (_, i) => `https://blogger.googleusercontent.com/img/b/R29v${i}/s1600/${i + 1}.jpg`);
strayIs([...blogger, "https://cdn.other.com/promo/next.jpg"], ["https://cdn.other.com/promo/next.jpg"], "a promo beside per-page folders");
strayIs([...blogger, "blob:https://x.org/1"], [], "blob: is never judged");
console.log(`notpage: ${checks} checks passed`);
