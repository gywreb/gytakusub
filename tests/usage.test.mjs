// Claude usage accounting (extension/usage.js, shared with the web app): prices, costs,
// the day-by-day log, rate-limit headers, and what API errors mean for the reader.
import fs from "node:fs";
import { loadLocale } from "../extension/i18n.js";
await loadLocale("en", async (p) => JSON.parse(fs.readFileSync(new URL(`../extension/${p}`, import.meta.url), "utf8")));
import { PRICES, priceOf, tokensOf, costOf, limitsOf, addCall, totals, summary, modelKey, emptyLog, utcDay, KEEP_DAYS, fmtUsd, fmtTokens, explainApiError, limitWords, addPage, usageView } from "../extension/usage.js";

let passes = 0, failures = 0;
const ok = (cond, name, extra = "") => { if (cond) { passes++; console.log("ok -", name); } else { failures++; console.log("not ok -", name, extra); } };
const near = (a, b) => Math.abs(a - b) < 1e-12;

// ---- prices: Anthropic's pricing page, 2026-11-10 (USD per million tokens) ----
ok(near(costOf("claude-sonnet-5-5", { input_tokens: 1e6 }), 2) && near(costOf("claude-sonnet-5-5", { output_tokens: 1e6 }), 10), "Sonnet 5.5: $2 in, $10 out");
ok(near(costOf("claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e6 }), 24), "Opus 5.5: $4 in + $20 out");
ok(near(costOf("claude-haiku-5-5", { input_tokens: 1e5, output_tokens: 1e6 }), 0.01 + 0.5), "Haiku 5.5 up to 100,000 prompt tokens: $0.10 in, $0.50 out");
ok(near(costOf("claude-haiku-5-5", { input_tokens: 100_001 }), 100_001 * 0.50 / 1e6), "Haiku 5.5 over 100,000 prompt tokens: the higher row for the whole request");
ok(near(costOf("claude-haiku-5-5", { input_tokens: 60_000, cache_read_input_tokens: 50_000 }), (60_000 * 0.5 + 50_000 * 0.05) / 1e6), "Haiku 5.5: cache reads count toward the 100,000-token prompt");
ok(near(costOf("claude-sonnet-5-5", { cache_read_input_tokens: 1e6 }), 0.10) && near(costOf("claude-opus-5-5", { cache_read_input_tokens: 1e6 }), 0.20), "cache hits: Sonnet $0.10, Opus $0.20");
ok(near(costOf("claude-sonnet-5-5", { cache_creation_input_tokens: 1e6 }), 2.5), "cache writes without the split: priced as 5-minute writes");
ok(near(costOf("claude-opus-5-5", { cache_creation_input_tokens: 2e6, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } }), 5 + 8), "cache writes with the split: 5 min $5, 1 h $8 on Opus");
ok(costOf("claude-future-9", { input_tokens: 10 }) === null, "a model missing from the price list has no cost (shown as unknown, never guessed)");
ok(priceOf("claude-sonnet-5-5-20261020") === PRICES["claude-sonnet-5-5"] && modelKey("claude-sonnet-5-5-20261020") === "claude-sonnet-5-5", "a dated model id uses its alias's price and groups with it");
ok(Object.values(PRICES).every((p) => p.tiers.every((t) => typeof t.row === "string" && t.row.startsWith(p.label))), "every price row names the pricing page's row it comes from (the weekly check compares them)");

// ---- tokens ----
const tk = tokensOf({ input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, cache_creation: { ephemeral_1h_input_tokens: 1 } });
ok(tk.input === 5 && tk.output === 7 && tk.read === 3 && tk.write5m === 3 && tk.write1h === 1, "tokensOf: the 5-minute share is what is not 1-hour", JSON.stringify(tk));

// ---- the log ----
const t0 = Date.parse("2026-11-10T03:00:00Z");
let log = emptyLog();
log = addCall(log, { model: "claude-sonnet-5-5", usage: { input_tokens: 1000, output_tokens: 200 }, at: t0 });
log = addCall(log, { model: "claude-sonnet-5-5-20261020", usage: { input_tokens: 1000, output_tokens: 200 }, at: t0 + 1000 });
log = addCall(log, { model: "claude-haiku-5-5", usage: { input_tokens: 2000, output_tokens: 100 }, at: t0 + 2000 });
log = addCall(log, { model: "claude-future-9", usage: { input_tokens: 10, output_tokens: 1 }, at: t0 + 3000 });
const s = summary(log, t0 + 4000);
ok(s.today.requests === 4 && near(s.today.cost, 0.004 + 0.004 + 0.00025), "summary: today's requests and cost", JSON.stringify(s.today));
ok(s.today.models[0].model === "claude-sonnet-5-5" && s.today.models[0].requests === 2, "a dated id and its alias are one row, the costliest first");
ok(s.today.unpriced === 1 && s.today.models.find((m) => m.model === "claude-future-9").cost === 0, "an unpriced model's request is counted, its cost marked unknown");
ok(s.month.requests === 4, "summary: this month includes today");
const nextDay = addCall(log, { model: "claude-sonnet-5-5", usage: { input_tokens: 1 }, at: Date.parse("2026-11-11T00:00:01Z") });
ok(summary(nextDay, Date.parse("2026-11-11T01:00:00Z")).today.requests === 1 && summary(nextDay, Date.parse("2026-11-11T01:00:00Z")).month.requests === 5, "a new UTC day starts at 00:00 UTC; the month keeps adding up");
const nextMonth = Date.parse("2026-12-01T00:30:00Z");
ok(summary(nextDay, nextMonth).month.requests === 0, "a new month starts empty");
let old = emptyLog();
old = addCall(old, { model: "claude-sonnet-5-5", usage: { input_tokens: 1 }, at: t0 - (KEEP_DAYS + 5) * 864e5 });
old = addCall(old, { model: "claude-sonnet-5-5", usage: { input_tokens: 1 }, at: t0 });
ok(Object.keys(old.days).length === 1 && old.days[utcDay(t0)], `days older than ${KEEP_DAYS} are dropped`);
ok(log.days[utcDay(t0)] && !emptyLog().days[utcDay(t0)], "addCall returns a new log (pure)");

// ---- rate limits ----
const h = new Headers({ "anthropic-ratelimit-requests-limit": "50", "anthropic-ratelimit-requests-remaining": "49", "anthropic-ratelimit-requests-reset": "2026-11-10T03:01:00Z", "anthropic-ratelimit-output-tokens-limit": "8000", "anthropic-ratelimit-output-tokens-remaining": "7000" });
const l = limitsOf(h);
ok(l.requests.limit === 50 && l.requests.remaining === 49 && l.outputTokens.remaining === 7000 && l.inputTokens === null, "limitsOf: reads the headers that are there");
ok(limitsOf(new Headers()) === null && limitsOf(null) === null, "limitsOf: nothing readable is null (a browser may hide them)");
const withLimits = addCall(emptyLog(), { model: "claude-sonnet-5-5", usage: {}, limits: l, at: t0 });
ok(summary(withLimits, t0 + 60e3).limits?.requests.remaining === 49 && summary(withLimits, t0 + 6 * 60e3).limits === null, "rate-limit headroom is shown for five minutes, then it says nothing about now");

{
  const lw = limitWords({ at: Date.parse("2026-11-10T03:00:00Z"), requests: { limit: 50, remaining: 47, reset: "2026-11-10T03:00:40Z" }, inputTokens: { limit: 40000, remaining: 36000, reset: "2026-11-10T03:00:50Z" }, outputTokens: null }, (t) => new Date(t).toISOString().slice(11, 19));
  ok(lw === "Speed limit (a minute's worth, refilling as you go): 47 of 50 requests, 36k of 40k input tokens left at 03:00:00. It's full again by 03:00:50.", "limitWords: the per-minute limit in plain words", lw);
  ok(limitWords(null) === "", "limitWords: nothing known, nothing said");
}

// ---- words ----
ok(fmtUsd(0) === "$0" && fmtUsd(0.0042) === "$0.0042" && fmtUsd(0.123) === "$0.12" && fmtUsd(3.4) === "$3.40" && fmtUsd(100) === "$100", "fmtUsd: small amounts keep two significant digits; whole dollars stay whole");
ok(fmtTokens(950) === "950" && fmtTokens(1234) === "1.2k" && fmtTokens(56789) === "57k" && fmtTokens(2_500_000) === "2.5M", "fmtTokens");

// ---- errors (Anthropic's rate-limit and errors pages) ----
ok(/monthly spend cap/.test(explainApiError(429, { error: { type: "rate_limit_error", details: { error_code: "enforced_spend_limit_reached" } } })), "429 enforced_spend_limit_reached: the monthly spend cap, paused until the 1st");
ok(/rate limit/.test(explainApiError(429, { error: { type: "rate_limit_error" } })), "429: a passing rate limit");
ok(/credit balance/.test(explainApiError(400, { error: { message: "Your credit balance is too low to access the Anthropic API." } })), "a low credit balance");
ok(/refused the API key/.test(explainApiError(401, {})) && /overloaded/.test(explainApiError(529, {})) && explainApiError(500, {}) === "", "401, 529, and nothing to add otherwise");

// ---- the price list matches the pricing page rows it names ----
// (The weekly scripts/check-guide.mjs fetches the page itself; this pins the parser on a copy of its rows.)
const { priceRowsProblems } = await import("../scripts/price-check.mjs");
const page = `| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |
| Claude Sonnet 5.5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.10 / MTok<sup>2</sup> | $10 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |`;
ok(priceRowsProblems(page).length === 0, "the price list matches the pricing page's rows", JSON.stringify(priceRowsProblems(page)));
ok(priceRowsProblems(page.replace("| $10 / MTok |", "| $12 / MTok |")).length === 1, "a changed price is reported");
ok(priceRowsProblems(page.replace(/^\| Claude Opus 5\.5 .*$/m, "")).length === 1, "a missing row is reported");

// ---- pages: measured cost per page (a long page is several answers, one per slice) ----
{
  const at = Date.parse("2026-11-17T10:00:00Z");
  const a = { input_tokens: 3000, output_tokens: 400 }, b = { input_tokens: 2500, output_tokens: 300 }, c = { input_tokens: 2000, output_tokens: 100 };
  let l = emptyLog();
  for (const u of [a, b]) l = addCall(l, { model: "claude-haiku-5-5", usage: u, at }); // a long page: two slices
  l = addPage(l, { model: "claude-haiku-5-5", usages: [a, b], at });
  l = addCall(l, { model: "claude-haiku-5-5", usage: c, at }); // a short page: one slice
  l = addPage(l, { model: "claude-haiku-5-5", usages: [c], at });
  l = addCall(l, { model: "claude-haiku-5-5", usage: c, at }); // a slice of a page that then failed: real spend, no page
  const t = summary(l, at).today;
  ok(t.requests === 4 && t.pages === 2 && near(t.pageCost, (5500 + 2000) * 0.1e-6 + (700 + 100) * 0.5e-6), "pages: counted once all slices answered, with their exact cost", JSON.stringify(t));
  ok(near(t.cost - t.pageCost, 2000 * 0.1e-6 + 100 * 0.5e-6), "a failed page's answer is still spend, but not a page");
  const v = usageView(l, at);
  ok(v.today.sub === "2 pages" && v.today.tokens === "4 requests · 9.5k in · 900 out" && v.month.label === "November", "usageView: pages up front, requests and tokens as details", JSON.stringify(v.today));
  ok(v.models[0].sub === `≈${fmtUsd(t.pageCost / 2)} a page · 2 pages` && v.models[0].cost === `≈${fmtUsd(t.cost)}`, "usageView: the measured cost per page", JSON.stringify(v.models[0]));
  // a log from before pages were counted: requests only, no made-up per-page figure
  let old = addCall(emptyLog(), { model: "claude-sonnet-5-5", usage: a, at });
  const vo = usageView(old, at);
  ok(vo.today.sub === "1 request" && vo.models[0].sub === "1 request" && !/a page/.test(vo.models[0].sub), "older logs: no per-page cost is guessed", JSON.stringify(vo.models[0]));
  // an unknown model: pages without a price give no per-page figure
  let un = addCall(emptyLog(), { model: "claude-future-9", usage: a, at });
  un = addPage(un, { model: "claude-future-9", usages: [a], at });
  const vu = usageView(un, at);
  ok(vu.models[0].sub === "1 page" && vu.models[0].cost === "price unknown", "unpriced pages: counted, never priced", JSON.stringify(vu.models[0]));
  ok(usageView(emptyLog(), at).today.sub === "Nothing yet" && usageView(emptyLog(), at).models.length === 0, "an empty log says so");
}

console.log(failures ? `USAGE TESTS FAILED (${failures} of ${failures + passes})` : `USAGE TESTS PASSED (${passes})`);
process.exitCode = failures ? 1 : 0;
