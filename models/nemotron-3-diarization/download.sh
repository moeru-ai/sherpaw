#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

REVISION="4d2a8bc71f5c896ec40faa59732e6716295edaf2"
REPOSITORY="https://huggingface.co/altunenes/parakeet-rs"
MODEL="nemotron3_diar_v3.onnx"
MODEL_SHA256="915e4fa23b0192ed9fadeb1cdd26847df986d50c92012d177be28d0343bbe03a"
W8_MODEL="nemotron3_diar_v3.w8.onnx"
W8_SHA256="5972f23192a1576b4edcc997d608f33cad54a82b97a0dfa33a46e8dc0403f041"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

if [[ -f "$W8_MODEL" && "$(sha256 "$W8_MODEL")" == "$W8_SHA256" ]]; then
  echo "Model already downloaded and verified: $W8_MODEL"
  exit 0
fi

work_dir="$(mktemp -d .download.XXXXXX)"
trap 'rm -rf "$work_dir"' EXIT

for file in "$MODEL" LICENSE README.md; do
  curl --fail --location --retry 3 --output "$work_dir/$file" "$REPOSITORY/resolve/$REVISION/nemotron-3-diarization/$file"
done

if [[ "$(sha256 "$work_dir/$MODEL")" != "$MODEL_SHA256" ]]; then
  echo "SHA-256 mismatch for $MODEL" >&2
  exit 1
fi

python3 ../quantize-sortformer-weights.py "$work_dir/$MODEL" "$work_dir/$W8_MODEL"
mv "$work_dir/LICENSE" LICENSE
mv "$work_dir/README.md" README.md
mv "$work_dir/$W8_MODEL" "$W8_MODEL"

if [[ "$(sha256 "$W8_MODEL")" != "$W8_SHA256" ]]; then
  echo "Warning: $W8_MODEL has a different SHA-256. ONNX or NumPy versions can write different bytes; $W8_SHA256 uses onnx 1.19.1 and numpy 2.0.2." >&2
else
  echo "Downloaded and verified: $W8_MODEL"
fi
