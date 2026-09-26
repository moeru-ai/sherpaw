#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Download published packs at the revisions pinned by this repository.
MODEL_PACKS=(
  models/huggingface/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20
  models/huggingface/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01
)
git submodule update --init -- "${MODEL_PACKS[@]}"
for model in "${MODEL_PACKS[@]}"; do
  git -C "$model" lfs pull
done
