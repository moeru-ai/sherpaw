#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

MODEL_FILE="3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
# Pinned from the upstream release's checksum.txt (SHA-256).
MODEL_SHA256="aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2"
# The misspelling in speaker-recongition-models is the upstream release tag.
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/$MODEL_FILE"
MODEL_PATH="model/normalized/speaker-embedding.onnx"

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
DOWNLOAD_PATH="$(mktemp model/normalized/.download.XXXXXX)"
trap 'rm -f "$DOWNLOAD_PATH"' EXIT
curl --fail --location --retry 3 --output "$DOWNLOAD_PATH" "$MODEL_URL"
if ! verify_model "$DOWNLOAD_PATH"; then
  echo "SHA-256 mismatch for $MODEL_FILE" >&2
  exit 1
fi
mv "$DOWNLOAD_PATH" "$MODEL_PATH"
echo "Downloaded and verified: $MODEL_PATH"
