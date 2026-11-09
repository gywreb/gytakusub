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

Cost: nothing. The fetcher runs on Cloudflare's Workers Free plan, and no card is needed:
- **Allowance:** 100,000 requests a day for your whole Cloudflare account, counted from midnight UTC. One chapter takes about one request per page, plus one.
- **Past the allowance:** Cloudflare stops answering until the reset (its error 1027). Nothing is charged.
- **Watching it:** the chip under the chapter form and **Your fetcher** show today's count. By default that's an estimate of what this device sent. It misses your other devices and the browser's permission checks (preflights), which Cloudflare counts too.
- **Live count (optional, about 3 minutes):** add two Secrets to the Worker, and it reads today's exact count from Cloudflare's analytics (`/usage`). Every browser and the installed app then show the same number, refreshed every minute while the Chapter link tab is open.
  1. Create a token: Account API tokens → Create Token → Custom token. Give it only **Account · Account Analytics · Read**. Cloudflare shows the token once.
  2. Copy your account ID: press Ctrl/Cmd+K in the dashboard → *Copy account ID*.
  3. On the Worker: Settings → Variables and Secrets → add Secret `CF_API_TOKEN` (the token) and Secret `CF_ACCOUNT_ID` (the ID) → Deploy.

  The token can read your account's analytics and nothing else. It stays on the Worker and is never sent to the app. Use the type **Secret** for both: plain variables set in the dashboard can be replaced when the Worker redeploys. `wrangler.toml` has `keep_vars = true` as a second guard.

## Set it up

**Follow the steps in the app:** open Gytakusub → **Chapter link**. Until a fetcher is connected, that tab shows the setup instead of the chapter form. It unlocks only when the fetcher answers with your key. You need free GitHub and Cloudflare accounts, and about 10 minutes:

1. **Create your access key.** The app generates a 32-character key.
2. **Copy the fetcher to your GitHub:** on [github.com/gywreb/gytakusub](https://github.com/gywreb/gytakusub), click **Fork** → **Create fork**.
3. **Deploy it on Cloudflare:** Workers & Pages → Create application → GitHub → select your `gytakusub`. Fill in:
   - Worker name `gytakusub`. It must match `wrangler.toml`, or the build fails.
   - Path `fetcher`, under **Advanced settings**. (In the Worker's Settings → Build afterwards, the same field is called *Root directory*.)
   - Build command: empty.
   - Deploy command: `npx wrangler deploy`.

   Then **Save and Deploy**.
4. **Give it your key:** on the Worker, Settings → Variables and Secrets → Add → Secret `GYT_KEY` = your key → Deploy. Copy the Worker's `….workers.dev` address.
5. **Connect:** paste the address in the app and tap Connect.

The app's steps are the maintained version. They name the Cloudflare pages they follow and the date they were last checked against them. A weekly job (`.github/workflows/guide-check.yml`) re-reads those pages and opens an issue when one changes, so the steps get reviewed before anyone meets a changed screen. What it watches: [`guide-sources.json`](guide-sources.json).

**Other devices:** once connected, **Fetcher & other devices → Copy connection link**. Open the link on your phone and tap Connect. The link contains your key, so send it only to yourself.

**Sharing your fetcher:** someone you send your connection link to needs no GitHub or Cloudflare account. They paste it into the **Got a connection link?** box at the top of the tab. Their reading then counts against your free daily allowance.

**The key is what protects your fetcher.** Its address isn't secret: the sites it visits can see which Worker made the request.
- Anyone without the key gets "401" and nothing else.
- Anyone who knows the address can still use up the free plan's daily request allowance, which only stops your fetcher until midnight UTC.
- If the key leaks, change `GYT_KEY` on the Worker (Settings → Variables and Secrets) and connect again.

**Optional:** add a plain-text variable `ALLOWED_ORIGINS` = `https://gywreb.github.io`. Browsers on other websites then can't use your fetcher even with the key. It doesn't stop scripts outside a browser; only the key does that.

**Updating:** when the app says your fetcher is out of date, open your fork on GitHub and click **Sync fork** → **Update branch**. Cloudflare redeploys by itself within a minute.

### Without GitHub or GitLab: the command line

```sh
cd fetcher
npx wrangler login
npx wrangler secret put GYT_KEY
npx wrangler deploy
```

`deploy` prints the address to paste in step 3.

## Open a chapter from the site you're reading (iPhone Safari, any desktop browser)

Bookmark any page, then edit the bookmark and replace its address with:

```
javascript:location.href='https://gywreb.github.io/gytakusub/?chapter='+encodeURIComponent(location.href)
```

On a chapter page, open the bookmark. Gytakusub opens with that chapter filled in; tap **Load**. (Links never load by themselves, so a link someone sends you can't spend your credits.)

On iPhone, the bookmark opens Gytakusub in Safari, which keeps its own settings separate from the Home Screen app's. Enter your Claude key there once too, and connect the fetcher with your connection link.

## Errors the app may show

| Message | Meaning |
|---|---|
| "checking your browser" wall | The site sends servers a bot check. The fetcher can't pass it. |
| refuses the fetcher | HTTP 401/403: the site needs a login, or blocks servers. |
| No chapter pages were found | The page has no image list the fetcher can read: the site builds it with a script after loading, or needs a login. |
| refused the access key | The key in the app isn't the Worker's `GYT_KEY`. |
| has no key yet | The Worker has no `GYT_KEY` secret, or one under 24 characters (step 4). |
| version … needs … or newer | The fetcher is older than the app: **Sync fork** (see *Updating*). |
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
