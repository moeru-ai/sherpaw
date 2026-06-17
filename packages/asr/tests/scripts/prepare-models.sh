#!/usr/bin/env bash

TEST_ROOT=$(dirname $(realpath $0))/..
CACHE_DIR=$TEST_ROOT/.cache
MODEL_DIR=$TEST_ROOT/model
FIXTURES_DIR=$TEST_ROOT/fixtures
MODEL_NAME=sherpa-onnx-streaming-paraformer-bilingual-zh-en
MODEL_ARCHIVE=$CACHE_DIR/$MODEL_NAME.tar.bz2
UNPACKED_DIR=$CACHE_DIR/$MODEL_NAME

download() {
	curl -L --progress-bar -o "$2" "$1"
}

mkdir -p $CACHE_DIR
mkdir -p $MODEL_DIR
mkdir -p $FIXTURES_DIR

if [[ ! -f $MODEL_ARCHIVE ]]; then
	download https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$MODEL_NAME.tar.bz2 $MODEL_ARCHIVE
fi

if [[ ! -d $UNPACKED_DIR ]]; then
	mkdir -p $UNPACKED_DIR
	tar xvf $MODEL_ARCHIVE -C $UNPACKED_DIR --strip-components=1
fi

cp $UNPACKED_DIR/encoder.onnx $MODEL_DIR/encoder.onnx
cp $UNPACKED_DIR/decoder.onnx $MODEL_DIR/decoder.onnx
cp $UNPACKED_DIR/tokens.txt $MODEL_DIR/tokens.txt
cp $UNPACKED_DIR/test_wavs/0.wav $FIXTURES_DIR/0.wav

ls -lh $MODEL_DIR
ls -lh $FIXTURES_DIR/0.wav
