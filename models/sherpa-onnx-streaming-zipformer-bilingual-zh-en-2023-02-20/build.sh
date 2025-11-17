#!/usr/bin/env bash
set -e
cd $(dirname "$0")/../..

docker run --platform linux/amd64 \
  -v "$PWD/upstream/sherpa-onnx:/opt/sherpa-onnx" \
  -v "$PWD/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/model/normalized:/opt/sherpa-onnx/wasm/asr/assets" \
  -v "$PWD/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/install/bin/wasm:/opt/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr" \
  --entrypoint /bin/bash \
  ghcr.io/sumimakito/sherpa-onnx-wasm-emscripten:3.1.48 \
  -lc '/opt/emsdk/emsdk activate 3.1.48 && \
       source /opt/emsdk/emsdk_env.sh && \
       emcc -v && \
       cd /opt/sherpa-onnx && \
       /opt/sherpa-onnx/build-wasm-simd-asr.sh'
