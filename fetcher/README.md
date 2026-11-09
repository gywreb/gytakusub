# Chapter fetcher

The web app's **Chapter link** mode needs this small server. A web page — like the Gytakusub web app on github.io — may not read another site's pages or images unless that site allows it, and manga sites don't. (MangaDex's API documentation says so directly: a website that shows its chapters to users must proxy the images through its own server.) A server may read them, so you run this one on your own free Cloudflare account. It:

- opens the chapter page you paste,
- finds the chapter's page images (and the next/previous chapter links),
- relays the images to the app.

It stores nothing. Your Claude API key never passes through it.

**What it handles:** sites that need no login, built on the common reader themes (MangaThemesia, Madara, MangaBox, FoOlSlide, Blogger-hosted scans), other sites that put the pages in their HTML or in a script on the page, and MangaDex through its API.

**What it can't handle:**
- Sites that show servers a "checking your browser" page (Cloudflare or DDoS-Guard bot checks).
- Sites that need a login.
- Sites that load their pages with a script after the page opens.

The app tells you when that's the case. For those sites use screenshot mode, or the browser extension on a computer.

Cost: the Workers free plan (100,000 requests a day; one chapter is about one request per page plus one). No card needed.

## Set it up in the browser (about 10 minutes, no tools)

1. Create a free account at https://dash.cloudflare.com/sign-up and verify your email.
2. In the dashboard, open **Workers & Pages** → **Create** → **Start with Hello World** (or *Create Worker*). Name it `gytakusub` → **Deploy**.
   The first time, Cloudflare asks you to pick a `workers.dev` subdomain; any name works.
3. On the Worker's page, open **Edit code**:
   1. Delete everything in the editor.
   2. Paste the whole of [`worker.js`](https://raw.githubusercontent.com/gywreb/gytakusub/main/fetcher/worker.js) (open the link, select all, copy).
   3. Click **Deploy**.
4. Go back to the Worker → **Settings** → **Variables and Secrets** → **Add**:
   1. Type: **Secret**.
   2. Name: `GYT_KEY`.
   3. Value: a random password of at least 24 characters (a password manager can generate one). The Worker refuses shorter keys.
   4. Click **Deploy** (or **Save**).
5. Copy the Worker's address from its overview page, for example `https://gytakusub.your-name.workers.dev`.
6. In Gytakusub (web app) → ⚙ Settings → **Chapter fetcher**:
   1. Paste the address and the same `GYT_KEY` value.
   2. Click **Test fetcher**. It should say *Fetcher works (version 2.1.0)*.
   3. Click **Save**.

Then open **Chapter link**, paste a chapter's address, and **Load**. Pages translate as you scroll; **Next chapter ›** at the bottom opens the next one, keeping the names and recent lines for consistency.

**The key is what protects your fetcher.** Its address isn't secret: the sites it visits can see which Worker made the request.
- Anyone without the key gets "401" and nothing else.
- Anyone who knows the address can still use up the free plan's daily request allowance, which only stops your fetcher until midnight UTC.
- If the key leaks, change `GYT_KEY` on the Worker and in the app.

**Optional:** add a plain-text variable `ALLOWED_ORIGINS` = `https://gywreb.github.io`. Browsers on other websites then can't use your fetcher even with the key. It doesn't stop scripts outside a browser; only the key does that.

**Updating:** when a new version of `worker.js` is released, repeat step 3. Your key stays.

## Or with the command line

```sh
cd fetcher
npx wrangler login
npx wrangler secret put GYT_KEY
npx wrangler deploy
```

## Open a chapter from the site you're reading (iPhone Safari, any desktop browser)

Bookmark any page, then edit the bookmark and replace its address with:

```
javascript:location.href='https://gywreb.github.io/gytakusub/?chapter='+encodeURIComponent(location.href)
```

On a chapter page, open the bookmark. Gytakusub opens with that chapter filled in; tap **Load**. (Links never load by themselves, so a link someone sends you can't spend your credits.)

On iPhone, the bookmark opens Gytakusub in Safari, which keeps its own settings separate from the Home Screen app's. Enter your Claude key and fetcher there once too.

## Errors the app may show

| Message | Meaning |
|---|---|
| "checking your browser" wall | The site sends servers a bot check. The fetcher can't pass it. |
| refuses the fetcher | HTTP 401/403: the site needs a login, or blocks servers. |
| No chapter pages were found | The page has no image list the fetcher can read: the site builds it with a script after loading, or needs a login. |
| refused the access key | The key in the app differs from the Worker's `GYT_KEY`. |
| No answer from your fetcher | If **Test fetcher** also fails: the address is wrong, or the Worker isn't deployed. If the test works: the fetcher stopped on this page. The free plan allows 10 ms of work per request, and a page of several hundred KB with thousands of images can exceed it. |

## How it finds the pages

`worker.js` reads the chapter page as text. It does not run the site's scripts. It collects every image address on the page:

- from `<img>` tags, including the lazy-loading attributes reader themes use (`data-src`, `data-lazy-src`, `data-original`, `srcset` …);
- from scripts: reader JSON such as `ts_reader.run({...})`, Next.js data, and `var pages = [...]`, including scripts hidden as base64;
- from Madara's encrypted "chapter protector", which it decrypts because the key is on the same page.

Then it keeps the largest group of images that share a site and folder, which is the chapter's pages. That drops logos, avatars, ads, thumbnails of other series and covers.

The rules for where each theme puts its pages come from the open-source Mihon/Tachiyomi source parsers (keiyoushi/extensions-source). `tests/fetcher.test.mjs` checks the extraction on one page per theme, the Worker's key, CORS, address and redirect checks, error reporting and image relay, and that extraction time stays linear on hostile markup.

### What it sends to the sites

The requests come from Cloudflare's network, not your device. Cloudflare adds a header identifying the Worker's account zone.

- **Chapter page:** fetched with your browser's User-Agent and language.
- **Images:** fetched with the chapter site as Referer, as your browser would send it.
- **MangaDex:** its API gets a User-Agent that names the fetcher.

### What it refuses

- Addresses: IP addresses, local and internal names, non-default ports, URLs with a user name or password.
- Redirects: it follows them itself, up to 5, and checks every hop the same way.
- Anything that isn't a JPEG, PNG, GIF, WebP or AVIF image. Images are recognised by their bytes and served with `nosniff` and a sandboxing CSP.
- Images over 40 MB, including ones streamed without a declared size.
- HTML beyond the first 2 MB of a page.

It writes no logs itself. If Workers Logs is turned on for the Worker in your Cloudflare account, Cloudflare keeps request details there, including chapter addresses, for a few days.
