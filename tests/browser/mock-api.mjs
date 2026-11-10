// Mock of the Claude Messages API + a reader-like test page, for real-browser tests.
// POST /v1/messages: decodes the stamped slice, detects bubbles locally and answers
// with one translation per stamped bubble (tag + pixel box), like Claude would.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";

const here = path.dirname(fileURLToPath(import.meta.url));

const TEXTS = ["I never thought it would come to this.", "Wait!", "Are you sure about that?", "We leave at dawn. No excuses.",
  "That's impossible...", "Behind you!", "Fine. Have it your way.", "Nobody told me anything about a test.", "Hm.", "Run."];

/** Red stamp circles → their top-left corners, in reading order. */
function findStamps(px) {
  const { width: W, height: H, data } = px;
  const seen = new Uint8Array(W * H), out = [];
  const isRed = (p) => data[p * 4] > 190 && data[p * 4 + 1] < 70 && data[p * 4 + 2] < 120;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p0 = y * W + x; if (seen[p0] || !isRed(p0)) continue;
    let minX = x, minY = y, maxX = x, maxY = y, n = 0; const stack = [p0]; seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop(); n++; const cx = p % W, cy = (p / W) | 0;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx; if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < W * H && !seen[q] && isRed(q)) { seen[q] = 1; stack.push(q); }
    }
    const r = (maxX - minX + 1) / 2;
    if (n > 40 && r >= 6 && Math.abs((maxY - minY) - (maxX - minX)) <= 3) out.push({ x: minX - 1, y: minY - 1, r });
  }
  const band = Math.max(1, Math.round(H / 24));
  return out.sort((a, b) => (Math.floor(a.y / band) - Math.floor(b.y / band)) || (a.x - b.x));
}

export function startMock(port, pageImage, opts = {}) {
  const calls = [];
  const srv = http.createServer(async (req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(`<!doctype html><title>Reader</title><body style="margin:0;background:#111;color:#ddd">
        <div style="height:120px">header</div>
        <div style="display:flex;justify-content:center"><img id="p1" src="/page.png" style="width:720px;display:block"></div>
        <div style="height:1200px">footer</div></body>`);
    }
    if (req.url === "/page.png") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(fs.readFileSync(pageImage)); }
    if (req.url === "/v1/messages" && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const j = JSON.parse(body);
      const content = j.messages[0].content;
      const prompt = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      const imgPart = content.find((c) => c.type === "image");
      const img = await loadImage(Buffer.from(imgPart.source.data, "base64"));
      const c = createCanvas(img.width, img.height); const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      // "Read" the stamps the way the model would: find the red marks, number them
      // in reading order (that is how the engine numbers them), and answer for every
      // tag the prompt announced. Boxes come from the page's ground truth (scaled to
      // the slice) — the mock plays an attentive model; --bad-boxes drifts them.
      const m = prompt.match(/\((\d+)[–-](\d+)\)/); const tagFrom = m ? +m[1] : 1, tagTo = m ? +m[2] : 0;
      const px = ctx.getImageData(0, 0, img.width, img.height);
      const stamps = findStamps(px);
      const truth = opts.truth ? JSON.parse(fs.readFileSync(opts.truth, "utf8")) : [];
      const sc = img.width / (opts.truthWidth || 1200);
      // the engine numbers bubbles first (in reading order), then loose text blocks;
      // the stamps alone do not say which is which, the ground truth does
      const matched = stamps.map((st) => {
        let best = null, bd = Infinity;
        for (const t of truth) { const d = Math.hypot(t.box[0] * sc - st.x, t.box[1] * sc - st.y); if (d < bd) { bd = d; best = t; } }
        return { st, truth: best && bd < st.r * 6 ? best : null };
      });
      const band = Math.max(1, Math.round(img.height / 24));
      matched.sort((a, b) => ((a.truth?.kind === "block") - (b.truth?.kind === "block")) || (Math.floor(a.st.y / band) - Math.floor(b.st.y / band)) || (a.st.x - b.st.x));
      const items = matched.slice(0, tagTo - tagFrom + 1).map(({ st, truth: best }, i) => {
        const box = best ? { x: best.box[0] * sc, y: best.box[1] * sc, w: best.box[2] * sc, h: best.box[3] * sc } : { x: st.x, y: st.y, w: st.r * 14, h: st.r * 7 };
        return {
          tag: tagFrom + i, kind: "bubble", size: "normal", text: TEXTS[i % TEXTS.length],
          // badBoxes: correct tag, but the box drifts like a model that is weak at pixel coordinates
          box: opts.badBoxes
            ? [Math.round(box.x + box.w * 0.6), Math.round(box.y + box.h * 0.7), Math.round(box.w * 1.3), Math.round(box.h * 1.1)] // the 80th-percentile drift seen on real pages
            : [Math.round(box.x + box.w * 0.2), Math.round(box.y + box.h * 0.25), Math.round(box.w * 0.6), Math.round(box.h * 0.5)],
        };
      });
      calls.push({ w: img.width, h: img.height, n: items.length });
      // like the real API: the model that answered, its token usage and the rate-limit headers
      // (exposed to pages here, so the web app's rate-limit line can be tested)
      const limits = {
        "anthropic-ratelimit-requests-limit": "50", "anthropic-ratelimit-requests-remaining": String(50 - calls.length), "anthropic-ratelimit-requests-reset": new Date(Date.now() + 60e3).toISOString(),
        "anthropic-ratelimit-input-tokens-limit": "40000", "anthropic-ratelimit-input-tokens-remaining": "39000", "anthropic-ratelimit-input-tokens-reset": new Date(Date.now() + 60e3).toISOString(),
        "anthropic-ratelimit-output-tokens-limit": "8000", "anthropic-ratelimit-output-tokens-remaining": "7800", "anthropic-ratelimit-output-tokens-reset": new Date(Date.now() + 60e3).toISOString(),
      };
      res.writeHead(200, { "Content-Type": "application/json", ...cors, ...limits, "Access-Control-Expose-Headers": Object.keys(limits).join(", ") });
      return res.end(JSON.stringify({ model: j.model, content: [{ type: "text", text: JSON.stringify({ items, terms: [] }) }], usage: { input_tokens: 1000, output_tokens: 200 } }));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ srv, calls, url: `http://127.0.0.1:${port}` })));
}
