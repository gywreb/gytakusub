// The engine gives back the OpenCV memory a page used, and names OpenCV's failures (2.14.6). OpenCV's heap stops at 1 GiB and a
// worker keeps one for its whole life, so whatever a page leaves behind adds up over a chapter: a
// 121-image webtoon episode failed from image 110 on, every image after with a bare number for
// an error (OpenCV out of memory). Each run here does what the worker does for a page, through the
// engine's own entry points, then the same page again and again: after the first runs, the part of
// the heap in use must not move.
//   node memory.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createCanvas } from "canvas";
import { bitmapOf } from "./worker-env.mjs";
import { cv } from "./cv-node.mjs";
import { preparePage, prefillPage, finishPage } from "../extension/engine/index.js";
import { erase, fillTexture, eraseFullSize } from "../extension/engine/erase.js";
import { engineError, getCV, OPENCV_MAX } from "../extension/engine/cv.js";
import { makePage } from "./bench/synth.mjs";

const drawable = bitmapOf;

// The heap in use, in MB: where a block larger than anything a page frees is placed. A page that
// leaves memory behind pushes it up by what it left (a view of the page left undeleted: the
// page's whole RGB copy, 2 MB here).
const inUse = () => { const p = cv._malloc(64 << 20); cv._free(p); return p / 1048576; };

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok -", name); };

/** The same work `runs` times; what the heap in use moved by after the first `warm` runs. */
async function growth(work, runs = 3, warm = 1) {
  for (let i = 0; i < warm; i++) await work();
  const before = inUse();
  for (let i = 0; i < runs; i++) await work();
  return inUse() - before;
}

// two generated pages, at 0.7 of their size (the analysis takes seconds a page): one on its own,
// one analysed smaller than that, and both stacked as a webtoon strip (two slices)
const pages = [3, 11].map((seed) => makePage(seed)), K = 0.7;
const canvasOf = (pg) => {
  const full = createCanvas(pg.W, pg.H); full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pg.input.data), pg.W, pg.H), 0, 0);
  const c = createCanvas(Math.round(pg.W * K), Math.round(pg.H * K)); c.getContext("2d").drawImage(full, 0, 0, c.width, c.height);
  return c;
};
const strip = (() => { const [a, b] = pages.map(canvasOf), c = createCanvas(a.width, a.height + b.height), x = c.getContext("2d"); x.drawImage(a, 0, 0); x.drawImage(b, 0, a.height); return c; })();
// (useGpu as by default: changing it reloads the models, which the tests gave as files; Node has no
// graphics card, so they run on the CPU either way)
const SETTINGS = { maxLongEdge: 1600, stripWidth: 1000, sliceHeight: 1800, useGpu: true };
// a translation for every numbered bubble, as Claude answers
const answer = (job) => job.slices.map((s) => ({ items: s.analysis.regions.map((r) => ({ tag: r.id, text: "Where did you put the key? I looked everywhere.", kind: "bubble" })) }));

/** A page the way the worker translates one: analysis, the fills done while Claude answers, then the finish. */
async function translate(bitmap, settings) {
  const job = await preparePage(bitmap, settings);
  await prefillPage(job, { natural: bitmap });
  const done = await finishPage(job, answer(job), { natural: bitmap, learned: false });
  assert.ok(done.patches.length, "the page was erased");
  assert.notEqual(done.engine, "heuristic", "the page was analysed with the models, as in the extension");
}

await test("an OpenCV failure reaches the caller as an Error that names OpenCV and its memory", async () => {
  // what OpenCV throws: a C++ exception, as a bare number (an area outside its image here)
  let thrown;
  const m = new cv.Mat(4, 4, cv.CV_8UC1);
  try { m.roi(new cv.Rect(0, 0, 10, 10)); } catch (e) { thrown = e; } finally { m.delete(); }
  assert.equal(typeof thrown, "number");
  const err = engineError(thrown);
  assert.ok(err instanceof Error);
  assert.match(err.message, /^Gytakusub: OpenCV failed \(exception \d+; its memory at \d+ MB\)$/);
  assert.equal(err.code, "opencv");
  // anything else is passed on as it was (a cancelled page, the engine's own errors)
  const own = new Error("Gytakusub: this image has no part 3");
  assert.equal(engineError(own), own);
  // and a page step that fails inside OpenCV gives its caller that Error (OpenCV made to fail as above)
  const cvtColor = cv.cvtColor;
  cv.cvtColor = () => { throw thrown; };
  try {
    const img = new ImageData(8, 8), job = { scale: 1, slices: [{ imageData: img, analysis: { W: 8, H: 8, regions: [{ id: 1, kind: "bubble", box: { x: 0, y: 0, w: 8, h: 8 } }] } }] };
    await assert.rejects(prefillPage(job), (e) => e instanceof Error && e.code === "opencv" && e.message.includes(String(thrown)));
  } finally { cv.cvtColor = cvtColor; }
});

await test("a page analysed at its own size frees all it used", async () => {
  const moved = await growth(() => translate(drawable(canvasOf(pages[0])), SETTINGS));
  assert.ok(moved < 1, `the heap in use grew by ${moved.toFixed(1)} MB over 3 runs`);
});

await test("a page analysed smaller than its own size (full-size patches) frees all it used", async () => {
  const moved = await growth(() => translate(drawable(canvasOf(pages[1])), { ...SETTINGS, maxLongEdge: 700 }));
  assert.ok(moved < 1, `the heap in use grew by ${moved.toFixed(1)} MB over 3 runs`);
});

await test("a webtoon strip (two slices) frees all it used", async () => {
  const moved = await growth(() => translate(drawable(strip), SETTINGS));
  assert.ok(moved < 1, `the heap in use grew by ${moved.toFixed(1)} MB over 3 runs`);
});

// The learned fill needs a model the tests don't load: a stand-in with the same interface hands
// the image back as its fill, so every OpenCV step around the model runs as it does on a real one
// — the model of one size (LaMa: the area seen with the page around it) and the one of any size.
const standIn = (side) => ({
  ort: { Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } } },
  session: { outputNames: ["inpainted"] },
  run: async (session, feeds) => ({ inpainted: { data: feeds.image.data } }),
  ep: "wasm", kind: side ? "lama" : "aot", ...(side ? { side } : {}),
});

await test("the learned fill, of either kind, frees all it used", async () => {
  const page = canvasOf(pages[0]), img = page.getContext("2d").getImageData(0, 0, page.width, page.height);
  const job = await preparePage(drawable(page), SETTINGS);
  const an = job.slices[0].analysis, ids = new Set(an.regions.map((r) => r.id));
  try {
    for (const side of [512, 0]) {
      const model = standIn(side);
      let filled = 0;
      const moved = await growth(async () => {
        const er = erase(cv, img, an, ids, { keepMask: true, outline: 0.3 });
        try {
          for (const r of er.rois) if (r.fill !== "texture") r.fill = "texture"; // every area through the model
          await fillTexture(cv, model, er.image, er, { side });
          filled = er.rois.filter((r) => r.filled === "learned").length;
          for (const r of er.rois.slice(0, 3)) {
            const nat = new ImageData(new Uint8ClampedArray(r.w * r.h * 4).fill(255), r.w, r.h);
            await eraseFullSize(cv, nat, r.x, r.y, er.mask, 1, 0, 0, r, model, er.surface, null, side ? { image: img, x: r.x, y: r.y, side } : null);
          }
        } finally { er.mask.delete(); er.surface.delete(); }
      });
      assert.ok(filled > 0, "areas went through the model");
      assert.ok(moved < 1, `the heap in use grew by ${moved.toFixed(1)} MB over 3 runs (${model.kind})`);
    }
  } finally { an.dispose(); }
});

await test("OpenCV's maximum is the vendored build's", async () => {
  const m = /"maximum":(\d+)\/WASM_PAGE_SIZE/.exec(fs.readFileSync(new URL("../extension/vendor/opencv.js", import.meta.url), "utf8"));
  assert.ok(m, "the build states its maximum");
  assert.equal(Number(m[1]), OPENCV_MAX);
});

// (last: the pages after it run on another OpenCV than the one the tests above share)
await test("OpenCV out of memory: the page fails saying so, and the next page starts a fresh OpenCV", async () => {
  // its memory taken up to all it can have (as by something left behind, page after page)
  const taken = [];
  for (const side of [2048, 256, 32]) try { for (;;) taken.push(new cv.Mat(side, side, cv.CV_8UC4)); } catch (e) { assert.equal(typeof e, "number"); }
  assert.equal(cv.HEAPU8.length, OPENCV_MAX);
  await assert.rejects(translate(drawable(canvasOf(pages[0])), SETTINGS), (e) => e.code === "opencv" && /its memory at 1024 MB, all it can have/.test(e.message));
  await translate(drawable(canvasOf(pages[0])), SETTINGS);
  const fresh = await getCV();
  assert.notEqual(fresh, cv, "a fresh OpenCV");
  assert.ok(fresh.HEAPU8.length < OPENCV_MAX);
  for (const m of taken) m.delete();
});

console.log(`${passed} passed`);
