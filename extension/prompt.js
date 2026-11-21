// Gytakusub – shared prompt + response parsing (extension background + web app).
// ES module.
import { explainApiError, limitsOf } from "./usage.js";

export const MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fastest, cheapest" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — better on dense / stylised pages" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — best quality, most expensive" },
];

/** Kinds of lettering left as drawn: Claude labels them rather than leaving them out, which it does not reliably do. */
export const LEFT_AS_DRAWN = new Set(["sfx", "logo"]);

export function buildPrompt(settings, ctx, slice) {
  const glossary = settings.glossary.trim();
  const terms = ctx.terms.length
    ? ctx.terms.map((t) => `${t.source} = ${t.translation}`).join("\n")
    : "(none yet)";
  const recent = settings.useContext && ctx.recent.length
    ? `\nRecent dialogue from the previous pages of this chapter, oldest first (use it for continuity: who is speaking to whom, tone, and what pronouns refer to):\n${ctx.recent.map((l) => "- " + l).join("\n")}\n`
    : "";
  const hasTags = slice.tagTo >= slice.tagFrom;
  const tagLine = hasTags
    ? `Text regions (speech bubbles, captions, and some loose lettering) are stamped with a small red circle containing a number (${slice.tagFrom}–${slice.tagTo}), placed at the region's top-left corner. Ignore the stamps when reading the text. A stamp may occasionally sit on artwork that is not text: return nothing for it — never invent text for a stamp.`
    : `No regions are stamped on this image.`;
  return `You are translating one page (or one slice of a long strip) of a manga, manhwa or comic into ${settings.targetLang}.

The image is exactly ${slice.cw} pixels wide and ${slice.ch} pixels tall. The origin (0,0) is the top-left corner; x grows to the right (max ${slice.cw}), y grows downward (max ${slice.ch}).
${tagLine}

Find EVERY piece of dialogue and written text in the image: speech bubbles, thought bubbles, narration boxes, and signs. Sound effects / onomatopoeia drawn as part of the artwork, series logos, publisher or magazine marks, scanlation credits and watermarks, and page numbers stay as they are drawn: if you return one, give it the kind "sfx" (a sound effect) or "logo" (the others), so it is left alone.

For each item return:
- "tag": the number of the stamped region the text is inside, or null if the text is not inside a stamped region. One tag per item; if one stamped bubble contains two separate pieces of text, return two items with the same tag.
- "box": [x, y, w, h] in PIXELS of this image: x,y = top-left corner of the text, w = width, h = height. Measure x against the ${slice.cw}px width and y against the ${slice.ch}px height independently. The box must tightly enclose the TEXT itself, not the whole bubble. Required for every item, most important for items with tag null.
- "kind": one of "bubble", "narration", "sign", "sfx", "logo". A chapter title, a cover blurb or a caption is "narration" or "sign", not "logo".
- "size": the lettering size relative to normal dialogue on this page: "small" (whispers, asides, tiny notes), "normal", or "large" (shouting, big bold lettering).
- "source": the original text, transcribed exactly (vertical Japanese: read top-to-bottom, right-to-left).
- "text": a natural, concise ${settings.targetLang} translation that matches the tone. Keep honorifics (-san, -kun) only where conventional. Text in any language other than ${settings.targetLang} is translated, however short, stylised or large it is drawn; only text already in ${settings.targetLang} is copied as it is.

Order the items in natural reading order for the page (manga: right-to-left, top-to-bottom).

Also return "terms": any proper nouns (character names, places, techniques, titles) that appear, with the translation you used, so later pages stay consistent.

Glossary (use these exactly):
${glossary || "(none)"}

Terms already used on earlier pages (stay consistent with these):
${terms}
${recent}${settings.customPrompt.trim() ? `\nExtra instructions from the user:\n${settings.customPrompt.trim()}\n` : ""}
Respond with ONLY a JSON object, no prose, in this exact shape:
{"items":[{"tag":1,"box":[x,y,w,h],"kind":"bubble","size":"normal","source":"...","text":"..."}],"terms":[{"source":"...","translation":"..."}]}`;
}

// Extract the first JSON object from a model reply (tolerates code fences / prose).
export function extractJson(text) {
  if (!text) throw new Error("Empty model response");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Convert one slice's raw model items to full-image fractions.
 * @returns {{items:Array, terms:Array}}
 */
/**
 * @param {Array<{kind: string, source: string, text: string}>|null} [dropped] the lines labelled sound
 *   effect or logo are left as drawn; given, they are added to it (for the debug report: a line
 *   Claude labelled "sfx" that a character says is lost, and the report showed nothing; 2.14.1)
 */
export function normalizeItems(rawItems, s, width, height, dropped = null) {
  const items = [];
  for (const it of rawItems) {
    let box = null;
    if (Array.isArray(it.box) && it.box.length === 4) {
      let [bx, by, bw, bh] = it.box.map(Number);
      if ([bx, by, bw, bh].every(Number.isFinite)) {
        bx = Math.max(0, Math.min(s.cw, bx));
        by = Math.max(0, Math.min(s.ch, by));
        bw = Math.max(1, Math.min(s.cw - bx, bw));
        bh = Math.max(1, Math.min(s.ch - by, bh));
        box = [(s.x + (bx / s.cw) * s.w) / width, (s.y + (by / s.ch) * s.h) / height, ((bw / s.cw) * s.w) / width, ((bh / s.ch) * s.h) / height];
      }
    }
    let tag = Number(it.tag);
    if (!Number.isInteger(tag) || tag < s.tagFrom || tag > s.tagTo) tag = null;
    if (!box && tag === null) continue;
    if (LEFT_AS_DRAWN.has(it.kind) && it.text) dropped?.push({ kind: it.kind, source: String(it.source || ""), text: String(it.text) });
    if (LEFT_AS_DRAWN.has(it.kind) || !it.text) continue;
    items.push({
      tag, box,
      kind: it.kind || "bubble",
      size: ["small", "normal", "large"].includes(it.size) ? it.size : "normal",
      source: String(it.source || ""),
      text: String(it.text || ""),
      ...(it.same ? { same: true } : {}), // as drawn already (checkCopies)
    });
  }
  return items;
}

export function sliceGeometry(W, H, settings) {
  const isStrip = H > 2.2 * W && H > settings.sliceHeight;
  const out = [];
  if (isStrip) {
    const scale = Math.min(1, settings.stripWidth / W);
    const sliceOrigH = Math.round(settings.sliceHeight / scale);
    for (let y = 0; y < H; y += sliceOrigH) out.push({ x: 0, y, w: W, h: Math.min(sliceOrigH, H - y), scale });
  } else {
    out.push({ x: 0, y: 0, w: W, h: H, scale: Math.min(1, settings.maxLongEdge / Math.max(W, H)) });
  }
  return out;
}

export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";
export function apiHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

/**
 * The answer's JSON Schema, sent as structured output (output_config.format):
 * the API then constrains the model's sampling to it, so the reply is always
 * valid JSON of this shape — a translation that quotes someone ("…") can no
 * longer break the parse. Every property is required and objects are closed,
 * as structured outputs require.
 */
export function answerSchema() {
  const item = {
    type: "object", additionalProperties: false,
    properties: {
      tag: { type: ["integer", "null"] },
      box: { type: "array", items: { type: "number" } },
      kind: { type: "string", enum: ["bubble", "narration", "sign", ...LEFT_AS_DRAWN] },
      size: { type: "string", enum: ["small", "normal", "large"] },
      source: { type: "string" },
      text: { type: "string" },
    },
    required: ["tag", "box", "kind", "size", "source", "text"],
  };
  const term = { type: "object", additionalProperties: false, properties: { source: { type: "string" }, translation: { type: "string" } }, required: ["source", "translation"] };
  return { type: "object", additionalProperties: false, properties: { items: { type: "array", items: item }, terms: { type: "array", items: term } }, required: ["items", "terms"] };
}

// Set when the API rejects structured output (an older model or API version):
// later calls in this worker send the plain request, whose JSON is parsed leniently.
let structuredRejected = false;

/**
 * One Claude call for one prepared slice. Returns {items(raw), terms, usage, model, limits}: the
 * answer's token usage, the model that answered and the rate-limit headers (for usage.js).
 */
export async function callClaude(settings, slice, ctx, fetchFn = fetch) {
  const body = {
    model: settings.model,
    max_tokens: 8192, // billed per token used; a dense page with transcriptions needs ~3k
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: slice.mediaType, data: slice.b64 } },
        { type: "text", text: buildPrompt(settings, ctx, slice) },
      ],
    }],
  };
  const structured = !structuredRejected;
  if (structured) body.output_config = { format: { type: "json_schema", schema: answerSchema() } };
  const res = await fetchFn(API_URL, { method: "POST", headers: apiHeaders(settings.apiKey), body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "", hint = "";
    try { const j = await res.json(); detail = j?.error?.message || JSON.stringify(j); hint = explainApiError(res.status, j); }
    catch { detail = await res.text().catch(() => ""); hint = explainApiError(res.status); }
    if (structured && res.status === 400 && /output_config|json_schema|schema|structured/i.test(detail)) {
      console.warn("Gytakusub: structured output not accepted, using a plain request:", detail);
      structuredRejected = true;
      return callClaude(settings, slice, ctx, fetchFn);
    }
    throw new Error(`Claude API ${res.status}: ${detail}${hint ? " " + hint : ""}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  // Say why there is nothing to read, rather than failing on the parse.
  if (data.stop_reason === "refusal") throw new Error("Claude declined to translate this page (refusal)");
  if (data.stop_reason === "max_tokens") throw new Error(`Claude's answer was cut off (max_tokens, ${data.usage?.output_tokens ?? "?"} tokens)`);
  if (!text.trim()) throw new Error(`Empty model response (stop_reason: ${data.stop_reason ?? "none"})`);
  let parsed;
  try { parsed = extractJson(text); }
  catch (e) {
    console.warn("Gytakusub: unreadable model answer:", text.slice(0, 4000));
    throw new Error(`Unreadable model answer (${e.message}; stop_reason: ${data.stop_reason ?? "none"})`);
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const again = await checkCopies(settings, items, fetchFn);
  return {
    items,
    terms: Array.isArray(parsed.terms) ? parsed.terms : [],
    usage: addUsage(data.usage || null, again),
    model: data.model || settings.model,
    limits: limitsOf(res.headers),
  };
}

const addUsage = (a, b) => (!b ? a : { ...(a || {}), input_tokens: (a?.input_tokens || 0) + (b.input_tokens || 0), output_tokens: (a?.output_tokens || 0) + (b.output_tokens || 0) });

/** A line's words for comparing a translation with its original: letters and digits, lower case, no accents. */
export const wordsOf = (s) => String(s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") || "";

/**
 * Lines Claude returned word for word as they are drawn (its "text" is its "source"). Haiku left a
 * Spanish line untranslated on two readings of the same page, though told never to; and a credits
 * page, already in English, was erased and lettered again with the same words (2.14). A single
 * word given back as drawn (a name, "Ah!") is marked `same` and stays as drawn (engine/layout.js:
 * like a line of only punctuation); asking about each would add a call to many pages. Longer lines
 * are asked again on their own, as text, in one call for the page: a line that comes back translated
 * takes the translation; one that comes back the same is already in the target language and is
 * marked `same`. A failed re-ask changes nothing.
 * @returns the re-ask's token usage, or null when there was nothing to ask
 */
export async function checkCopies(settings, items, fetchFn = fetch) {
  const copied = items.filter((it) => !LEFT_AS_DRAWN.has(it.kind) && wordsOf(it.text) && wordsOf(it.text) === wordsOf(it.source));
  // one word as drawn: no space in it ("S-SENPAI?", "HARU-CHAN.", a link count as one; 2.14.1)
  for (const it of copied) if (!/\s/u.test(String(it.source).trim())) it.same = true;
  const ask = copied.filter((it) => !it.same);
  if (!ask.length) return null;
  try {
    const { texts, usage } = await translateLines(settings, ask.map((it) => String(it.source)), fetchFn);
    ask.forEach((it, i) => {
      const t = texts[i];
      if (typeof t === "string" && wordsOf(t) && wordsOf(t) !== wordsOf(it.source)) it.text = t;
      else it.same = true;
    });
    return usage;
  } catch (e) {
    console.warn("Gytakusub: asking again for lines left untranslated failed", e);
    return null;
  }
}

/** One text-only call: each line translated, in order ({texts, usage}). */
async function translateLines(settings, lines, fetchFn) {
  const prompt = `Translate each of these lines from a comic page into ${settings.targetLang}. A line in any other language is translated, however short or stylised; a line already in ${settings.targetLang}, a name, or a sound written the same in ${settings.targetLang} stays exactly as it is.

Lines (JSON):
${JSON.stringify(lines)}

Respond with ONLY a JSON object: {"texts":["...", ...]}, one entry per line, in the same order.`;
  const body = {
    model: settings.model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
    ...(structuredRejected ? {} : { output_config: { format: { type: "json_schema", schema: { type: "object", additionalProperties: false, properties: { texts: { type: "array", items: { type: "string" } } }, required: ["texts"] } } } }),
  };
  const res = await fetchFn(API_URL, { method: "POST", headers: apiHeaders(settings.apiKey), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  const parsed = extractJson((data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));
  return { texts: Array.isArray(parsed.texts) ? parsed.texts : [], usage: data.usage || null };
}

/** Merge new terms / lines into a chapter context object (pure). */
export function mergeContext(ctx, newTerms, newLines) {
  const map = new Map(ctx.terms.map((t) => [t.source, t.translation]));
  for (const t of newTerms) if (t && t.source && t.translation && !map.has(t.source)) map.set(t.source, t.translation);
  return {
    terms: [...map].map(([source, translation]) => ({ source, translation })).slice(-80),
    recent: [...ctx.recent, ...newLines.map((l) => String(l).slice(0, 160))].slice(-40),
  };
}
