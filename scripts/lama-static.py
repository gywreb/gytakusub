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

import numpy as np
import onnx
import onnxsim
from onnx import TensorProto, helper, numpy_helper

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--side", type=int, default=512)
a = ap.parse_args()

m = onnx.load(a.src)
m, ok = onnxsim.simplify(m, overwrite_input_shapes={"image": [1, 3, a.side, a.side], "mask": [1, 1, a.side, a.side]})
assert ok, "the simplified model does not match the original"

g = m.graph
inits, casts = [], []
for init in list(g.initializer):
    if init.data_type != TensorProto.FLOAT or np.prod(init.dims or [1]) < 16:
        inits.append(init)
        continue
    full = numpy_helper.to_array(init)
    if not np.all(np.isfinite(full)) or np.abs(full).max() > 60000:
        inits.append(init)  # outside float16's range: kept as it is
        continue
    half = numpy_helper.from_array(full.astype(np.float16), init.name + "__f16")
    inits.append(half)
    casts.append(helper.make_node("Cast", [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + "__cast"))
del g.initializer[:]
g.initializer.extend(inits)
nodes = list(g.node)
del g.node[:]
g.node.extend(casts + nodes)
onnx.save(m, a.dst)
print(f"{len(g.node)} nodes, {len(casts)} weights in float16, input {a.side}x{a.side}")
