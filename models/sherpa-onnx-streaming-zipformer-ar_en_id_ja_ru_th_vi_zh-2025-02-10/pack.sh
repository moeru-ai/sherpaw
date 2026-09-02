#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/../.."

MODULE_SHORT=ASR
MODULE_SHORT_LOWER=asr
MODEL_NAME="sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10"

docker run --platform linux/amd64 \
  -v "$PWD/sherpa-onnx/upstream:/opt/sherpa-onnx" \
  -v "$PWD/models/$MODEL_NAME/model/normalized:/opt/sherpa-onnx/wasm/${MODULE_SHORT_LOWER}/assets" \
  -v "$PWD/models/$MODEL_NAME/install/bin/wasm:/opt/sherpa-onnx/build-wasm-simd-${MODULE_SHORT_LOWER}/install/bin/wasm/${MODULE_SHORT_LOWER}" \
  -e SHERPA_ONNX_WASM_${MODULE_SHORT}_SKIP_PRELOAD=ON \
  -e SHERPA_ONNX_WASM_${MODULE_SHORT}_EXPORT_ES6=ON \
  -e MODULE_SHORT=${MODULE_SHORT} \
  -e MODULE_SHORT_LOWER=${MODULE_SHORT_LOWER} \
  --entrypoint /bin/bash \
  emscripten/emsdk:4.0.23 \
  -lc 'cd /opt/sherpa-onnx/wasm/asr && \
       "$(dirname "$(which emcc)")/tools/file_packager" \
         preload.data \
         --preload assets@. \
         --js-output=preload.js \
         --separate-metadata \
         --export-es6 && \
       mv preload.data /opt/sherpa-onnx/build-wasm-simd-${MODULE_SHORT_LOWER}/install/bin/wasm/${MODULE_SHORT_LOWER}/preload.data && \
       mv preload.js /opt/sherpa-onnx/build-wasm-simd-${MODULE_SHORT_LOWER}/install/bin/wasm/${MODULE_SHORT_LOWER}/preload.js && \
       mv preload.js.metadata /opt/sherpa-onnx/build-wasm-simd-${MODULE_SHORT_LOWER}/install/bin/wasm/${MODULE_SHORT_LOWER}/preload.js.metadata'
