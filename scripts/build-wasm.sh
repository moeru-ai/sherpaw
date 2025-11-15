#!/usr/bin/env bash
set -e

# $1 is one of 'asr', 'kws', 'sd', 'se', 'tts', 'vad', or 'vad-asr'

case "$1" in
	asr|kws|sd|se|tts|vad|vad-asr)
		MODULE="$1"
		;;
	*)
		echo "Unknown module: $1"
		echo "Available modules: asr, kws, sd, se, tts, vad, vad-asr"
		exit 1
		;;
esac

# Expect to have Emscripten installed and activated via emsdk.

cd $(dirname "$0")
mkdir -p ../build
mkdir -p ../build/wasm

if [[ ! -d ../build/sherpa-onnx ]]; then
	git clone https://github.com/sumimakito/sherpa-onnx.git -b feat/wasm-selective-preload ../build/sherpa-onnx
fi

cd ../build/sherpa-onnx/

export "SHERPA_ONNX_WASM_$(echo $MODULE | tr '[:lower:]' '[:upper:]')_SKIP_PRELOAD"=ON # Let's take care of preloading separately.
export "SHERPA_ONNX_WASM_$(echo $MODULE | tr '[:lower:]' '[:upper:]')_EXPORT_ES6"=ON # Output ES6 modules.

./build-wasm-simd-${MODULE}.sh

cp -vr build-wasm-simd-${MODULE}/install/bin/wasm/${MODULE}/* ../build/wasm
