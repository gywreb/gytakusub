// Vendors the learned eraser's models into extension/vendor/, recording where they came from:
//   inpaint.onnx  AOT-GAN inpainting (manga), float32, any size (multiples of 8): the fill on the CPU
//   lama.onnx     LaMa finetuned on manga and anime, fixed at 512 × 512, float16 weights (computes in
//                 float32): the fill on a graphics card (ADR 0015); made by scripts/lama-static.py
// Downloaded at pinned Hugging Face revisions and checked against their sha256.
//
//   node scripts/vendor-inpaint.mjs           download and vendor (lama.onnx needs python3 with onnx, onnxsim, numpy)
//   node scripts/vendor-inpaint.mjs --check   the vendored files match their records
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "extension", "vendor");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const MODELS = {
  inpaint: {
    repo: "lemondouble/lemon-manga-translator", rev: "e8c08f38f188db684fdc32c4cf88627c7df92096",
    out: "inpaint.onnx", src: "onnx/aot-inpainting/aot_folded.onnx", sha256: "e0d8f438ca9567eccc9d358963427601b6f64a650cbe6189ec82fc43830a0390",
    license: "GPL-3.0", what: "AOT-GAN inpainting trained on manga (float32)",
  },
  lama: {
    repo: "ogkalu/lama-manga-onnx-dynamic", rev: "ee4ed4a8447b6730fc41d34f90876b6c48af925a",
    out: "lama.onnx", src: "lama-manga-dynamic.onnx", sha256: "de31ffa5ba26916b8ea35319f6c12151ff9654d4261bccf0583a69bb095315f9",
    license: "Apache-2.0 (the ONNX export; LaMa: Apache-2.0; the manga weights, dreMaz/AnimeMangaInpainting: MIT)",
    what: "LaMa finetuned on 300k manga and anime images, fixed at 512 x 512, float16 weights",
    convert: (src, dst) => execFileSync("python3", [path.join(root, "scripts", "lama-static.py"), src, dst, "--side", "512"], { stdio: "inherit" }),
  },
};

if (process.argv.includes("--check")) {
  let bad = 0;
  for (const name of Object.keys(MODELS)) {
    const rec = path.join(vendor, MODELS[name].out.replace(/\.onnx$/, ".json"));
    if (!fs.existsSync(rec)) { bad++; console.error(`${MODELS[name].out}: no record`); continue; }
    const info = JSON.parse(fs.readFileSync(rec, "utf8"));
    const got = sha(fs.readFileSync(path.join(vendor, MODELS[name].out)));
    if (got !== info.sha256) { bad++; console.error(`${MODELS[name].out}: sha256 ${got} does not match its record ${info.sha256}`); }
    else console.log(`${MODELS[name].out}: matches its record (${info.source})`);
  }
  process.exit(bad ? 1 : 0);
}

const want = process.argv.slice(2).filter((a) => MODELS[a]);
if (!want.length) want.push(...Object.keys(MODELS));
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "gyt-models-"));
for (const name of want) {
  const m = MODELS[name];
  const url = `https://huggingface.co/${m.repo}/resolve/${m.rev}/${m.src}`;
  const file = path.join(tmp, path.basename(m.src));
  execFileSync("curl", ["-sSfL", "--max-time", "900", "-o", file, url]);
  const upstream = fs.readFileSync(file);
  const upSha = sha(upstream);
  if (!upSha.startsWith(m.sha256)) throw new Error(`${m.src}: sha256 ${upSha} is not the pinned ${m.sha256}`);
  if (m.convert) m.convert(file, path.join(vendor, m.out)); else fs.writeFileSync(path.join(vendor, m.out), upstream);
  const bytes = fs.readFileSync(path.join(vendor, m.out));
  const info = { source: `https://huggingface.co/${m.repo}/blob/${m.rev}/${m.src}`, upstreamSha256: upSha, ...(m.convert ? { made: "scripts/lama-static.py --side 512" } : {}), license: m.license, what: m.what, bytes: bytes.length, sha256: sha(bytes) };
  fs.writeFileSync(path.join(vendor, m.out.replace(/\.onnx$/, ".json")), JSON.stringify(info, null, 2) + "\n");
  console.log(`vendored ${m.out} (${(bytes.length / 1e6).toFixed(1)} MB) from ${m.repo}@${m.rev.slice(0, 7)}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
