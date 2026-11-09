// Gytakusub – shared prompt + response parsing (extension background + web app).
// ES module.

export const MODELS = [
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 — fastest, cheapest" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 — better on dense / stylised pages" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 — best quality, most expensive" },
];

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

Find EVERY piece of dialogue and written text in the image: speech bubbles, thought bubbles, narration boxes, and signs. Do NOT include sound effects / onomatopoeia drawn as part of the artwork.

For each item return:
- "tag": the number of the stamped region the text is inside, or null if the text is not inside a stamped region. One tag per item; if one stamped bubble contains two separate pieces of text, return two items with the same tag.
- "box": [x, y, w, h] in PIXELS of this image: x,y = top-left corner of the text, w = width, h = height. Measure x against the ${slice.cw}px width and y against the ${slice.ch}px height independently. The box must tightly enclose the TEXT itself, not the whole bubble. Required for every item, most important for items with tag null.
- "kind": one of "bubble", "narration", "sign".
- "size": the lettering size relative to normal dialogue on this page: "small" (whispers, asides, tiny notes), "normal", or "large" (shouting, big bold lettering).
${settings.includeSource ? `- "source": the original text, transcribed exactly (vertical Japanese: read top-to-bottom, right-to-left).\n` : ""}- "text": a natural, concise ${settings.targetLang} translation that matches the tone. Keep honorifics (-san, -kun) only where conventional. Never leave text untranslated. If the source is already in ${settings.targetLang}, copy it.

Order the items in natural reading order for the page (manga: right-to-left, top-to-bottom).

Also return "terms": any proper nouns (character names, places, techniques, titles) that appear, with the translation you used, so later pages stay consistent.

Glossary (use these exactly):
${glossary || "(none)"}

Terms already used on earlier pages (stay consistent with these):
${terms}
${recent}${settings.customPrompt.trim() ? `\nExtra instructions from the user:\n${settings.customPrompt.trim()}\n` : ""}
Respond with ONLY a JSON object, no prose, in this exact shape:
{"items":[{"tag":1,"box":[x,y,w,h],"kind":"bubble","size":"normal",${settings.includeSource ? `"source":"...",` : ""}"text":"..."}],"terms":[{"source":"...","translation":"..."}]}`;
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
export function normalizeItems(rawItems, s, width, height) {
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
    if (it.kind === "sfx" || !it.text) continue;
    items.push({
      tag, box,
      kind: it.kind || "bubble",
      size: ["small", "normal", "large"].includes(it.size) ? it.size : "normal",
      source: String(it.source || ""),
      text: String(it.text || ""),
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
export function answerSchema(includeSource) {
  const item = {
    type: "object", additionalProperties: false,
    properties: {
      tag: { type: ["integer", "null"] },
      box: { type: "array", items: { type: "number" } },
      kind: { type: "string", enum: ["bubble", "narration", "sign"] },
      size: { type: "string", enum: ["small", "normal", "large"] },
      ...(includeSource ? { source: { type: "string" } } : {}),
      text: { type: "string" },
    },
    required: ["tag", "box", "kind", "size", ...(includeSource ? ["source"] : []), "text"],
  };
  const term = { type: "object", additionalProperties: false, properties: { source: { type: "string" }, translation: { type: "string" } }, required: ["source", "translation"] };
  return { type: "object", additionalProperties: false, properties: { items: { type: "array", items: item }, terms: { type: "array", items: term } }, required: ["items", "terms"] };
}

// Set when the API rejects structured output (an older model or API version):
// later calls in this worker send the plain request, whose JSON is parsed leniently.
let structuredRejected = false;

/** One Claude call for one prepared slice. Returns {items(raw), terms, usage}. */
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
  if (structured) body.output_config = { format: { type: "json_schema", schema: answerSchema(!!settings.includeSource) } };
  const res = await fetchFn(API_URL, { method: "POST", headers: apiHeaders(settings.apiKey), body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try { const j = await res.json(); detail = j?.error?.message || JSON.stringify(j); }
    catch { detail = await res.text(); }
    if (structured && res.status === 400 && /output_config|json_schema|schema|structured/i.test(detail)) {
      console.warn("Gytakusub: structured output not accepted, using a plain request:", detail);
      structuredRejected = true;
      return callClaude(settings, slice, ctx, fetchFn);
    }
    throw new Error(`Claude API ${res.status}: ${detail}`);
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
  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    terms: Array.isArray(parsed.terms) ? parsed.terms : [],
    usage: data.usage || null,
  };
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
