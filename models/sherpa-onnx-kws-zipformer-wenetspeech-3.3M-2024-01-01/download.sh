#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Unmodified fp32 chunk-16 weights from the official KWS release.
verify() {
  (cd "$1" && shasum -a 256 -c <<'SHA256'
859cd6decc23f35e6ddb3a6ddb7172a57f6de7b54288728c2433ab94b7635c59  encoder.onnx
fb581d6734511676e246e0dff2fea01b31b0913176cb3ca64576dbab0a177774  decoder.onnx
fcf43a2edf687e2e1bc8a2b2cf53129d3b0d693d90dcc4202e2d53b43db6c43c  joiner.onnx
72316508d9119696145abc6f1f8cdc46287535c34e5ce7e595f845cb1499cf2e  tokens.txt
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
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2"
tar xjf "$staging/model.tar.bz2" -C "$staging"
mkdir "$staging/normalized"
cp "$staging/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01/encoder-epoch-12-avg-2-chunk-16-left-64.onnx" "$staging/normalized/encoder.onnx"
cp "$staging/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01/decoder-epoch-12-avg-2-chunk-16-left-64.onnx" "$staging/normalized/decoder.onnx"
cp "$staging/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01/joiner-epoch-12-avg-2-chunk-16-left-64.onnx" "$staging/normalized/joiner.onnx"
cp "$staging/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01/tokens.txt" "$staging/normalized/tokens.txt"
verify "$staging/normalized"
mkdir -p model/normalized
cp "$staging/normalized/"* model/normalized/
