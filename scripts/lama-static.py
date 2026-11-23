#!/usr/bin/env python3
"""The manga LaMa, made to load fast in the browser: one input size, weights stored in float16.

The upstream export (ogkalu/lama-manga-onnx-dynamic) takes any size, so every Fourier unit
computes its transform matrices from the input's shape at run time: ~10,000 nodes, and ONNX
Runtime Web spends ~16 s setting them up on every load. Fixed at SIDE × SIDE, the simplifier
folds that arithmetic into constants (~2,450 nodes; the same output to the bit) and it loads
in under 2 s. The weights are then stored as float16 and cast back to float32 at load, so
inference still runs in float32 (in the hole, 0.001 off the full model on a 0..1 scale;
8-bit weights, half the size again, were 0.05 off).

    pip install onnx onnxsim numpy
    python3 scripts/lama-static.py lama-manga-dynamic.onnx lama.onnx [--side 512]
"""
import argparse
import os
import sys

import onnx
import onnxsim

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from half_weights import halve  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--side", type=int, default=512)
a = ap.parse_args()

m = onnx.load(a.src)
m, ok = onnxsim.simplify(m, overwrite_input_shapes={"image": [1, 3, a.side, a.side], "mask": [1, 1, a.side, a.side]})
assert ok, "the simplified model does not match the original"

n = halve(m)  # weights in float16, cast back to float32 at load (scripts/half_weights.py)
onnx.save(m, a.dst)
print(f"{len(m.graph.node)} nodes, {n} weights in float16, input {a.side}x{a.side}")
