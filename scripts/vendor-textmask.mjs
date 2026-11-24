#!/usr/bin/env node
// Downloads the text-mask model (comic-text-mask, TareHimself: a U-Net on a ResNet-18 trained on
// comic text crops, MIT) at a pinned revision, checks its files' sha256, and writes
// extension/vendor/textmask.onnx and its record textmask.json. The ONNX graph is built from the
// published weights by scripts/textmask-onnx.py (numpy and onnx alone; float16 weights computed in
// float32).
//
//   node scripts/vendor-textmask.mjs           download and vendor (python3 with onnx and numpy)
//   node scripts/vendor-textmask.mjs --check   the vendored file matches its record
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "extension", "vendor");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const REPO = "TareHimself/comic-text-mask", REV = "ebd37f1a9ae9298519678fb96a796573fb602977";
const FILES = {
  "model.safetensors": "ab28dd8450462c4f87ddfd05d13601813bb90414f26bea5590bf6a0a7540f988",
  "config.json": null, // (checked by textmask-onnx.py: a U-Net on resnet18, the decoder it builds)
  "tm_meta.json": null, // the authors' crop size and threshold, copied into the record
};

if (process.argv.includes("--check")) {
  const info = JSON.parse(fs.readFileSync(path.join(vendor, "textmask.json"), "utf8"));
  const got = sha(fs.readFileSync(path.join(vendor, "textmask.onnx")));
  if (got !== info.sha256) { console.error(`textmask.onnx: sha256 ${got} does not match its record ${info.sha256}`); process.exit(1); }
  console.log(`textmask.onnx: matches its record (${info.source})`);
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "gyt-textmask-"));
try {
  const ups = {};
  for (const [name, want] of Object.entries(FILES)) {
    const file = path.join(tmp, name);
    execFileSync("curl", ["-sSfL", "--max-time", "600", "-o", file, `https://huggingface.co/${REPO}/resolve/${REV}/${name}`]);
    ups[name] = sha(fs.readFileSync(file));
    if (want && ups[name] !== want) throw new Error(`${name}: sha256 ${ups[name]} is not the pinned ${want}`);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(tmp, "tm_meta.json"), "utf8"));
  const out = path.join(vendor, "textmask.onnx");
  execFileSync("python3", ["-I", path.join(root, "scripts", "textmask-onnx.py"), tmp, out], { stdio: "inherit" });
  const bytes = fs.readFileSync(out);
  const info = {
    source: `https://huggingface.co/${REPO}/tree/${REV}`,
    upstreamSha256: ups["model.safetensors"],
    made: "scripts/textmask-onnx.py",
    license: "MIT",
    what: "comic-text-mask: text vs not-text per pixel of a text region's crop; a U-Net on a ResNet-18, float16 weights",
    inputSize: meta.imgsz,
    threshold: meta.threshold,
    bytes: bytes.length,
    sha256: sha(bytes),
  };
  fs.writeFileSync(path.join(vendor, "textmask.json"), JSON.stringify(info, null, 2) + "\n");
  console.log(`vendored textmask.onnx (${(bytes.length / 1e6).toFixed(1)} MB) from ${REPO}@${REV.slice(0, 7)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
