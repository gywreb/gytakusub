// Mock of the Claude Messages API + a reader-like test page, for real-browser tests.
// POST /v1/messages: decodes the stamped slice, detects bubbles locally and answers
// with one translation per stamped bubble (tag + pixel box), like Claude would.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "canvas";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
new Function(fs.readFileSync(path.join(root, "extension/bubble.js"), "utf8"))();
const G = globalThis.GyT;

const TEXTS = ["I never thought it would come to this.", "Wait!", "Are you sure about that?", "We leave at dawn. No excuses.",
  "That's impossible...", "Behind you!", "Fine. Have it your way.", "Nobody told me anything about a test.", "Hm.", "Run."];

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
      const cands = G.detectBubbles(ctx.getImageData(0, 0, img.width, img.height));
      const m = prompt.match(/\((\d+)[–-](\d+)\)/); const tagFrom = m ? +m[1] : 1;
      const items = cands.map((cd, i) => ({
        tag: tagFrom + i, kind: "bubble", size: "normal", text: TEXTS[i % TEXTS.length],
        // badBoxes: correct tag, but the box drifts like a model that is weak at pixel coordinates
        box: opts.badBoxes
          ? [Math.round(cd.bbox.x + cd.bbox.w * 0.9), Math.round(cd.bbox.y + cd.bbox.h * 1.1), Math.round(cd.bbox.w * 1.3), Math.round(cd.bbox.h * 1.1)]
          : [Math.round(cd.bbox.x + cd.bbox.w * 0.2), Math.round(cd.bbox.y + cd.bbox.h * 0.25), Math.round(cd.bbox.w * 0.6), Math.round(cd.bbox.h * 0.5)],
      }));
      calls.push({ w: img.width, h: img.height, n: items.length });
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      return res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ items, terms: [] }) }], usage: { input_tokens: 1000, output_tokens: 200 } }));
    }
    res.writeHead(404); res.end();
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ srv, calls, url: `http://127.0.0.1:${port}` })));
}
