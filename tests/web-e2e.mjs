// Wire test for the web pipeline: translator.translateImage + renderPage with a mocked Claude.
import { createCanvas, loadImage as cvLoad, Image } from "canvas";
import fs from "node:fs";
new Function(fs.readFileSync("../web/bubble.js", "utf8"))();
new Function(fs.readFileSync("../web/typeset.js", "utf8"))();
globalThis.Image = Image;
globalThis.document = { createElement(tag) { if (tag !== "canvas") throw new Error(tag); const c = createCanvas(1, 1); c.toBlob = (cb, type, q) => cb(new Blob([c.toBuffer("image/jpeg", { quality: q })], { type })); return c; } };
globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then((ab) => { this.result = `data:${blob.type};base64,` + Buffer.from(ab).toString("base64"); this.onload(); }); } };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
let seenPrompt = "", seenTags = null;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  seenPrompt = body.messages[0].content[1].text;
  const m = seenPrompt.match(/\((\d+)–(\d+)\)/); seenTags = m ? [+m[1], +m[2]] : null;
  const items = [
    { tag: 1, box: [860, 205, 90, 70], kind: "bubble", size: "normal", text: "Ah... ah..." },
    { tag: null, box: [255, 700, 110, 65], kind: "bubble", size: "normal", text: "It's not a curse!" },
    { tag: 5, box: [790, 705, 70, 45], kind: "bubble", size: "normal", text: "This is..." },
    { tag: 5, box: [760, 805, 80, 35], kind: "bubble", size: "normal", text: "A curse" },
    { tag: 4, box: [985, 715, 110, 80], kind: "bubble", size: "small", text: "After the Labyrinth Building, the campus..." },
  ];
  return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ items, terms: [{ source: "Hellstein", translation: "Hellstein" }] }) }], usage: { input_tokens: 1500, output_tokens: 300 } }) };
};
const T = await import("../web/translator.js");
const img = await cvLoad(process.argv[2] || "fixtures/page.png");

const settings = { ...T.DEFAULT_SETTINGS, apiKey: "sk-test" };
const t0 = Date.now();
const result = await T.translateImage(img, settings, { terms: [], recent: ["Previous line one"] });
console.log("tags offered to model:", seenTags, "| prompt mentions recent dialogue:", seenPrompt.includes("Previous line one"));
console.log("items:", result.items.length, "bubbles:", result.bubbles.length, "ctx terms:", result.ctx.terms.length, "recent:", result.ctx.recent.length, `(${Date.now() - t0}ms incl. detection)`);
const { translated, drawn } = T.renderPage(img, result, settings);
console.log("drawn:", drawn);
fs.writeFileSync(process.argv[3] || "web-e2e.png", translated.toBuffer("image/png"));
