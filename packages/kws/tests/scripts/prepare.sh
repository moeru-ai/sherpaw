#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models
cd models
# Official release archives include both models and the upstream test audio.
for name in sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01 sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20; do
  if [[ ! -s "$name/tokens.txt" ]]; then
    curl --fail --location --retry 3 --output "$name.tar.bz2.part" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$name.tar.bz2"
    tar xjf "$name.tar.bz2.part"
    rm "$name.tar.bz2.part"
  fi
done
