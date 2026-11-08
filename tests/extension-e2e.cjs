// End-to-end render test: runs the real content.js against a fake DOM with
// node-canvas, feeding a mocked Claude response built from real detection.
const { createCanvas, loadImage, Image } = require("canvas");
const fs = require("fs");

const PAGE = process.argv[2] || "/mnt/user-data/uploads/1747536e-image.png";
const OUT = process.argv[3] || "e2e-out.png";
const ITEMS_FILE = process.argv[4]; // JSON: [{tag, box:[x,y,w,h] in px of the 1600-scaled image, size, text}]

(async () => {
  const src = await loadImage(PAGE);
  const scale = Math.min(1, 1600 / Math.max(src.width, src.height));
  const cw = Math.round(src.width * scale), ch = Math.round(src.height * scale);
  const c = createCanvas(cw, ch); const cx = c.getContext("2d");
  cx.drawImage(src, 0, 0, cw, ch);

  // --- background's prepareSlices, replicated ---
  new Function(fs.readFileSync("../extension/bubble.js", "utf8"))();
  const G = globalThis.GyT;
  const cands = G.detectBubbles(cx.getImageData(0, 0, cw, ch));
  const W = src.width, H = src.height, toX = W / cw, toY = H / ch;
  const bubbles = cands.map((cd, i) => ({
    id: i + 1,
    box: [(cd.bbox.x * toX) / W, (cd.bbox.y * toY) / H, (cd.bbox.w * toX) / W, (cd.bbox.h * toY) / H],
    centroid: [(cd.centroid.x * toX) / W, (cd.centroid.y * toY) / H],
    areaFrac: (cd.area * toX * toY) / (W * H),
    color: cd.color, rows: cd.rows, cols: cd.cols,
    blockW: (cd.scale * toX) / W, blockH: (cd.scale * toY) / H, fillRatio: cd.fillRatio,
  }));
  const rawItems = JSON.parse(fs.readFileSync(ITEMS_FILE, "utf8"));
  const items = rawItems.map((it) => ({
    tag: it.tag ?? null,
    box: it.box ? [(it.box[0] / cw), (it.box[1] / ch), (it.box[2] / cw), (it.box[3] / ch)] : null,
    kind: it.kind || "bubble", size: it.size || "normal", source: "", text: it.text,
  }));
  const imageDataUrl = fs.readFileSync(PAGE).toString("base64");
  const result = { items, bubbles, width: W, height: H, usage: {}, imageDataUrl: "data:image/png;base64," + imageDataUrl };

  // --- fake DOM ---
  const canvases = [];
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } }, append() {}, remove() {}, addEventListener() {}, textContent: "", id: "", className: "", disabled: false, offsetWidth: 100, contains() { return false; } });
  class HTMLImageElement {}
  const img = Object.assign(new HTMLImageElement(), {
    naturalWidth: W, naturalHeight: H, currentSrc: "https://example.test/page.png", src: "https://example.test/page.png", isConnected: true,
    closest() { return null; }, getBoundingClientRect() { return { left: 0, top: 0, width: W, height: H, right: W, bottom: H }; },
  });
  globalThis.HTMLImageElement = HTMLImageElement;
  globalThis.window = globalThis; globalThis.innerWidth = W; globalThis.innerHeight = H;
  globalThis.location = { hostname: "example.test" };
  globalThis.Image = Image;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.getComputedStyle = () => ({ objectFit: "fill" });
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  globalThis.document = {
    documentElement: el(), body: el(), images: [img],
    createElement(tag) { if (tag === "canvas") { const k = createCanvas(1, 1); k.style = {}; k.remove = () => {}; canvases.push(k); return k; } return el(); },
    getElementById() { return null; }, addEventListener() {},
  };
  let onMessage = null;
  globalThis.chrome = {
    runtime: {
      sendMessage: async (m) => m.type === "GET_SETTINGS" ? { enabled: true, autoSites: [], uppercase: false, fontFamily: "", excludedSites: "" } : m.type === "TRANSLATE" ? result : {},
      onMessage: { addListener(fn) { onMessage = fn; } },
    },
    storage: { onChanged: { addListener() {} } },
  };
  new Function(fs.readFileSync("../extension/typeset.js", "utf8"))();
  new Function(fs.readFileSync("../extension/content.js", "utf8"))();
  await new Promise((r) => setTimeout(r, 50));
  onMessage({ type: "TRANSLATE_VISIBLE" }, null, () => {});
  await new Promise((r) => setTimeout(r, 1500));

  const overlay = canvases[1];
  if (!overlay) throw new Error("no overlay produced: " + canvases.length);
  // composite overlay on the page for viewing
  const outC = createCanvas(W, H); const o = outC.getContext("2d");
  o.drawImage(src, 0, 0); o.drawImage(overlay, 0, 0, W, H);
  fs.writeFileSync(OUT, outC.toBuffer("image/png"));
  console.log("wrote", OUT, "candidates:", bubbles.length);
})().catch((e) => { console.error(e); process.exit(1); });
