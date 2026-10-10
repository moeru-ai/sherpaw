"""Writes int8 Sortformer weights with fp32 compute.

Float initializers with at least 4096 values and two dimensions use symmetric int8 values per output
channel. DequantizeLinear restores them when the model loads, and the model computes in fp32.
"""

import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper


def main(source: str, output: str):
    model = onnx.load(source)
    graph = model.graph
    initializers, front = [], []

    for init in graph.initializer:
        array = numpy_helper.to_array(init)

        if init.data_type == onnx.TensorProto.FLOAT and array.size >= 4096 and array.ndim >= 2:
            flat = array.reshape(array.shape[0], -1)
            scale = np.maximum(np.abs(flat).max(axis=1), 1e-12) / 127.0
            quantized = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8).reshape(array.shape)
            initializers.append(numpy_helper.from_array(quantized, init.name + '_q'))
            initializers.append(numpy_helper.from_array(scale.astype(np.float32), init.name + '_scale'))
            front.append(helper.make_node('DequantizeLinear', [init.name + '_q', init.name + '_scale'], [init.name], axis=0, name=init.name + '_dq'))
        else:
            initializers.append(init)

    del graph.initializer[:]
    graph.initializer.extend(initializers)
    nodes = list(graph.node)
    del graph.node[:]
    graph.node.extend(front + nodes)
    onnx.save(model, output)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(f'Usage: {sys.argv[0]} <input> <output>')

    main(sys.argv[1], sys.argv[2])
