#!/usr/bin/env bash
set -e

cd $(dirname "$0")

# https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
curl -Lv -o model.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
mkdir model
tar -xzf model.tar.bz2 -C model --strip-components=1

# Note it is not an error that we rename encoder.int8.onnx to encoder.onnx
mkdir -p model/normalized
mv model/encoder-epoch-99-avg-1.int8.onnx model/normalized/encoder.onnx
mv model/decoder-epoch-99-avg-1.onnx model/normalized/decoder.onnx
mv model/joiner-epoch-99-avg-1.int8.onnx model/normalized/joiner.onnx
mv model/tokens.txt model/normalized/tokens.txt
