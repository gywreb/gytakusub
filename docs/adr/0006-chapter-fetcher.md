# ADR 0006 — Chapter links through a fetcher on the user's own Cloudflare account

Status: accepted (2.1.0, web app). Date: 2026-11-09.

## Context

The web app's "Chapter link" mode took a MangaDex link only, through
`web/sources.js`, and even that failed. MangaDex's API answered **403** to the
app on gywreb.github.io. MangaDex's API documentation states the rule
directly: its CORS policy does not allow hotlinking, and a site that shows its
chapters to users must proxy them through its own server.

The owner asked for chapter links to be "universal and robust for every manga
site that doesn't require login."

The constraint is the browser, not MangaDex. A page on one origin may not read
another origin's HTML or image pixels unless that origin sends CORS headers.
Manga sites don't send them. No code in a static web app can get around this.

The desktop extension isn't affected: its host permissions let its service
worker read any site. A universal web app therefore needs a server to read the
chapter for it.

## Options considered

1. **Per-site adapters calling site APIs from the browser** (the old
   `sources.js`). Blocked by the same CORS rule; it fails on MangaDex today.
2. **A bookmarklet that runs on the manga page.** It can read the page's image
   addresses, but not their pixels: cross-origin images taint a canvas, and
   most manga CDNs send no CORS headers. It works only where the CDN allows
   CORS, a minority of sites.
3. **A public proxy run by the developer.** It would put the developer between
   every reader and every site, which is an open proxy to abuse and pay for. It
   also contradicts the project's position that it hosts and relays nothing.
4. **A headless browser on a server** (Cloudflare Browser Rendering, a VPS with
   Playwright). It runs JS-built readers, but costs money every month and still
   meets the same bot checks.
5. **A small fetcher the user deploys on their own free Cloudflare account**
   (chosen). The owner chose it when asked, with options 2 and "use the
   extension in Orion on iPhone" offered as the alternatives.

## Decision

`fetcher/worker.js` is a single-file Cloudflare Worker with no dependencies, so
it can be pasted into the dashboard. The user deploys it and gives it an access
key (the `GYT_KEY` secret). It has three endpoints:

- `/chapter?url=` fetches the chapter page and extracts the page images, plus
  the next and previous chapter links.
- `/image?url=&ref=` relays one image with the chapter site as Referer.
- `/ping` checks the address and the key.

MangaDex is read through its at-home API, as its documentation prescribes.

### Extraction

It's generic, not per site. Every image address on the page is collected:

- from `<img>` tags, with the lazy-loading attributes reader themes use;
- from scripts, including JSON, Next.js payloads and base64 `data:` scripts;
- from Madara's encrypted chapter protector, decrypted with the key that sits
  on the same page.

The chapter is the largest group of addresses that share a site and folder.
When every image sits in its own folder (Blogger), the grouping uses the first
two path segments instead. File-name and folder-name rules drop logos,
avatars, ads, WordPress thumbnails and covers.

The rules for where themes put their pages come from the Mihon/Tachiyomi
open-source parsers (keiyoushi/extensions-source, `lib-multisrc`):

- MangaThemesia: `#readerarea img`, or the `images` list in `ts_reader.run`
  (sometimes base64-hidden).
- Madara: `div.page-break img`, its lazy attributes and the protector.
- MangaBox: `.container-chapter-reader img`.
- FoOlSlide: `var pages = [...]`.
- ZeistManga/Blogger: per-image folders.

### Behaviour towards sites

The fetcher behaves like the reader's browser:

- It sends the browser's own User-Agent and Accept-Language.
- Images get the strict-origin-when-cross-origin Referer: the page origin for a
  cross-site CDN, the full page URL for a same-site image.
- MangaDex's API gets an honest User-Agent naming the fetcher.

It doesn't solve bot checks and doesn't log in. Bot checks, logins and
script-built readers come back to the app as typed errors (`challenge`,
`blocked`, `no-images`), and the app explains what to do instead: screenshot
mode, or the extension.

### Safety

An independent security review of the first build found no critical issue and
two medium ones. Both were fixed before release, with tests:

1. The relay passed any file type, and its size cap trusted Content-Length.
2. Some tag patterns took quadratic time on unclosed tags.

The fetcher now behaves as follows.

- **Key:** every endpoint needs it, as a bearer token compared in constant
  time, at least 24 characters. The Worker's address is not secret; the key
  is.
- **CORS:** it reflects the requesting origin. The optional `ALLOWED_ORIGINS`
  stops other websites' pages from using it, though not scripts outside a
  browser.
- **Addresses:** it refuses IP literals, single-label and local/internal names
  (trailing dots stripped), non-default ports and credentials in URLs.
  Workers can't reach private networks anyway; this is defence in depth.
- **Redirects:** it follows them manually, at most 5, checking each hop like
  the first.
- **Image relay:**
  - It passes only JPEG, PNG, GIF, WebP and AVIF. The type is decided by the
    first bytes, which allows CDNs that label images `octet-stream`.
  - It serves them with `X-Content-Type-Options: nosniff` and
    `Content-Security-Policy: default-src 'none'; sandbox`.
  - The 40 MB cap is counted on the stream, so a missing Content-Length
    doesn't lift it.
  - Only 2xx responses are edge-cached (one day, in the user's account).
- **HTML:** it reads at most 2 MB of a page. Tag scanning is linear: tag
  patterns can't cross `<`, closing tags are found with `indexOf`, and links
  are paired with their `</a>` in one pass. Base64 scripts over 300 KB are
  skipped.
- **Shared links:** `?chapter=` links fill in the address but wait for a tap
  on *Load*. A link from someone else can't make the fetcher visit a site, or
  spend Claude credits, by itself.
- **Storage:** it keeps nothing and logs nothing itself. Workers Logs, if the
  user turns them on, live in their account.

**Not addressed (existing pattern):** the web app keeps both keys (Claude and
fetcher) in localStorage on `gywreb.github.io`, an origin shared by every
GitHub Pages project of that account, and has no CSP. A custom domain for the
app would isolate it.

## Evidence

`tests/fetcher.test.mjs` (89 checks) covers:

- the exact pages and next/previous links on one fixture per theme family,
  plus a Next.js payload and a page with nothing to extract;
- a Madara protector page encrypted with Node's crypto;
- MD5 checked against Node's;
- 19 address forms it must refuse;
- the key rules (wrong, missing, too short), the preflight and origin rules;
- redirects: followed, to a private address, a loop;
- bot-check detection, with and without the `cf-mitigated` header;
- the image relay:
  - byte sniffing and headers;
  - refusal of scripts, SVG, PDF, text, and image bytes labelled HTML;
  - the size cap, declared and streamed;
- linear time on 100 KB of unclosed `<img`, `<title>`, `<script`, `<a`, and
  1 MB of quotes (each under 4 ms).

`tests/browser/web.mjs` runs the real Worker handler behind a local port with
the web mocked:

- A `?chapter=` link fills in the address and waits.
- *Load* opens the chapter; its pages arrive through the relay, with the
  chapter site as Referer, and translate.
- *Next chapter* opens the next one.
- A bot-check site gets the explanation.
- A wrong key gets 401.

**Speed** (Node, warm; the free plan allows 10 ms of CPU per request, and
waiting on the network doesn't count):

| Page | Extraction time |
|---|---|
| Typical chapter, 60 KB | 1.5 ms |
| 550 KB with 3,000 related links and thumbnails | 8.8 ms |
| 550 KB with 4,000 page images (reviewer's probe) | 22 ms |

A page like the last one would fail with Cloudflare's error 1102 on the free
plan. The app then says the fetcher stopped on that page.

**What isn't measured:** no live site was fetched from the build environment,
whose network reaches only package registries and GitHub. The fixtures follow
the documented theme markup, not saved copies of real pages. Live coverage is
verified once the owner's Worker is deployed, starting with the two sites he
reads (MangaDex and a MangaThemesia raw site).

## Setup and keeping it current (added the same day, at the owner's request)

The owner asked for the setup guide to live inside the feature, for the
feature to stay locked until everything is in place, and for the guide not to
go out of date.

**Gate.** The Chapter link tab shows the setup steps until *Connect*
succeeds:

- `/ping` must answer with the user's key, and with a version at least that
  of the `fetcher/worker.js` the app was built with.
- The app stores a SHA-256 signature of address and key with the version it
  saw.
- The chapter form appears only while that signature matches.
- A 401, a setup error or an outdated fetcher during reading sends the user
  back to the steps, with the reason.

**Deploy path.** The first version of this guide used Cloudflare's *Deploy to
Cloudflare* button. The docs (updated 12 Oct 2026) say the button clones the
source into a new repository on the user's account. When the owner tried it
on 2026-11-09, the screen instead required choosing an *existing* repository
in his GitHub account, which a new user doesn't have. The guide was rewritten
around the route Cloudflare documents for existing repositories (Workers
Builds, docs updated 28 Oct and 8 Nov 2026):

1. Fork `gywreb/gytakusub`.
2. Workers & Pages → Create application → GitHub → select the fork.
3. Worker name `gytakusub`: Cloudflare fails the build unless it matches
   `name` in the root directory's `wrangler.toml`. A test keeps the guide and
   `wrangler.toml` in step.
4. Root directory `fetcher`; build command empty; deploy command
   `npx wrangler deploy`.
5. Add the Secret `GYT_KEY` (this route doesn't prompt for it), then Connect.

**Presentation:** the usual onboarding pattern.
- One step open at a time (*Step N of 6*, Back and Next), and the current step is remembered across the trips to GitHub and Cloudflare.
- The accounts needed come first, with sign-up links.
- Every value to type is a tap-to-copy chip.
- The likely failure (a wrong Worker name or root directory) gets a fix-it line.
- Connect validates the whole chain at the end.

**Updates:** GitHub's *Sync fork*; Workers Builds redeploys on the push. The
dashboard-paste route remains out, since current docs don't describe it.

**People given access** don't touch either service. The tab's first box takes
a pasted connection link. Pasting matters on iPhone, where a link opened in
Safari doesn't reach the Home Screen app's storage.

**Staying current.**

- The guide names the Cloudflare pages it follows and the date it was last
  checked against them (`fetcher/guide-sources.json`, shown in step 2).
- `guide-check.yml` runs weekly. It reads each page's `dateModified`, probes
  the Deploy link and MangaDex's at-home API, and opens or updates one issue
  when anything changed or broke.
- `tests/fetcher.test.mjs` fails in three cases:
  - the app links to a Cloudflare page the check doesn't watch;
  - the guide's Worker name differs from `wrangler.toml`;
  - the root directory isn't `fetcher`.

What this can't do: notice a change in the deploy screens that Cloudflare
makes without updating those pages. The check date shown in the app and
Cloudflare's own help links are the fallback for that.

## Consequences

- Chapter links need about 10 minutes of setup once (GitHub and Cloudflare
  accounts), or a connection link from someone who has a fetcher. Updating is
  *Sync fork* on GitHub; the app says when it is needed.
- **Not covered:**
  - sites behind Cloudflare or DDoS-Guard bot checks (common on large
    aggregators);
  - logins;
  - readers that fetch their page list with a script after load, or encrypt
    or scramble images (official publisher readers).

  Screenshot mode and the desktop extension remain the paths for those.
- A site-specific adapter can be added to the Worker the way MangaDex is, when
  a site the owner reads needs one.
- The extension is unchanged, so no store update.
