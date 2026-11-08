// Vendors the PP-OCRv4 text detector (PaddleOCR, Apache-2.0) from the
// @gutenye/ocr-models npm package into extension/vendor/ppocr-det.onnx, with
// HardSigmoid rewritten as Mul/Add/Clip so OpenCV 4.5's dnn can run it.
// Requires python3 with the `onnx` package (pip install onnx).
//   node scripts/vendor-detector.mjs   (run from tests/ after npm install)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "tests", "node_modules", "@gutenye", "ocr-models");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const src = path.join(pkgDir, "assets", "ch_PP-OCRv4_det_infer.onnx");
const out = path.join(root, "extension", "vendor", "ppocr-det.onnx");
const py = `
import onnx, numpy as np, sys
from onnx import helper, numpy_helper
m = onnx.load(sys.argv[1]); g = m.graph
nodes, consts, k = [], [], 0
for n in g.node:
    if n.op_type != 'HardSigmoid': nodes.append(n); continue
    alpha, beta = 0.2, 0.5
    for a in n.attribute:
        if a.name == 'alpha': alpha = a.f
        if a.name == 'beta': beta = a.f
    x, y = n.input[0], n.output[0]
    names = [f'hs_{t}_{k}' for t in ('alpha', 'beta', 'zero', 'one')]
    for name, v in zip(names, (alpha, beta, 0.0, 1.0)): consts.append(numpy_helper.from_array(np.array(v, dtype=np.float32), name))
    nodes.append(helper.make_node('Mul', [x, names[0]], [f'hs_mul_{k}']))
    nodes.append(helper.make_node('Add', [f'hs_mul_{k}', names[1]], [f'hs_add_{k}']))
    nodes.append(helper.make_node('Clip', [f'hs_add_{k}', names[2], names[3]], [y]))
    k += 1
del g.node[:]; g.node.extend(nodes); g.initializer.extend(consts)
onnx.checker.check_model(m); onnx.save(m, sys.argv[2]); print('rewrote', k, 'HardSigmoid nodes')
`;
execFileSync("python3", ["-I", "-c", py, src, out], { stdio: "inherit" });
const info = { source: "@gutenye/ocr-models@" + pkg.version, model: "ch_PP-OCRv4_det_infer.onnx (PaddleOCR, Apache-2.0)", rewrite: "HardSigmoid → Mul/Add/Clip", bytes: fs.statSync(out).size };
fs.writeFileSync(path.join(root, "extension", "vendor", "ppocr-det.json"), JSON.stringify(info, null, 2) + "\n");
console.log("vendored", out, info.bytes, "bytes");
