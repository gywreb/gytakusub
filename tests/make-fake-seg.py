#!/usr/bin/env python3
"""Builds a stand-in segmentation model with the output layout of a YOLOv8-seg
export (output0 [1, 4+nc+32, N], output1 [1, 32, S/4, S/4]) whose outputs are
constants describing the bubbles of a ground-truth page. It exercises the
whole inference path in engine/segment.js — letterboxing, decoding, NMS, mask
reconstruction, mapping back to page pixels — without the real weights, which
are not redistributable from here. Not a detector: it ignores its input.

    python3 make-fake-seg.py fixtures/demo-page.png fixtures/demo-truth.json fixtures/fake-seg.onnx [--e2e]

--e2e writes the end-to-end row layout instead (output0 [1, N, 6+32]).
"""
import json
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from PIL import Image

page, truth_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
e2e = "--e2e" in sys.argv
S, K = 640, 32
W, H = Image.open(page).size
r = min(S / W, S / H)
nw, nh = round(W * r), round(H * r)
dx, dy = (S - nw) // 2, (S - nh) // 2
mh = mw = S // 4

truth = [t for t in json.load(open(truth_path)) if t["kind"] == "bubble"]
assert len(truth) <= K, "one prototype per bubble"

# prototypes: one per bubble, +6 inside the shape, -6 outside; the rest zero
protos = np.full((1, K, mh, mw), -6.0, dtype=np.float32)
yy, xx = np.mgrid[0:mh, 0:mw]
# grid cell centre → page pixel
px = ((xx + 0.5) * (S / mw) - dx) / r
py = ((yy + 0.5) * (S / mh) - dy) / r
dets = []
for i, t in enumerate(truth):
    x, y, w, h = t["box"]
    shape = t.get("shape", "ellipse")
    cx, cy = x + w / 2, y + h / 2
    if shape in ("ellipse", "jagged", "joined"):
        inside = ((px - cx) / (w / 2)) ** 2 + ((py - cy) / (h / 2)) ** 2 <= 1
    else:
        inside = (px >= x) & (px <= x + w) & (py >= y) & (py <= y + h)
    protos[0, i][inside] = 6.0
    # box in model-input pixels
    bx1, by1, bx2, by2 = x * r + dx, y * r + dy, (x + w) * r + dx, (y + h) * r + dy
    coefs = np.zeros(K, dtype=np.float32); coefs[i] = 1.0
    dets.append((bx1, by1, bx2, by2, 0.9 - 0.01 * i, coefs))

nc = 1
if e2e:
    N = 300
    rows = np.zeros((1, N, 6 + K), dtype=np.float32)
    for i, (x1, y1, x2, y2, score, coefs) in enumerate(dets):
        rows[0, i, :6] = [x1, y1, x2, y2, score, 0]
        rows[0, i, 6:] = coefs
    out0 = rows
else:
    N = 8400
    arr = np.zeros((1, 4 + nc + K, N), dtype=np.float32)
    # each bubble appears twice (two anchors) so NMS has something to do
    for i, (x1, y1, x2, y2, score, coefs) in enumerate(dets):
        for j, jitter in enumerate((0.0, 1.5)):
            a = i * 2 + j
            arr[0, 0:4, a] = [(x1 + x2) / 2 + jitter, (y1 + y2) / 2, x2 - x1, y2 - y1]
            arr[0, 4, a] = score - 0.05 * j
            arr[0, 5:, a] = coefs
    out0 = arr

images = helper.make_tensor_value_info("images", TensorProto.FLOAT, [1, 3, S, S])
o0 = helper.make_tensor_value_info("output0", TensorProto.FLOAT, list(out0.shape))
o1 = helper.make_tensor_value_info("output1", TensorProto.FLOAT, list(protos.shape))
nodes = [
    helper.make_node("Constant", [], ["output0"], value=numpy_helper.from_array(out0, "c0")),
    helper.make_node("Constant", [], ["output1"], value=numpy_helper.from_array(protos, "c1")),
    # consume the input so the graph is well-formed
    helper.make_node("Shape", ["images"], ["unused_shape"]),
]
unused = helper.make_tensor_value_info("unused_shape", TensorProto.INT64, [4])
graph = helper.make_graph(nodes, "fake_seg", [images], [o0, o1, unused])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="gytakusub-tests")
model.ir_version = 8
onnx.checker.check_model(model)
onnx.save(model, out)
print(f"wrote {out}: {len(dets)} bubbles, layout {'end-to-end' if e2e else 'yolov8'}, input {S}")
