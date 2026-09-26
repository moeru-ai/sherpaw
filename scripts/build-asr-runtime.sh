#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
if ! command -v emcc >/dev/null; then
  echo 'Activate Emscripten 4.0.23 (source path/to/emsdk_env.sh) first.' >&2
  exit 1
fi
emscripten_dir=$(dirname "$(command -v emcc)")
cache_args=()
if [[ -n "${SHERPAW_DEPS_CACHE:-}" ]]; then
  for name in eigen hclust_cpp json kaldi_decoder kaldi_native_fbank kaldifst kissfft onnxruntime openfst simple-sentencepiece; do
    upper=$(echo "$name" | tr '[:lower:]' '[:upper:]')
    cache_args+=("-DFETCHCONTENT_SOURCE_DIR_${upper}=${SHERPAW_DEPS_CACHE}/${name}-src")
  done
fi
export SHERPA_ONNX_IS_USING_BUILD_WASM_SH=ON
cmake -S "$repo/sherpa-onnx" -B "$repo/sherpa-onnx/build-asr-runtime" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DCMAKE_TOOLCHAIN_FILE="$emscripten_dir/cmake/Modules/Platform/Emscripten.cmake" \
  -DSHERPA_ONNX_ENABLE_PYTHON=OFF -DSHERPA_ONNX_ENABLE_TESTS=OFF \
  -DSHERPA_ONNX_ENABLE_CHECK=OFF -DBUILD_SHARED_LIBS=OFF \
  -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF -DSHERPA_ONNX_ENABLE_JNI=OFF \
  -DSHERPA_ONNX_ENABLE_C_API=ON -DSHERPA_ONNX_ENABLE_TTS=OFF \
  -DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=ON -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF \
  -DSHERPA_ONNX_ENABLE_GPU=OFF -DSHERPA_ONNX_ENABLE_WASM=ON \
  -DSHERPA_ONNX_ENABLE_BINARY=OFF -DSHERPA_ONNX_LINK_LIBSTDCPP_STATICALLY=OFF \
  -DSHERPAW_ASR_RUNTIME=ON "${cache_args[@]}"
cmake --build "$repo/sherpa-onnx/build-asr-runtime" --target paraformer-asr catalog-asr catalog-asr-webgpu --parallel 8
