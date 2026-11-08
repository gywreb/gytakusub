#!/usr/bin/env python3
"""Static int8 quantization of a YOLO-seg ONNX export, calibrated on real pages,
so a ~100 MB fp32 bubble segmenter ships at ~¼ the size and runs faster on
ONNX Runtime's wasm backend. Preprocessing mirrors engine/segment.js
(letterbox to the model's square input, RGB, 0..1, grey-114 padding).

    pip install onnxruntime onnx pillow numpy
    python3 scripts/quantize-segment.py model.onnx model.int8.onnx --pages <dir with page images> [--input 640] [--max 60]

Then: node scripts/vendor-segment.mjs model.int8.onnx --source ... --license ...
and measure (ADR 0004) against the fp32 file before choosing.
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--pages", required=True, help="directory of calibration page images (jpg/png)")
    ap.add_argument("--input", type=int, default=0, help="square input size (0 = read from the model, else 640)")
    ap.add_argument("--max", type=int, default=60, help="calibration images to use")
    a = ap.parse_args()

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
    quantize_static(
        pre, a.dst, Pages(files, name, size),
        quant_format=QuantFormat.QDQ, per_channel=True, reduce_range=False,
        activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8,
        calibrate_method=CalibrationMethod.MinMax,
    )
    os.remove(pre)
    print(f"wrote {a.dst}: {os.path.getsize(a.src) / 1e6:.1f} MB → {os.path.getsize(a.dst) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
