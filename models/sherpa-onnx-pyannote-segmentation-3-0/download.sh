#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ARCHIVE_NAME="sherpa-onnx-pyannote-segmentation-3-0"
# SHA-256 of model.onnx inside the upstream archive. The same bytes are published at
# https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0 (revision 9403a69).
MODEL_SHA256="220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079"
ARCHIVE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/$ARCHIVE_NAME.tar.bz2"
MODEL_PATH="model/normalized/speaker-segmentation.onnx"

verify_model() {
  local checksum
  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(sha256sum "$1")"
  else
    checksum="$(shasum -a 256 "$1")"
  fi
  [[ "${checksum%% *}" == "$MODEL_SHA256" ]]
}

if [[ -f "$MODEL_PATH" ]] && verify_model "$MODEL_PATH"; then
  echo "Model already downloaded and verified: $MODEL_PATH"
  exit 0
fi

mkdir -p model/normalized
WORK_DIR="$(mktemp -d model/.download.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
curl --fail --location --retry 3 --output "$WORK_DIR/model.tar.bz2" "$ARCHIVE_URL"
tar -xjf "$WORK_DIR/model.tar.bz2" -C "$WORK_DIR" "$ARCHIVE_NAME/model.onnx" "$ARCHIVE_NAME/LICENSE"
if ! verify_model "$WORK_DIR/$ARCHIVE_NAME/model.onnx"; then
  echo "SHA-256 mismatch for $ARCHIVE_NAME/model.onnx" >&2
  exit 1
fi
mv "$WORK_DIR/$ARCHIVE_NAME/LICENSE" model/LICENSE
mv "$WORK_DIR/$ARCHIVE_NAME/model.onnx" "$MODEL_PATH"
echo "Downloaded and verified: $MODEL_PATH"
