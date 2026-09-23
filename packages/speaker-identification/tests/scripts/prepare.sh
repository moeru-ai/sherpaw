#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
# Check out the published packs at the revisions pinned by the parent repository.
MODEL_PACKS=(
  models/huggingface/sherpaw-campplus-zh-en-advanced
  models/huggingface/sherpaw-eres2netv2-zh-cn
)
git submodule update --init -- "${MODEL_PACKS[@]}"
for model in "${MODEL_PACKS[@]}"; do
  git -C "$model" lfs pull
done
mkdir -p packages/speaker-identification/tests/fixtures
cd packages/speaker-identification/tests/fixtures
for name in fangjun-sr-1 fangjun-sr-2 leijun-sr-1 leijun-sr-2 fangjun-test-sr-1 leijun-test-sr-1 liudehua-test-sr-1; do
  if [[ ! -s "$name.wav" ]]; then
    curl --fail --location --retry 3 --output "$name.wav" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/$name.wav"
  fi
done
