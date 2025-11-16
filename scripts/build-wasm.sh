#!/usr/bin/env bash
set -e

# $1 is one of 'asr', 'kws', 'speaker-diarization', 'speech-enhancement', 'tts', 'vad', or 'vad-asr'

case "$1" in
	asr|kws|speaker-diarization|speech-enhancement|tts|vad|vad-asr)
		MODULE="$1"
		;;
	*)
		echo "Unknown module: $1"
		echo "Available modules: asr, kws, speaker-diarization, speech-enhancement, tts, vad, vad-asr"
		exit 1
		;;
esac

case "$MODULE" in
	speaker-diarization)
		MODULE_SHORT="SD"
		;;
	speech-enhancement)
		MODULE_SHORT="SE"
		;;
	vad-asr)
		MODULE_SHORT="VAD_ASR"
		;;
	*)
		MODULE_SHORT="$(echo $MODULE | tr '[:lower:]' '[:upper:]')"
		;;
esac

# Expect to have Emscripten installed and activated via emsdk.

cd $(dirname "$0")
mkdir -p ../build/modules/${MODULE}


if [[ ! -d ../build/sherpa-onnx ]]; then
	git clone https://github.com/sumimakito/sherpa-onnx.git -b feat/wasm-selective-preload ../build/sherpa-onnx
fi

cd ../build/sherpa-onnx/

export "SHERPA_ONNX_WASM_${MODULE_SHORT}_SKIP_PRELOAD"=ON # Let's take care of preloading separately.
export "SHERPA_ONNX_WASM_${MODULE_SHORT}_EXPORT_ES6"=ON # Output ES6 modules.

./build-wasm-simd-${MODULE}.sh

cp -vr build-wasm-simd-${MODULE}/install/bin/wasm/${MODULE}/* ../modules/${MODULE}
