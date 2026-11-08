import fs from "node:fs";
import { createCanvas, loadImage } from "canvas";
import { cv, detector } from "../cv-node.mjs";
import { detectText } from "../../extension/engine/detect.js";
import { getOrt } from "../../extension/engine/ort.js";
const img = await loadImage(process.argv[2]); const W = 850, H = 1200;
const c = createCanvas(W, H), ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, W, H);
const id = ctx.getImageData(0, 0, W, H);
// OpenCV dnn
let t0 = Date.now(); let lines; for (let i = 0; i < 3; i++) lines = detectText(cv, detector, id); console.log("cv.dnn x3:", Date.now() - t0, "ms, lines", lines.length);
// ORT
const ort = getOrt({ wasmBinary: fs.readFileSync("../extension/vendor/ort/ort-wasm-simd-threaded.wasm").buffer });
const bytes = new Uint8Array(fs.readFileSync("../extension/vendor/ppocr-det.onnx"));
const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
console.log("inputs", s.inputNames, "outputs", s.outputNames);
const maxSide = 960, scale = Math.min(1, maxSide / Math.max(W, H));
const w = Math.round((W * scale) / 32) * 32, h = Math.round((H * scale) / 32) * 32;
const rc = createCanvas(w, h); rc.getContext("2d").drawImage(img, 0, 0, w, h); const rd = rc.getContext("2d").getImageData(0, 0, w, h).data;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225]; const plane = w * h, data = new Float32Array(3 * plane);
for (let i = 0; i < plane; i++) for (let ch = 0; ch < 3; ch++) data[ch * plane + i] = (rd[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
const tensor = new ort.Tensor("float32", data, [1, 3, h, w]);
await s.run({ [s.inputNames[0]]: tensor }); // warm
t0 = Date.now(); let out; for (let i = 0; i < 3; i++) out = await s.run({ [s.inputNames[0]]: tensor }); console.log("ort wasm x3:", Date.now() - t0, "ms", out[s.outputNames[0]].dims);
