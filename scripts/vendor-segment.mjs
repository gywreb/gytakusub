// Vendors a bubble segmentation model (an Ultralytics YOLO-seg ONNX export) as
// extension/vendor/segment.onnx + segment.json, recording where it came from.
// The model files are not fetched by this script: Hugging Face is not reachable
// from the build environment, so the file is downloaded by hand (see
// docs/adr/0004-learned-bubble-segmentation.md) and passed in.
//
//   node scripts/vendor-segment.mjs <model.onnx> --source "<repo or URL>" --license "<SPDX>" [--classes bubble] [--input 640] [--conf 0.25] [--iou 0.45]
//
// One model serves the CPU and the GPU (since 3.0: scripts/quantize-segment.py --weights-only).
// Two variants, one per backend, drew bubbles a few pixels apart, and the same page came out
// differently on each (docs/adr/0020-one-bubble-model.md).
//
// --classes is the comma-separated class list in model order; classes named
// *bubble*/*balloon* are bubbles, classes named *text* (not onomatopoeia) are
// text lines.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && a.endsWith(".onnx"));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (!file || !opt("--source") || !opt("--license")) { console.error("usage: node scripts/vendor-segment.mjs <model.onnx> --source <where it came from> --license <SPDX> [--classes a,b] [--input N] [--conf x] [--iou x]"); process.exit(2); }
const bytes = fs.readFileSync(file);
const out = path.join(root, "extension", "vendor");
fs.copyFileSync(file, path.join(out, "segment.onnx"));
fs.rmSync(path.join(out, "segment-gpu.onnx"), { force: true }); // (the GPU's own variant, until 3.0)
const info = {
  source: opt("--source"), license: opt("--license"), file: path.basename(file), bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  classes: opt("--classes", "bubble").split(",").map((s) => s.trim()),
  inputSize: +opt("--input", 640), conf: +opt("--conf", 0.25), iou: +opt("--iou", 0.45), maskThreshold: 0.5,
};
fs.writeFileSync(path.join(out, "segment.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`vendored ${info.file} (${(bytes.length / 1e6).toFixed(1)} MB, sha256 ${info.sha256.slice(0, 12)}…) as extension/vendor/segment.onnx`);
