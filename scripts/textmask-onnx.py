#!/usr/bin/env python3
"""The text-mask model (comic-text-mask: a U-Net on a ResNet-18, MIT) as an ONNX graph, built here
from its published weights (model.safetensors, config.json) with numpy and onnx alone, so the
vendored file can be made again anywhere (CI has no PyTorch). Batch norms are folded into the
convolutions; the input's ImageNet normalisation and the output's sigmoid are part of the graph,
as in the authors' model.pt. Weights are stored in float16 and computed in float32
(scripts/half_weights.py).

Input `image`: (n, 3, h, w) float32 RGB, 0..255, h and w multiples of 32 (the authors letterbox a
detector's text-region crop into 384 x 384, padding with 0). Output `text`: (n, 1, h, w) float32,
the probability of text at each pixel (the authors threshold it at 0.5).

    pip install onnx numpy
    python3 scripts/textmask-onnx.py <dir with model.safetensors and config.json> out.onnx
"""
import json
import os
import struct
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from half_weights import halve  # noqa: E402

DTYPES = {"F32": np.float32, "F16": np.float16, "I64": np.int64}


def read_safetensors(path):
    """The tensors of a .safetensors file (an 8-byte header length, a JSON header, the raw data)."""
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        head = json.loads(f.read(n))
        data = f.read()
    out = {}
    for name, t in head.items():
        if name == "__metadata__":
            continue
        a, b = t["data_offsets"]
        out[name] = np.frombuffer(data[a:b], dtype=DTYPES[t["dtype"]]).reshape(t["shape"]).copy()
    return out


def build(w, cfg):
    nodes, inits = [], []
    count = [0]

    def name(p):
        count[0] += 1
        return f"{p}_{count[0]}"

    def const(arr, p):
        t = numpy_helper.from_array(np.asarray(arr), name(p))
        inits.append(t)
        return t.name

    def conv(x, weight, bias, stride=1, pad=None, relu=False, p="conv"):
        k = weight.shape[-1]
        pad = k // 2 if pad is None else pad
        y = name(p)
        ins = [x, const(weight.astype(np.float32), p + "_w")] + ([const(bias.astype(np.float32), p + "_b")] if bias is not None else [])
        nodes.append(helper.make_node("Conv", ins, [y], kernel_shape=[k, k], strides=[stride, stride], pads=[pad] * 4))
        if relu:
            z = name(p + "_relu")
            nodes.append(helper.make_node("Relu", [y], [z]))
            return z
        return y

    def conv_bn(x, cw, bn, stride=1, relu=True, p="cbr"):
        """A convolution with no bias and the batch norm after it, folded into one."""
        g, b, m, v = w[bn + ".weight"], w[bn + ".bias"], w[bn + ".running_mean"], w[bn + ".running_var"]
        s = g / np.sqrt(v + 1e-5)
        return conv(x, w[cw] * s[:, None, None, None], b - m * s, stride=stride, relu=relu, p=p)

    def add_relu(a, b):
        y, z = name("add"), name("relu")
        nodes.append(helper.make_node("Add", [a, b], [y]))
        nodes.append(helper.make_node("Relu", [y], [z]))
        return z

    def basic(x, pre, stride):
        """A ResNet basic block: two 3 x 3 convolutions, the input (or its 1 x 1 projection) added."""
        y = conv_bn(x, pre + ".conv1.weight", pre + ".bn1", stride=stride)
        y = conv_bn(y, pre + ".conv2.weight", pre + ".bn2", relu=False)
        short = conv_bn(x, pre + ".downsample.0.weight", pre + ".downsample.1", stride=stride, relu=False) if pre + ".downsample.0.weight" in w else x
        return add_relu(y, short)

    # the input, normalised as the network was trained: (x - mean) / std, x in 0..255
    mean = np.array([0.485, 0.456, 0.406], np.float32).reshape(1, 3, 1, 1) * 255
    std = np.array([0.229, 0.224, 0.225], np.float32).reshape(1, 3, 1, 1) * 255
    x0, x1 = name("sub"), name("norm")
    nodes.append(helper.make_node("Sub", ["image", const(mean, "mean")], [x0]))
    nodes.append(helper.make_node("Mul", [x0, const(1 / std, "inv_std")], [x1]))

    # the encoder: ResNet-18 (features at 1/2, 1/4, 1/8, 1/16, 1/32 of the input)
    f1 = conv_bn(x1, "encoder.conv1.weight", "encoder.bn1", stride=2)
    pooled = name("pool")
    nodes.append(helper.make_node("MaxPool", [f1], [pooled], kernel_shape=[3, 3], strides=[2, 2], pads=[1, 1, 1, 1]))
    x = pooled
    feats = [f1]
    for i, stride in zip(range(1, 5), [1, 2, 2, 2]):
        x = basic(x, f"encoder.layer{i}.0", stride)
        x = basic(x, f"encoder.layer{i}.1", 1)
        feats.append(x)
    # the decoder: up by two, the skip of that size beside it, two 3 x 3 convolutions; five times
    skips = [feats[3], feats[2], feats[1], feats[0], None]
    x = feats[4]
    scales = const(np.array([1, 1, 2, 2], np.float32), "scales")
    for i, skip in enumerate(skips):
        up = name("up")
        nodes.append(helper.make_node("Resize", [x, "", scales], [up], mode="nearest", coordinate_transformation_mode="asymmetric", nearest_mode="floor"))
        if skip is not None:
            cat = name("cat")
            nodes.append(helper.make_node("Concat", [up, skip], [cat], axis=1))
            up = cat
        pre = f"decoder.blocks.{i}"
        x = conv_bn(up, pre + ".conv1.0.weight", pre + ".conv1.1")
        x = conv_bn(x, pre + ".conv2.0.weight", pre + ".conv2.1")
    logit = conv(x, w["segmentation_head.0.weight"], w["segmentation_head.0.bias"], p="head")
    nodes.append(helper.make_node("Sigmoid", [logit], ["text"]))

    graph = helper.make_graph(
        nodes, "comic-text-mask",
        [helper.make_tensor_value_info("image", TensorProto.FLOAT, ["n", 3, "h", "w"])],
        [helper.make_tensor_value_info("text", TensorProto.FLOAT, ["n", 1, "h", "w"])],
        inits,
    )
    m = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="gytakusub scripts/textmask-onnx.py")
    m.ir_version = 8
    return m


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    cfg = json.load(open(os.path.join(src, "config.json")))
    assert cfg["encoder_name"] == "resnet18" and cfg["decoder_channels"] == [256, 128, 64, 32, 16] and cfg["decoder_interpolation"] == "nearest", cfg
    m = build(read_safetensors(os.path.join(src, "model.safetensors")), cfg)
    n = halve(m)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print(f"{len(m.graph.node)} nodes, {n} weights in float16")
