#!/usr/bin/env python3
"""A model's weights stored in float16 and cast back to float32 when it loads: half the file, the
same arithmetic (inference still runs in float32). Weights outside float16's range, and tiny
ones (biases of a few values, shapes), are kept as they are.

Used for the learned fills: LaMa (scripts/lama-static.py, 0.001 off the full model in the hole on
a 0..1 scale) and AOT (scripts/vendor-inpaint.mjs).

    pip install onnx numpy
    python3 scripts/half_weights.py model.onnx model-half.onnx
"""
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def halve(m):
    """Stores the float32 weights of model `m` in float16, each cast back to float32 at load. Returns the count."""
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
    return len(casts)


if __name__ == "__main__":
    src, dst = sys.argv[1:3]
    m = onnx.load(src)
    n = halve(m)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print(f"{len(m.graph.node)} nodes, {n} weights in float16")
