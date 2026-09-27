#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
# Check out the published embedding pack at the revision pinned by the parent repository,
# and download the segmentation model with its model directory script.
EMBEDDING_PACK=models/huggingface/sherpaw-campplus-zh-en-advanced
git submodule update --init -- "$EMBEDDING_PACK"
git -C "$EMBEDDING_PACK" lfs pull

models/sherpa-onnx-pyannote-segmentation-3-0/download.sh

mkdir -p packages/speaker-diarization/tests/fixtures
cd packages/speaker-diarization/tests/fixtures
AUDIO_SHA256=bedf036caed208386c67b4ef4b11f83d74dd0d420b102163a1c33cd09cde7010
if [[ ! -s 0-four-speakers-zh.wav ]]; then
  curl --fail --location --retry 3 --output 0-four-speakers-zh.wav \
    https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/0-four-speakers-zh.wav
fi
echo "$AUDIO_SHA256  0-four-speakers-zh.wav" | shasum -a 256 --check --status || {
  echo "SHA-256 mismatch for 0-four-speakers-zh.wav" >&2
  rm -f 0-four-speakers-zh.wav
  exit 1
}
