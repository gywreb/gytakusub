// A page that fails or is stopped partway leaves nothing behind in OpenCV's memory (2.14.7).
//
// OpenCV's memory is capped and a worker keeps it for its whole life, so what a page leaves there
// adds up (2.14.6: a 121-image episode failed from image 110). 2.14.6 tested pages that go well.
// This makes each page fail at every point it can, one at a time, and checks after each that no
// OpenCV object of the page is still alive (opencv-audit.mjs records every object with the engine
// line that made it). The page is driven as the extension's worker drives one: analysis, the
// fills done while Claude answers (whose failure or stop the finish goes on after), the finish,
// and releasePage() however it went. The failures:
//   - every OpenCV call the engine makes from a line of its own, made to throw once, as OpenCV
//     throws (a bare number: its memory full, a bad size);
//   - a stop at each of the page's checkpoints (a more urgent page, the answer has come);
//   - each run of each model (text detector, bubble model, learned fill) failing once.
// The pages: a generated page at its own size, one analysed smaller than its own size (the
// full-size patches), the learned fill of one size with the page around each area (LaMa, called
// directly: in Node no graphics card loads it), and the two fallbacks when ONNX Runtime fails (the
// text detector on OpenCV's dnn, the analysis without models).
//   node fail-paths.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";
import { bitmapOf, identityInpainter } from "./worker-env.mjs";
import { cv, detector, segmenter } from "./cv-node.mjs";
import { audit } from "./opencv-audit.mjs";
import { getInpainter } from "../extension/engine/cv.js";
import { preparePage, prefillPage, finishPage, releasePage, warmInpainter } from "../extension/engine/index.js";
import { erase, fillTexture, eraseFullSize } from "../extension/engine/erase.js";
import { analyze } from "../extension/engine/analyze.js";
import { loadDetector } from "../extension/engine/detect.js";
import { makePage } from "./bench/synth.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const A = audit(cv);

// The learned fill: a model with its inputs whose fill is the image itself, through ONNX Runtime
// as the real one runs (its result doesn't matter here, only the path to it).
const ortWasm = fs.readFileSync(path.join(here, "../extension/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm")).buffer;
const inpainter = await getInpainter({ modelBytes: identityInpainter(), wasmBinary: ortWasm });
assert.ok(inpainter, "the stand-in learned fill loaded");
await warmInpainter();

// Each model's runs: made to fail on demand, and kept once made (the same page again and again
// asks the same; a run then costs nothing, and a page only its OpenCV work).
const fail = { model: null, at: 0 }, runs = {};
for (const [name, session] of Object.entries({ detector: detector.session, segmenter: segmenter?.session, inpainter: inpainter.session })) {
  if (!session) continue;
  const run = session.run.bind(session), kept = new Map(), ort = detector.ort;
  runs[name] = 0;
  session.run = async (feeds, ...rest) => {
    runs[name]++;
    if (fail.model === name && runs[name] === fail.at) throw new Error(`the ${name} failed (made to)`);
    const h = crypto.createHash("sha1");
    for (const [k, t] of Object.entries(feeds)) h.update(k).update(String(t.dims)).update(Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength));
    const key = h.digest("hex");
    if (!kept.has(key)) kept.set(key, await run(feeds, ...rest));
    return Object.fromEntries(Object.entries(kept.get(key)).map(([k, t]) => [k, new ort.Tensor(t.type, t.data.slice(), t.dims)]));
  };
}

// a generated page at 0.6 of its size (the work is the same at any size; time is not)
const pageOf = (seed, k = 0.6) => {
  const pg = makePage(seed), full = createCanvas(pg.W, pg.H);
  full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pg.input.data), pg.W, pg.H), 0, 0);
  const c = createCanvas(Math.round(pg.W * k), Math.round(pg.H * k));
  c.getContext("2d").drawImage(full, 0, 0, c.width, c.height);
  return bitmapOf(c);
};
const SETTINGS = { maxLongEdge: 1600, stripWidth: 1000, sliceHeight: 1800, useGpu: true };
const answer = (job) => job.slices.map((s) => ({ items: s.analysis.regions.map((r) => ({ tag: r.id, text: "Where did you put the key? I looked everywhere.", kind: "bubble" })) }));
class Cancelled extends Error { name = "Cancelled"; }

/** Checkpoints that count their calls, and throw Cancelled at the `stopAt`-th. */
const checkpoints = { prepare: 0, prefill: 0, stop: null };
const checkpoint = (step) => async () => { checkpoints[step]++; if (checkpoints.stop?.step === step && checkpoints[step] === checkpoints.stop.at) throw new Cancelled(); };

/** A page as the worker does one: whatever fails, the page is released. */
async function translate(bitmap, settings) {
  let job = null;
  try {
    job = await preparePage(bitmap, settings, { checkpoint: checkpoint("prepare") });
    await prefillPage(job, { natural: bitmap, checkpoint: checkpoint("prefill") }).catch(() => {}); // (stopped, or failed: the finish fills what it left)
    await finishPage(job, answer(job), { natural: bitmap });
  } finally { if (job) releasePage(job); }
}

// The learned fill of one size (LaMa), which sees the page around each area, called as the
// finish calls it: a stand-in with LaMa's interface (no ONNX Runtime) hands the image back.
const lama = { ort: detector.ort, session: { outputNames: ["inpainted"] }, run: async (s, feeds) => { runs.lama = (runs.lama || 0) + 1; if (fail.model === "lama" && runs.lama === fail.at) throw new Error("the lama failed (made to)"); return { inpainted: { data: feeds.image.data } }; }, ep: "webgpu", kind: "lama", side: 512 };
async function fillLama(bitmap) {
  const job = await preparePage(bitmap, SETTINGS);
  try {
    const s = job.slices[0], an = s.analysis, img = s.imageData;
    const er = erase(cv, img, an, new Set(an.regions.map((r) => r.id)), { keepMask: true, outline: 0.3 });
    try {
      for (const r of er.rois) r.fill = "texture"; // every area through the model
      await fillTexture(cv, lama, er.image, er, { side: lama.side });
      for (const r of er.rois.slice(0, 2)) {
        const nat = new ImageData(new Uint8ClampedArray(img.data.buffer.slice(0)), img.width, img.height);
        const at = new ImageData(new Uint8ClampedArray(r.w * r.h * 4).fill(200), r.w, r.h);
        await eraseFullSize(cv, at, r.x, r.y, er.mask, 1, 0, 0, r, lama, er.surface, null, { image: nat, x: r.x, y: r.y, side: lama.side });
      }
    } finally { er.mask.delete(); er.surface.delete(); }
  } finally { releasePage(job); }
}

// The worker's fallbacks when ONNX Runtime fails: the text detector on OpenCV's own dnn (loaded
// once, as the worker keeps it), and the analysis without any model; each with its erasing.
const dnn = await loadDetector(cv, new Uint8Array(fs.readFileSync(path.join(here, "../extension/vendor/ppocr-det.onnx"))), { post: detector.post });
A.settle(); // (the detector's network stays, as in the worker)
function analysedWith(bitmap, opts) {
  const c = createCanvas(bitmap.width, bitmap.height); c.getContext("2d").drawImage(bitmap, 0, 0);
  const img = c.getContext("2d").getImageData(0, 0, c.width, c.height), an = analyze(cv, img, opts);
  try { const er = erase(cv, img, an, new Set(an.regions.map((r) => r.id)), { keepMask: true }); er.mask.delete(); er.surface.delete(); }
  finally { an.dispose(); }
}

const page = pageOf(3), colour = pageOf(11);
const cases = [
  ["a page at its own size", () => translate(page, SETTINGS)],
  ["a page analysed smaller (full-size patches)", () => translate(colour, { ...SETTINGS, maxLongEdge: 700 })],
  ["the learned fill of one size, with the page around each area", () => fillLama(page)],
  ["the text detector on OpenCV's dnn", () => analysedWith(page, { detector: dnn })],
  ["the analysis without models", () => analysedWith(page, {})],
];

// counts start again for each run
const fresh = () => { for (const k of Object.keys(runs)) runs[k] = 0; checkpoints.prepare = checkpoints.prefill = 0; };
const attempt = (work) => { fresh(); return Promise.resolve().then(work).catch(() => {}); };

const leaks = [];
const check = (how) => { const left = A.alive(); if (Object.keys(left).length) leaks.push(`${how}: ${JSON.stringify(left)}`); A.settle(); };
const swept = new Set();
let failures = 0;
for (const [name, work] of cases) {
  // as it goes well: every call site, checkpoint and model run on the way
  A.reset(); fresh();
  await work();
  check(`${name}, all well`);
  const sites = [...A.sites().keys()], made = { ...runs }, stops = { prepare: checkpoints.prepare, prefill: checkpoints.prefill };
  // each OpenCV call site failing once (a site the cases before reached is not tried again)
  for (const site of sites) {
    if (swept.has(site)) continue;
    swept.add(site);
    A.failAt(site);
    await attempt(work);
    assert.ok(A.failed(), `${site} was reached again`);
    A.failAt(null); failures++;
    check(`${name}, OpenCV failing at ${site}`);
  }
  // each checkpoint stopping the page
  for (const step of ["prepare", "prefill"]) for (let at = 1; at <= stops[step]; at++) {
    checkpoints.stop = { step, at };
    await attempt(work);
    checkpoints.stop = null; failures++;
    check(`${name}, stopped at ${step} checkpoint ${at}`);
  }
  // each model run failing
  for (const [model, n] of Object.entries(made)) for (let at = 1; at <= n; at++) {
    fail.model = model; fail.at = at;
    await attempt(work);
    fail.model = null; failures++;
    check(`${name}, ${model} run ${at} failing`);
  }
  console.log(`ok - ${name}: ${sites.length} OpenCV call sites, ${stops.prepare + stops.prefill} checkpoints, ${Object.values(made).reduce((a, b) => a + b, 0)} model runs`);
}
assert.deepEqual(leaks, [], `OpenCV objects left alive:\n${leaks.join("\n")}`);
assert.ok(swept.size > 100, `the cases reached ${swept.size} OpenCV call sites`);
console.log(`ok - ${failures} failures, ${swept.size} OpenCV call sites: nothing left alive after any`);
