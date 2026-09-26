#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Unmodified fp32 chunk-16 weights from the official KWS release.
verify() {
  (cd "$1" && shasum -a 256 -c <<'SHA256'
540ff509ed89bd22afe04bf7049a54bb1c95c6d8a18742ea9691910cdb5f859e  encoder.onnx
63a22dd60f40fff082ac3e09afa507f6787da36df76ded2fbe145fa233e22c21  decoder.onnx
76f7a24ed0c08633af14b2ee377f747af880d3b65eeba2cd3f31f3380fb73e8d  joiner.onnx
2d3f32311f9b692b964da3c90e830258d3e78e013cb0c992dbfb15cd5a1a71b0  tokens.txt
SHA256
  )
}
if [[ -d model/normalized ]] && verify model/normalized; then
  exit 0
fi
mkdir -p model
staging="$(mktemp -d model/.download.XXXXXX)"
trap 'rm -rf "$staging"' EXIT
curl --fail --location --retry 3 --output "$staging/model.tar.bz2" \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2"
tar xjf "$staging/model.tar.bz2" -C "$staging"
mkdir "$staging/normalized"
cp "$staging/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/encoder-epoch-13-avg-2-chunk-16-left-64.onnx" "$staging/normalized/encoder.onnx"
cp "$staging/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/decoder-epoch-13-avg-2-chunk-16-left-64.onnx" "$staging/normalized/decoder.onnx"
cp "$staging/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/joiner-epoch-13-avg-2-chunk-16-left-64.onnx" "$staging/normalized/joiner.onnx"
cp "$staging/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/tokens.txt" "$staging/normalized/tokens.txt"
verify "$staging/normalized"
mkdir -p model/normalized
cp "$staging/normalized/"* model/normalized/
