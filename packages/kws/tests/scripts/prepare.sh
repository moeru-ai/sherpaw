#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
bash scripts/prepare-kws-models.sh
cd packages/kws/tests
mkdir -p models
cd models
# Only test audio belongs here. Runtime models come from the pinned packs.
for name in sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01 sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20; do
  if [[ ! -d "$name/test_wavs" ]]; then
    curl --fail --location --retry 3 --output "$name.tar.bz2.part" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/$name.tar.bz2"
    tar xjf "$name.tar.bz2.part" "$name/test_wavs"
    rm "$name.tar.bz2.part"
  fi
done
