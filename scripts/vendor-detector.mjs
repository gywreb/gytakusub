// Vendors the PaddleOCR PP-OCRv6 text detector (Apache-2.0) as
// extension/vendor/ppocr-det.onnx + ppocr-det.json, rewritten so that both
// runtimes the extension uses can load it: ONNX Runtime (the default) and
// OpenCV 4.5's dnn module (the fallback when ONNX Runtime has failed), which
// lacks HardSigmoid and Erf and cannot infer shapes through a ReduceMean or a
// MaxPool with auto_pad. The rewrites are exact except Erf, which becomes the
// tanh form of GELU (|error| < 1e-3 on the probability map).
//
// The model is not fetched by this script (Hugging Face is not reachable from
// the build environment); download it by hand from the pinned revision and pass
// the file in:
//   https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/resolve/28fe5895c24fd108c19eb3e8479f4ab385fbfc62/inference.onnx
//   node scripts/vendor-detector.mjs inference.onnx --source "PaddlePaddle/PP-OCRv6_small_det_onnx@28fe5895c24fd108c19eb3e8479f4ab385fbfc62"
// Requires python3 with the `onnx` package (pip install onnx).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && a.endsWith(".onnx"));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (!file || !opt("--source")) { console.error("usage: node scripts/vendor-detector.mjs <inference.onnx> --source <repo@revision>"); process.exit(2); }
const out = path.join(root, "extension", "vendor", "ppocr-det.onnx");
const py = `
import onnx, numpy as np, sys
from onnx import helper, numpy_helper
m = onnx.load(sys.argv[1]); g = m.graph
nodes, consts, counts = [], [], {}
def c(name, v):
    consts.append(numpy_helper.from_array(np.array(v, dtype=np.float32), name)); return name
def attr(n, name, default=None):
    for a in n.attribute:
        if a.name == name: return helper.get_attribute_value(a)
    return default
for k, n in enumerate(g.node):
    op = n.op_type
    if op == 'HardSigmoid':
        x, y = n.input[0], n.output[0]
        nodes.append(helper.make_node('Mul', [x, c(f'hs_a_{k}', attr(n, 'alpha', 0.2))], [f'hs_mul_{k}']))
        nodes.append(helper.make_node('Add', [f'hs_mul_{k}', c(f'hs_b_{k}', attr(n, 'beta', 0.5))], [f'hs_add_{k}']))
        nodes.append(helper.make_node('Clip', [f'hs_add_{k}', c(f'hs_z_{k}', 0.0), c(f'hs_o_{k}', 1.0)], [y]))
    elif op == 'Erf':
        # erf(z) ~ tanh(2/sqrt(pi) * z * (1 + 0.08943 z^2)): GELU's tanh form
        x, y = n.input[0], n.output[0]
        nodes.append(helper.make_node('Mul', [x, x], [f'erf_sq_{k}']))
        nodes.append(helper.make_node('Mul', [f'erf_sq_{k}', c(f'erf_c3_{k}', 0.044715 * 2)], [f'erf_t_{k}']))
        nodes.append(helper.make_node('Add', [f'erf_t_{k}', c(f'erf_one_{k}', 1.0)], [f'erf_p_{k}']))
        nodes.append(helper.make_node('Mul', [x, f'erf_p_{k}'], [f'erf_q_{k}']))
        nodes.append(helper.make_node('Mul', [f'erf_q_{k}', c(f'erf_c1_{k}', 2 / np.sqrt(np.pi))], [f'erf_r_{k}']))
        nodes.append(helper.make_node('Tanh', [f'erf_r_{k}'], [y]))
    elif op == 'ReduceMean' and list(attr(n, 'axes', [])) == [2, 3] and attr(n, 'keepdims', 1) == 1:
        nodes.append(helper.make_node('GlobalAveragePool', [n.input[0]], [n.output[0]], name=n.name))
    elif op == 'MaxPool' and attr(n, 'auto_pad', b'') == b'SAME_UPPER':
        ks, st = list(attr(n, 'kernel_shape')), list(attr(n, 'strides', [1, 1]))
        assert st == [1, 1], st
        pads = [(q - 1) // 2 for q in ks] + [q - 1 - (q - 1) // 2 for q in ks]
        nodes.append(helper.make_node('MaxPool', [n.input[0]], [n.output[0]], name=n.name, kernel_shape=ks, strides=st, pads=pads))
    else:
        nodes.append(n); continue
    counts[op] = counts.get(op, 0) + 1
del g.node[:]; g.node.extend(nodes); g.initializer.extend(consts)
onnx.checker.check_model(m); onnx.save(m, sys.argv[2]); print('rewrote', counts)
`;
execFileSync("python3", ["-c", py, file, out], { stdio: "inherit" });
const src = fs.readFileSync(file), bytes = fs.readFileSync(out);
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const info = {
  source: opt("--source"), license: "Apache-2.0",
  model: "PP-OCRv6 text detection (PaddleOCR)",
  rewrite: "HardSigmoid → Mul/Add/Clip, Erf → tanh form, ReduceMean(H,W) → GlobalAveragePool, MaxPool SAME_UPPER → explicit pads (for OpenCV 4.5 dnn)",
  sourceSha256: sha(src), bytes: bytes.length, sha256: sha(bytes),
  // input size (the page's longest side) and DB post-processing (engine/detect.js): probability threshold, minimum box score, unclip ratio
  post: { maxSide: 960, thresh: 0.3, boxThresh: 0.5, unclip: 1.6 },
};
fs.writeFileSync(path.join(root, "extension", "vendor", "ppocr-det.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`vendored ${path.basename(file)} as extension/vendor/ppocr-det.onnx (${(bytes.length / 1e6).toFixed(1)} MB, sha256 ${info.sha256.slice(0, 12)}…)`);
