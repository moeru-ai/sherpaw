#!/usr/bin/env bash
set -e

# Expect to have Emscripten installed and activated via emsdk.

cd $(dirname "$0")
mkdir -p ../build
mkdir -p ../build/wasm

if [[ ! -d ../build/sherpa-onnx ]]; then
	git clone https://github.com/sumimakito/sherpa-onnx.git -b feat/wasm-selective-preload ../build/sherpa-onnx
fi

cd ../build/sherpa-onnx/

export SHERPA_ONNX_WASM_ASR_SKIP_PRELOAD=ON # Let's take care of preloading separately.
export SHERPA_ONNX_WASM_ASR_EXPORT_ES6=ON # Output ES6 modules.
./build-wasm-simd-asr.sh

cp -vr build-wasm-simd-asr/install/bin/wasm/asr/* ../build/wasm
