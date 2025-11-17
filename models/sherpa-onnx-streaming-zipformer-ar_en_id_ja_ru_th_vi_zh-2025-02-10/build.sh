#!/usr/bin/env bash
set -e
cd $(dirname "$0")/../..

MODULE_SHORT=ASR
MODULE_SHORT_LOWER=asr
MODEL_NAME="sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10"

docker run --platform linux/amd64 \
  -v "$PWD/upstream/sherpa-onnx:/opt/sherpa-onnx" \
  -v "$PWD/models/$MODEL_NAME/model/normalized:/opt/sherpa-onnx/wasm/${MODULE_SHORT_LOWER}/assets" \
  -v "$PWD/models/$MODEL_NAME/install/bin/wasm:/opt/sherpa-onnx/build-wasm-simd-${MODULE_SHORT_LOWER}/install/bin/wasm/${MODULE_SHORT_LOWER}" \
  -e SHERPA_ONNX_WASM_${MODULE_SHORT}_SKIP_PRELOAD=ON \
  -e SHERPA_ONNX_WASM_${MODULE_SHORT}_EXPORT_ES6=ON \
  -e MODULE_SHORT=${MODULE_SHORT} \
  -e MODULE_SHORT_LOWER=${MODULE_SHORT_LOWER} \
  --entrypoint /bin/bash \
  emscripten/emsdk:3.1.48 \
  -lc 'emcc -v && \
       cd /opt/sherpa-onnx && \
       /opt/sherpa-onnx/build-wasm-simd-${MODULE_SHORT_LOWER}.sh'
