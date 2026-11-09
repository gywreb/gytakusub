# ADR 0007: Claude usage monitor

Status: accepted (2.5.0). Date: 2026-11-10.

## Context

The user wanted to see what translating costs, for the extension and the web app, in the same spirit as the fetcher's request count (2.4.0). The ask covered both an at-a-glance number and details. It also required following industry practice and staying within Anthropic's terms.

There are three ways to know what Claude usage cost:

1. **Each API answer's `usage` object.** It reports input, output, cache-read and cache-write tokens. It is exact for that request and needs nothing extra.
2. **Anthropic's published prices** (platform.claude.com/docs/en/about-claude/pricing). Tokens × price gives an estimate. The page notes that Haiku 5.5 charges a request whose prompt is over 100,000 tokens (all input tokens, cache reads and writes included) at the higher row for the whole request.
3. **The Usage and Cost API** (Admin API). It gives exact, account-wide numbers. However, Anthropic's docs say: "The Admin API is unavailable for individual accounts." It needs an organization and an Admin API key. Anthropic advises keeping that key in a secrets manager with a dedicated key per service, an expiry and rotation. An admin key can manage the organization, so it must never sit in a browser extension or a web page.

Anthropic also returns `anthropic-ratelimit-*` headers (requests, input and output tokens: limit, remaining, reset) and documents two spending stops:
- the tier's monthly spend cap: HTTP 429, `error.details.error_code` `enforced_spend_limit_reached`, paused until 00:00 UTC on the 1st;
- a self-set spend limit: HTTP 400.

## Decision

**Local log, both surfaces.** `extension/usage.js` is shared with the web app like `prompt.js`. It records every Claude answer's model and token usage per UTC day, keeps 62 days, and estimates the cost from a dated price list.
- **Extension:** the service worker is the only writer, to `chrome.storage.local`, with writes queued. The popup shows "≈$… today" next to the model. Options has a **Claude usage** section.
- **Web app:** `localStorage` (`web/claude-usage.js`). Settings has a **Claude usage** group, and the toolbar shows today's cost while translating. An installed app on a computer shares the browser's storage. On iPhone a Home Screen app keeps its own log.
- **What's shown:**
  - today and this month;
  - one row per model;
  - rate-limit headroom from the last answer, when readable and under five minutes old;
  - where the exact bill is (Console Usage and Cost pages);
  - when days start in the reader's time;
  - a Clear button.
- **Honest numbers:**
  - costs are marked ≈;
  - a model missing from the price list shows "price unknown" rather than a guess;
  - the panel says which surface's records it shows.
- **Prices stay current.** Each price row names the pricing page's row it comes from (`PRICES`, `PRICES_CHECKED`). The weekly check (`scripts/check-guide.mjs` → `scripts/price-check.mjs`) fetches the page's Markdown and opens an issue when a row is gone or a number changed. A unit test pins the parser on the page's row format.
- **Errors say what they mean:**
  - spend cap: explained;
  - spend limit, low credit balance, bad key, overload: explained when the API's message matches;
  - a passing rate limit: explained, and retried once by the extension;
  - the spend cap is not retried.

**Not done: exact account-wide usage.** It needs the Admin API: an organization account and an admin key. If the user has or creates an organization, the fetcher can hold the key as a Worker secret and report the numbers, as it does for Cloudflare's count. The key would never reach the app or the extension. That waits for the user's decision, because it means turning an individual account into an organization and storing a powerful key.

## Legal and privacy

- **Documented sources only:** the Messages API's own `usage` and headers, and Anthropic's public pricing page. The app doesn't scrape the Console or use undocumented endpoints.
- **Nothing leaves the device.** The privacy policy lists the usage figures, how long they are kept and how to clear them. The Chrome Web Store `storage` justification mentions the log.
  - The figures are derived from the user's own API answers, kept locally and never transmitted. Our reading is that this is not "collected" user data for the store's disclosure boxes. That is our reading, not legal advice.
- **The cost is an estimate:** labelled as such, with the source and the date it was checked, and the Console named as the bill.
