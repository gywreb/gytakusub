#!/usr/bin/env python3
"""Two int8 variants of a YOLO-seg ONNX export, one per ONNX Runtime backend
(the pattern transformers.js uses: quantised for wasm, float compute for WebGPU):

  CPU (wasm):  static int8 QDQ, activations and weights, calibrated on real
               pages; ORT fuses it into integer convolutions — fastest on CPU.
  GPU (WebGPU): weight-only int8 — Conv weights stored as int8 per output
               channel behind a DequantizeLinear, activations float. ORT's
               WebGPU backend has no QuantizeLinear kernel, so the QDQ model
               would bounce ~300 nodes to the CPU on every run; this one runs
               entirely on the GPU (only shape arithmetic stays on the CPU, and
               --static removes most of that). Also the smaller file.

Preprocessing for calibration mirrors engine/segment.js (letterbox to the
square input, RGB, 0..1, grey-114 padding).

    pip install onnxruntime onnx pillow numpy
    python3 scripts/quantize-segment.py model.onnx cpu.onnx --pages <dir with page images> [--input 512] [--max 60]
    python3 scripts/quantize-segment.py model.onnx gpu.onnx --weights-only [--static 512]

Then: node scripts/vendor-segment.mjs cpu.onnx --gpu gpu.onnx --source ... --license ...
and measure (ADR 0004) before choosing.
"""
import argparse
import glob
import os

import numpy as np
import onnx
from onnxruntime.quantization import CalibrationDataReader, CalibrationMethod, QuantFormat, QuantType, quantize_static
from onnxruntime.quantization.shape_inference import quant_pre_process
from PIL import Image


def letterbox(path, size):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    r = min(size / w, size / h)
    nw, nh = max(1, round(w * r)), max(1, round(h * r))
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(im.resize((nw, nh), Image.BILINEAR), ((size - nw) // 2, (size - nh) // 2))
    arr = np.asarray(canvas, dtype=np.float32) / 255.0
    return np.transpose(arr, (2, 0, 1))[None]  # NCHW


class Pages(CalibrationDataReader):
    def __init__(self, files, input_name, size):
        self.files, self.input_name, self.size, self.i = files, input_name, size, 0

    def get_next(self):
        if self.i >= len(self.files):
            return None
        x = letterbox(self.files[self.i], self.size)
        self.i += 1
        return {self.input_name: x}

    def rewind(self):
        self.i = 0


def weights_only(src, dst, static):
    """Conv weights → int8 per output channel + DequantizeLinear (axis 0); everything else untouched."""
    from onnx import helper, numpy_helper
    m = onnx.load(src)
    if all(o.version < 13 for o in m.opset_import if o.domain in ("", "ai.onnx")):
        raise SystemExit("per-axis DequantizeLinear needs opset >= 13")
    g = m.graph
    inits = {i.name: i for i in g.initializer}
    dq, n = [], 0
    for node in g.node:
        if node.op_type != "Conv" or node.input[1] not in inits:
            continue
        name = node.input[1]
        w = numpy_helper.to_array(inits[name]).astype(np.float32)
        flat = w.reshape(w.shape[0], -1)
        scale = (np.maximum(np.abs(flat).max(axis=1), 1e-12) / 127.0).astype(np.float32)
        q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8).reshape(w.shape)
        g.initializer.remove(inits[name])
        g.initializer.extend([numpy_helper.from_array(q, name + "_q"), numpy_helper.from_array(scale, name + "_s"),
                              numpy_helper.from_array(np.zeros(w.shape[0], np.int8), name + "_z")])
        dq.append(helper.make_node("DequantizeLinear", [name + "_q", name + "_s", name + "_z"], [name], name=name + "_dq", axis=0))
        n += 1
    nodes = dq + list(g.node)  # producers before consumers
    del g.node[:]
    g.node.extend(nodes)
    if static:
        dims = g.input[0].type.tensor_type.shape.dim
        for d, v in zip(dims, (1, 3, static, static)):
            d.ClearField("dim_param")
            d.dim_value = v
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print(f"weight-only int8: {n} Conv weights; {os.path.getsize(src) / 1e6:.1f} MB → {os.path.getsize(dst) / 1e6:.1f} MB" + (f"; input fixed at {static}" if static else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--weights-only", action="store_true", help="GPU variant: int8 weights, float activations (no calibration)")
    ap.add_argument("--static", type=int, default=0, help="with --weights-only: fix the input to N×N")
    ap.add_argument("--pages", help="directory of calibration page images (jpg/png); required for the CPU variant")
    ap.add_argument("--input", type=int, default=0, help="square input size (0 = read from the model, else 640)")
    ap.add_argument("--max", type=int, default=60, help="calibration images to use")
    a = ap.parse_args()
    if a.weights_only:
        return weights_only(a.src, a.dst, a.static)
    if not a.pages:
        raise SystemExit("--pages is required for the CPU (QDQ) variant")

    model = onnx.load(a.src)
    inp = model.graph.input[0]
    name = inp.name
    dims = [d.dim_value for d in inp.type.tensor_type.shape.dim]
    size = a.input or (dims[2] if len(dims) == 4 and dims[2] > 0 else 640)
    files = sorted(f for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp") for f in glob.glob(os.path.join(a.pages, ext)))[: a.max]
    if not files:
        raise SystemExit(f"no page images in {a.pages}")
    print(f"input {name} {dims} → calibrating at {size}×{size} on {len(files)} pages")

    pre = a.dst + ".pre.onnx"
    quant_pre_process(a.src, pre, skip_symbolic_shape=True)  # shape inference + optimisation for quantisation
    # The detection head (Ultralytics names it model.<last>) decodes boxes with a
    # softmax over distance bins and scales them by the stride: int8 there loses
    # the detections entirely, so it stays float. The backbone and neck carry the
    # weight and are quantised per channel.
    pm = onnx.load(pre)
    last = max(int(n.name.split("/")[1].split(".")[1]) for n in pm.graph.node if n.name.startswith("/model.") and n.name.split("/")[1].split(".")[1].isdigit())
    exclude = [n.name for n in pm.graph.node if n.name.startswith(f"/model.{last}/")]
    print(f"keeping the head (/model.{last}/, {len(exclude)} nodes) in float")
    quantize_static(
        pre, a.dst, Pages(files, name, size),
        quant_format=QuantFormat.QDQ, per_channel=True, reduce_range=False,
        activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8,
        calibrate_method=CalibrationMethod.MinMax, nodes_to_exclude=exclude,
    )
    os.remove(pre)
    print(f"wrote {a.dst}: {os.path.getsize(a.src) / 1e6:.1f} MB → {os.path.getsize(a.dst) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
