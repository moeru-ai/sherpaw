#!/usr/bin/env bash
set -e
cd $(dirname "$0")/../..

docker run --platform linux/amd64 \
  -v "$PWD/upstream/sherpa-onnx:/opt/sherpa-onnx" \
  -v "$PWD/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/model/normalized:/opt/sherpa-onnx/wasm/asr/assets" \
  -v "$PWD/models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/install/bin/wasm:/opt/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr" \
  -e SHERPA_ONNX_WASM_ASR_SKIP_PRELOAD=ON \
  -e SHERPA_ONNX_WASM_ASR_EXPORT_ES6=ON \
  --entrypoint /bin/bash \
  emscripten/emsdk \
  -lc 'cd /opt/sherpa-onnx/wasm/asr && \
       "$(dirname "$(which emcc)")/tools/file_packager" \
         preload.data \
         --preload assets@. \
         --js-output=preload.js \
         --separate-metadata \
         --export-es6 && \
       mv preload.data /opt/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr/preload.data && \
       mv preload.js /opt/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr/preload.js && \
       mv preload.js.metadata /opt/sherpa-onnx/build-wasm-simd-asr/install/bin/wasm/asr/preload.js.metadata'
