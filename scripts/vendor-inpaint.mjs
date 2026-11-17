// Vendors the learned eraser's model into extension/vendor/, recording where it came from:
//   inpaint.onnx  AOT-GAN inpainting (manga), float32, any size (multiples of 8): the fill
// Downloaded at a pinned Hugging Face revision and checked against its sha256.
//
//   node scripts/vendor-inpaint.mjs           download and vendor
//   node scripts/vendor-inpaint.mjs --check   the vendored file matches its record
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "extension", "vendor");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const REPO = "lemondouble/lemon-manga-translator";
const REV = "e8c08f38f188db684fdc32c4cf88627c7df92096";
const MODELS = {
  inpaint: {
    out: "inpaint.onnx", src: "onnx/aot-inpainting/aot_folded.onnx", sha256: "e0d8f438ca9567eccc9d358963427601b6f64a650cbe6189ec82fc43830a0390",
    license: "GPL-3.0", what: "AOT-GAN inpainting trained on manga (float32)",
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

const want = Object.keys(MODELS);
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "gyt-models-"));
for (const name of want) {
  const m = MODELS[name];
  const url = `https://huggingface.co/${REPO}/resolve/${REV}/${m.src}`;
  const file = path.join(tmp, path.basename(m.src));
  execFileSync("curl", ["-sSfL", "--max-time", "900", "-o", file, url]);
  const upstream = fs.readFileSync(file);
  const upSha = sha(upstream);
  if (!upSha.startsWith(m.sha256)) throw new Error(`${m.src}: sha256 ${upSha} is not the pinned ${m.sha256}`);
  const bytes = upstream;
  fs.writeFileSync(path.join(vendor, m.out), bytes);
  const info = { source: `https://huggingface.co/${REPO}/blob/${REV}/${m.src}`, upstreamSha256: upSha, license: m.license, what: m.what, bytes: bytes.length, sha256: sha(bytes) };
  fs.writeFileSync(path.join(vendor, m.out.replace(/\.onnx$/, ".json")), JSON.stringify(info, null, 2) + "\n");
  console.log(`vendored ${m.out} (${(bytes.length / 1e6).toFixed(1)} MB) from ${REPO}@${REV.slice(0, 7)}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
