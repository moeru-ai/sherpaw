#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced/download.sh
mkdir -p packages/speaker-identification/tests/fixtures
cd packages/speaker-identification/tests/fixtures
for name in fangjun-sr-1 fangjun-sr-2 leijun-sr-1 leijun-sr-2 fangjun-test-sr-1 leijun-test-sr-1 liudehua-test-sr-1; do
  if [[ ! -s "$name.wav" ]]; then
    curl --fail --location --retry 3 --output "$name.wav" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/$name.wav"
  fi
done
