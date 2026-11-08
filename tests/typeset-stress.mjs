// Stress test: tagged bubbles with deliberately WRONG, oversized model boxes, adjacent
// bubbles, an untagged erase-zone item. Every translation must stay inside its own bubble.
// Usage: node typeset-stress.mjs out.png   (needs fixtures/demo-page.png from make-demo-page.py)
// Stress: tagged bubbles with WRONG, oversized boxes + one untagged erase-zone item next to a bubble.
import { createCanvas, loadImage, Image } from "canvas";
import fs from "node:fs";
new Function(fs.readFileSync("../web/bubble.js", "utf8"))();
new Function(fs.readFileSync("../web/typeset.js", "utf8"))();
globalThis.Image = Image;
globalThis.document = { createElement(t) { const c = createCanvas(1, 1); c.toBlob = (cb, type, q) => cb(new Blob([c.toBuffer("image/jpeg", { quality: q })], { type })); return c; } };
globalThis.FileReader = class { readAsDataURL(b) { b.arrayBuffer().then((ab) => { this.result = `data:${b.type};base64,` + Buffer.from(ab).toString("base64"); this.onload(); }); } };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const G = globalThis.GyT; let cands = null; const od = G.detectBubbles; G.detectBubbles = (px) => (cands = od(px));
globalThis.fetch = async (url, init) => {
  const prompt = JSON.parse(init.body).messages[0].content[1].text;
  const [, cw, ch] = prompt.match(/exactly (\d+) pixels wide and (\d+) pixels tall/).map(Number);
  const sx = cw / 1200, sy = ch / 1700;
  const tagAt = (x, y) => { const i = cands.findIndex((c) => x >= c.bbox.x && x <= c.bbox.x + c.bbox.w && y >= c.bbox.y && y <= c.bbox.y + c.bbox.h); return i + 1; };
  const items = [
    // correct tags, boxes deliberately shifted/enlarged into the neighbour bubble
    { tag: tagAt(230 * sx, 160 * sy), box: [120 * sx, 90 * sy, 700 * sx, 200 * sy], size: "large", text: "Maybe the Brachiosaurus won't work for now." },
    { tag: tagAt(960 * sx, 170 * sy), box: [600 * sx, 100 * sy, 500 * sx, 220 * sy], size: "normal", text: "No... Tokime is too agile for that." },
    { tag: tagAt(300 * sx, 790 * sy), box: [100 * sx, 700 * sy, 400 * sx, 200 * sy], size: "large", text: "Now, aim at the joints of the body. They seem to be the weak point." },
    { tag: tagAt(900 * sx, 790 * sy), box: [600 * sx, 700 * sy, 500 * sx, 200 * sy], size: "small", text: "As always, I'll leave the naming to you." },
    // untagged, near the narration box: erase-zone path
    { tag: null, box: [90 * sx, 1270 * sy, 300 * sx, 30 * sy], size: "small", text: "Three hours later..." },
    { tag: tagAt(930 * sx, 1380 * sy), box: [700 * sx, 1300 * sy, 450 * sx, 160 * sy], size: "normal", text: "Plus, the intense heat its body generates creates an impenetrable defense." },
  ];
  return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ items, terms: [] }) }], usage: {} }) };
};
const T = await import("../web/translator.js");
const page = await loadImage("fixtures/demo-page.png");
const s = { ...T.DEFAULT_SETTINGS, apiKey: "x" };
const r = await T.translateImage(page, s);
const { translated } = T.renderPage(page, r, s, 1700);
fs.writeFileSync(process.argv[2] || "typeset-stress.png", translated.toBuffer("image/png"));
console.log("ok", r.items.map((i) => i.tag));
process.exit(0);
