#!/usr/bin/env bash
set -e

cd $(dirname "$0")

# https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
curl -Lv -o model.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
rm -rf model
mkdir model
tar -xzf model.tar.bz2 -C model --strip-components=1

# Note it is not an error that we rename encoder.int8.onnx to encoder.onnx
mkdir -p model/normalized
mv model/encoder.int8.onnx model/normalized/encoder.onnx
mv model/decoder.int8.onnx model/normalized/decoder.onnx
mv model/tokens.txt model/normalized/tokens.txt
