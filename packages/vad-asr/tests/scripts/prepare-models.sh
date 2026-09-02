#!/usr/bin/env bash

TEST_ROOT=$(dirname $(realpath $0))/..
CACHE_DIR=$TEST_ROOT/.cache
MODELS_DIR=$TEST_ROOT/models

download() {
	curl -L --progress-bar -o "$2" "$1"
}

mkdir -p $CACHE_DIR
mkdir -p $MODELS_DIR

# Download VAD model
vad_model_path=$MODELS_DIR/silero_vad.onnx
if [[ ! -f $vad_model_path ]]; then
	download https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx $vad_model_path
fi

download_asr() {
	model_archive_path=$CACHE_DIR/$1.tar.bz2
	model_dir=$MODELS_DIR/$1

	if [[ ! -f $model_archive_path ]]; then
		download https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-$1.tar.bz2 $model_archive_path
	fi

	mkdir -p $model_dir
	if [[ -d $model_dir && "$(ls -A $model_dir)" ]]; then
		echo "Model archive unpacking is skipped: $model_dir is not empty."
	else
		tar xvf $model_archive_path -C $model_dir --strip-components=1
	fi

	ls -lh $model_dir
}

download_asr moonshine-tiny-ja-quantized-2026-02-27
