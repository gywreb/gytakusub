// Gytakusub – Claude usage: what each translation cost, kept on this device.
// Shared by the extension (service worker, popup, Options) and the web app (copied
// in by scripts/sync-shared.mjs). ES module, no browser APIs at import time.
//
// Where the numbers come from:
// - Tokens: every Claude API answer reports its own `usage` (input, output, cache
//   reads and writes). Those are exact for that request.
// - Cost: tokens × Anthropic's published prices (PRICES below), so an estimate. The
//   bill is in the Claude Console (Usage and Cost pages), which also sees other apps
//   and devices using the same account. Exact account-wide numbers through the API
//   need an organization's Admin API key, which must never sit in a browser.
// - Rate limits: the `anthropic-ratelimit-*` headers of the latest answer, where the
//   browser lets the page read them.
// Nothing here is sent anywhere.

// Anthropic's prices in USD per million tokens, from PRICE_SOURCE as of PRICES_CHECKED.
// scripts/check-guide.mjs compares them with that page every week and opens an issue when
// a row changed. Haiku 5.5 has two rows: a request whose prompt (all input tokens, cache
// reads and writes included) is over 100,000 tokens pays the second for everything.
export const PRICE_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
export const PRICES_CHECKED = "2026-11-10";
export const PRICES = {
  "claude-haiku-5-5": {
    label: "Claude Haiku 5.5",
    tiers: [
      { upTo: 100_000, row: "Claude Haiku 5.5 (for prompts up to 100,000 tokens)", input: 0.10, write5m: 0.125, write1h: 0.20, read: 0.01, output: 0.50 },
      { upTo: Infinity, row: "Claude Haiku 5.5 (for prompts over 100,000 tokens)", input: 0.50, write5m: 0.625, write1h: 1, read: 0.05, output: 2.50 },
    ],
  },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", tiers: [{ upTo: Infinity, row: "Claude Sonnet 5.5", input: 2, write5m: 2.50, write1h: 4, read: 0.10, output: 10 }] },
  "claude-opus-5-5": { label: "Claude Opus 5.5", tiers: [{ upTo: Infinity, row: "Claude Opus 5.5", input: 4, write5m: 5, write1h: 8, read: 0.20, output: 20 }] },
};

/** The price list entry for a model id ("claude-sonnet-5-5", or a dated id that starts with it). */
export function priceOf(model) {
  if (!model) return null;
  if (PRICES[model]) return PRICES[model];
  const base = Object.keys(PRICES).find((k) => model.startsWith(k + "-"));
  return base ? PRICES[base] : null;
}

/** An API answer's `usage` as plain numbers: {input, output, read, write5m, write1h}. */
export function tokensOf(u = {}) {
  const write = u.cache_creation_input_tokens || 0;
  const w5 = u.cache_creation?.ephemeral_5m_input_tokens, w1 = u.cache_creation?.ephemeral_1h_input_tokens;
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    read: u.cache_read_input_tokens || 0,
    // without the split, writes are priced as 5-minute writes (the default cache lifetime)
    write5m: w5 ?? (w1 == null ? write : Math.max(0, write - w1)),
    write1h: w1 ?? 0,
  };
}

/** Estimated USD for one request, or null when the model is not in the price list. */
export function costOf(model, usage) {
  const p = priceOf(model);
  if (!p) return null;
  const t = tokensOf(usage);
  const prompt = t.input + t.read + t.write5m + t.write1h;
  const r = p.tiers.find((x) => prompt <= x.upTo);
  return (t.input * r.input + t.write5m * r.write5m + t.write1h * r.write1h + t.read * r.read + t.output * r.output) / 1e6;
}

/** The `anthropic-ratelimit-*` headers of an answer, or null when none are readable. */
export function limitsOf(headers) {
  const get = (h) => headers?.get?.(h) ?? null;
  const read = (kind) => {
    const limit = get(`anthropic-ratelimit-${kind}-limit`), remaining = get(`anthropic-ratelimit-${kind}-remaining`);
    return limit == null || remaining == null ? null : { limit: Number(limit), remaining: Number(remaining), reset: get(`anthropic-ratelimit-${kind}-reset`) };
  };
  const out = { requests: read("requests"), inputTokens: read("input-tokens"), outputTokens: read("output-tokens") };
  return out.requests || out.inputTokens || out.outputTokens ? out : null;
}

// ---------- the log ----------
// {v: 1, days: {"2026-11-10": {"claude-sonnet-5-5": {requests, input, output, read, write5m, write1h, cost, unpriced}}},
//  limits: {at, model, requests, inputTokens, outputTokens} | null}
// Days are UTC, like Anthropic's usage reports and the Console. 62 days are kept: this month and last.
export const KEEP_DAYS = 62;
export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export function emptyLog() { return { v: 1, days: {}, limits: null }; }

/** The price-list id for a model id the API reported (a dated id groups with its alias). */
export function modelKey(model) {
  if (!model) return "unknown";
  return Object.keys(PRICES).find((k) => model === k || model.startsWith(k + "-")) || model;
}

/** A copy of `log` with one request added (pure). `limits` as limitsOf() gives them, or null. */
export function addCall(log, { model: reported, usage, limits = null, at = Date.now() }) {
  const model = modelKey(reported);
  const out = { v: 1, days: { ...(log?.days || {}) }, limits: log?.limits || null };
  const day = utcDay(at), t = tokensOf(usage || {}), cost = costOf(model, usage || {});
  const d = { ...(out.days[day] || {}) };
  const m = { requests: 0, input: 0, output: 0, read: 0, write5m: 0, write1h: 0, cost: 0, unpriced: 0, ...(d[model] || {}) };
  m.requests++;
  for (const k of ["input", "output", "read", "write5m", "write1h"]) m[k] += t[k];
  if (cost == null) m.unpriced++; else m.cost += cost;
  d[model] = m;
  out.days[day] = d;
  const cut = utcDay(at - KEEP_DAYS * 864e5);
  for (const k of Object.keys(out.days)) if (k < cut) delete out.days[k];
  if (limits) out.limits = { at, model, ...limits };
  return out;
}

/** Totals over a set of days: {requests, input, output, read, write, cost, unpriced, models:[{model,label,...}]} */
export function totals(log, days) {
  const by = new Map();
  for (const day of days) for (const [model, m] of Object.entries(log?.days?.[day] || {})) {
    const t = by.get(model) || { model, label: priceOf(model)?.label || model, requests: 0, input: 0, output: 0, read: 0, write: 0, cost: 0, unpriced: 0 };
    t.requests += m.requests; t.input += m.input; t.output += m.output; t.read += m.read; t.write += m.write5m + m.write1h;
    t.cost += m.cost; t.unpriced += m.unpriced;
    by.set(model, t);
  }
  const models = [...by.values()].sort((a, b) => b.cost - a.cost || b.requests - a.requests);
  const sum = (k) => models.reduce((n, m) => n + m[k], 0);
  return { requests: sum("requests"), input: sum("input"), output: sum("output"), read: sum("read"), write: sum("write"), cost: sum("cost"), unpriced: sum("unpriced"), models };
}

/** Today (UTC) and this calendar month (UTC) so far. */
export function summary(log, at = Date.now()) {
  const today = utcDay(at), month = today.slice(0, 7);
  return {
    today: totals(log, [today]),
    month: totals(log, Object.keys(log?.days || {}).filter((d) => d.startsWith(month))),
    limits: log?.limits && at - log.limits.at < 5 * 60e3 ? log.limits : null, // older headers say nothing about now
  };
}

// ---------- the monthly API credit of a Max or Team plan ----------
// Anthropic: Max 5x includes $100 and Max 20x $200 of Claude API credit a month (Team: up to $500,
// pooled); the credit refreshes each billing cycle with no rollover, is spent before purchased
// credits, and when it is gone (and nothing was bought) API requests stop until the next credit.
// There is no API for the balance: the Console's Billing page shows the amount and expiry date.
// So the reader tells the app the plan and the renewal date, and the app sets this browser's own
// spending against it.
export const CREDIT_SOURCE = "https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers";
export const CREDIT_PLANS = [
  { id: "none", label: "None, or I pay as I go", amount: 0 },
  { id: "max5x", label: "Claude Max 5x: $100 a month", amount: 100 },
  { id: "max20x", label: "Claude Max 20x: $200 a month", amount: 200 },
  { id: "custom", label: "Team or another amount", amount: null },
];

/** The monthly credit in USD from settings {creditPlan, creditCustom}, or 0. */
export function creditAmount(settings = {}) {
  const plan = CREDIT_PLANS.find((p) => p.id === settings.creditPlan);
  if (!plan) return 0;
  return plan.amount ?? Math.max(0, Number(settings.creditCustom) || 0);
}

/**
 * This browser's spending against the monthly credit, or null when no credit is set.
 * {amount, used, left, share, start, renews, daysLeft, pace, projected, runsOut, guessedDate}
 * - The cycle ends on the renewal date the reader gave ("YYYY-MM-DD"; a past one moves on by
 *   months); without one, the calendar month is assumed (guessedDate: true).
 * - pace: USD a day over the last seven days of the cycle (fewer early in a cycle).
 * - runsOut: the day the credit would run out at that pace, if before the renewal.
 */
export function creditStatus(log, settings, at = Date.now()) {
  const amount = creditAmount(settings);
  if (!amount) return null;
  const now = new Date(at);
  let renews = /^\d{4}-\d{2}-\d{2}$/.test(settings.creditRenews || "") ? new Date(settings.creditRenews + "T00:00:00Z") : null;
  const guessedDate = !renews;
  if (!renews) renews = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  while (renews <= now) renews = new Date(Date.UTC(renews.getUTCFullYear(), renews.getUTCMonth() + 1, renews.getUTCDate()));
  const start = new Date(Date.UTC(renews.getUTCFullYear(), renews.getUTCMonth() - 1, renews.getUTCDate()));
  const days = (from) => Object.keys(log?.days || {}).filter((d) => d >= utcDay(from) && d <= utcDay(at));
  const used = totals(log, days(start)).cost;
  const span = Math.min(7, Math.max(1, (at - start) / 864e5));
  const pace = totals(log, days(Math.max(+start, at - span * 864e5))).cost / span;
  const daysLeft = (renews - at) / 864e5;
  const left = Math.max(0, amount - used);
  const runsOutIn = pace > 0 ? left / pace : Infinity;
  return {
    amount, used, left, share: Math.min(1, used / amount), start, renews, daysLeft: Math.ceil(daysLeft), pace,
    projected: used + pace * daysLeft, runsOut: used >= amount ? now : runsOutIn < daysLeft ? new Date(at + runsOutIn * 864e5) : null, guessedDate,
  };
}

/** The credit in plain words: {headline, left, pace, state}. */
export function creditWords(c, fmtDate = (d) => d.toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" })) {
  const inDays = (n) => (n <= 1 ? "tomorrow" : `in ${n} days`);
  const renew = `${c.guessedDate ? "probably renews" : "renews"} ${fmtDate(c.renews)} (${inDays(c.daysLeft)})`;
  if (c.used >= c.amount) {
    return { headline: `≈${fmtUsd(c.used)} of ${fmtUsd(c.amount)} used`, left: `Used up: ${renew}`, pace: "Claude now uses any credits you bought. With none left, requests stop until it renews.", state: "Used up" };
  }
  const pace = c.pace > 0
    ? c.runsOut
      ? `At this pace (≈${fmtUsd(c.pace)} a day) it runs out around ${fmtDate(c.runsOut)}, before it renews.`
      : `At this pace (≈${fmtUsd(c.pace)} a day) you'll use ≈${fmtUsd(c.projected)} of it by then.`
    : "Nothing spent in the last few days.";
  return { headline: `≈${fmtUsd(c.used)} of ${fmtUsd(c.amount)} used`, left: `≈${fmtUsd(c.left)} left · ${renew}`, pace, state: c.runsOut ? "Runs out early" : c.share >= 0.8 ? "Almost used" : "" };
}

/** The rate limit in plain words, or "" (headers from the last answer, at most five minutes old). */
export function limitWords(limits, fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) {
  if (!limits) return "";
  const r = limits.requests, i = limits.inputTokens, o = limits.outputTokens;
  const parts = [r && `${r.remaining} of ${r.limit} requests`, i && `${fmtTokens(i.remaining)} of ${fmtTokens(i.limit)} input tokens`, o && `${fmtTokens(o.remaining)} of ${fmtTokens(o.limit)} output tokens`].filter(Boolean);
  if (!parts.length) return "";
  const resets = [r?.reset, i?.reset, o?.reset].filter(Boolean).map((x) => Date.parse(x)).filter(Number.isFinite);
  const full = resets.length ? ` It's full again by ${fmtTime(Math.max(...resets))}.` : "";
  return `Speed limit (a minute's worth, refilling as you go): ${parts.join(", ")} left at ${fmtTime(limits.at)}.${full}`;
}

// ---------- words ----------

// ---------- formatting ----------
export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n));
/** "$0.0042", "$0.12", "$3.40", "$100": small amounts keep two significant digits, so a cheap page doesn't read as $0.00. */
export function fmtUsd(x) {
  if (!x) return "$0";
  if (Number.isInteger(x)) return `$${x}`;
  if (x < 0.01) return `$${x.toPrecision(2)}`;
  return `$${x.toFixed(2)}`;
}
/** When the UTC day starts in the reader's own time, e.g. "7:00 AM". */
export function dayStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * What a failed Claude call means for the reader, from Anthropic's documented errors:
 * the monthly spend cap or a self-set spend limit, a low credit balance, a rate limit, a bad key.
 * Returns a sentence, or "" when there is nothing to add to the API's own message.
 */
export function explainApiError(status, body = {}) {
  const e = body.error || {}, code = e.details?.error_code || "", msg = String(e.message || "");
  if (status === 429 && code === "enforced_spend_limit_reached") return "Your Claude account reached its monthly spend cap. The API pauses until 00:00 UTC on the 1st, unless you ask for a higher limit in the Claude Console.";
  if (status === 429) return "Claude's rate limit for your account was reached for the moment. Wait a minute and translate again; fewer pages at once also helps.";
  if (/credit balance/i.test(msg)) return "Your Claude credit balance is too low. Add credits (or check your plan's monthly API credits) in the Claude Console under Billing.";
  if (status === 400 && /spend limit|usage limit/i.test(msg)) return "Your Claude account reached the spend limit you set. Raise it in the Claude Console under Limits.";
  if (status === 401) return "Claude refused the API key. Check it in Settings, or create a new one in the Claude Console.";
  if (status === 529) return "Claude is overloaded right now. Try again in a minute.";
  return "";
}
