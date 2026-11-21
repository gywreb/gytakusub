// The independent witness: comic-translate's text and bubble detector (RT-DETR-v2,
// ogkalu/comic-text-and-bubble-detector, Apache-2.0), trained by others on many series. It is not
// part of the engine, so what it sees on a page is a check the engine's own rules can't bend.
// Run as comic-translate runs it: the page resized to 640 × 640, boxes back in page pixels.
import fs from "node:fs";
import { createCanvas } from "canvas";
import { getOrt, createSession, run as ortRun } from "../../extension/engine/ort.js";

// The model file is not in the repository: download it (docs/QUALITY.md) into bench/models/, or
// name it in GYT_WITNESS.
export const WITNESS_FILE = process.env.GYT_WITNESS || new URL("./models/comic-text-and-bubble-detector.onnx", import.meta.url).pathname;

let session = null;
export async function loadWitness(file = WITNESS_FILE) {
  if (!session) session = (await createSession(new Uint8Array(fs.readFileSync(file)), { gpu: false })).session;
  return session;
}

/** Boxes on an ImageData: { text: [...], bubbles: [...] } ({x, y, w, h}, page pixels; score ≥ 0.3). */
export async function witness(img) {
  const s = await loadWitness();
  const { width: W, height: H } = img;
  const c = createCanvas(W, H); c.getContext("2d").putImageData(img, 0, 0);
  const t = createCanvas(640, 640), tx = t.getContext("2d"); tx.drawImage(c, 0, 0, 640, 640);
  const d = tx.getImageData(0, 0, 640, 640).data, n = 640 * 640, a = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) a[k * n + i] = d[i * 4 + k] / 255;
  const ort = getOrt();
  const o = await ortRun(s, { images: new ort.Tensor("float32", a, [1, 3, 640, 640]), orig_target_sizes: new ort.Tensor("int64", BigInt64Array.from([BigInt(W), BigInt(H)]), [1, 2]) });
  const text = [], bubbles = [], b = o.boxes.data;
  for (let i = 0; i < o.scores.data.length; i++) {
    if (o.scores.data[i] < 0.3) continue;
    const box = { x: b[i * 4], y: b[i * 4 + 1], w: b[i * 4 + 2] - b[i * 4], h: b[i * 4 + 3] - b[i * 4 + 1] };
    (Number(o.labels.data[i]) === 0 ? bubbles : text).push(box); // classes: 0 bubble, 1 text in a bubble, 2 text outside
  }
  return { text, bubbles };
}
