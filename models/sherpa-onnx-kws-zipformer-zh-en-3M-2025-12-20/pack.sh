#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -s model/normalized/encoder.onnx || ! -s model/normalized/decoder.onnx || ! -s model/normalized/joiner.onnx || ! -s model/normalized/tokens.txt ]]; then
  echo "Missing model. Run ./download.sh first." >&2
  exit 1
fi

mkdir -p install/bin/wasm

# Package model assets separately from the standalone KWS runtime.
docker run --rm --platform linux/amd64 \
  -v "$PWD/model/normalized:/assets:ro" \
  -v "$PWD/install/bin/wasm:/output" \
  --workdir /output \
  --entrypoint /bin/bash \
  emscripten/emsdk:4.0.23 \
  -lc '
    set -euo pipefail
    "$(dirname "$(command -v emcc)")/tools/file_packager" \
      preload.data \
      --preload /assets@/ \
      --js-output=preload.js \
      --separate-metadata \
      --export-es6
  '
