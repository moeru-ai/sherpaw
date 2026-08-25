# Testing audio

This package runs a recorded microphone through the real Sherpaw browser pipeline.

```text
input.wav -> Chromium fake microphone -> AudioWorklet -> Web Worker -> Sherpa-ONNX WASM -> transcript
```

The test loads every model maintained under the repository's `models` directory. It serves each generated `preload.data` and `preload.js.metadata` file directly to Chromium without copying the large files into the Vite build.

The English fixture comes from AIRI. The Chinese fixture says `你好，欢迎使用语音识别测试。`. AIHubMix `tts-1` generated it with the `alloy` voice. The stored fixture does not contain the API key.

The paused Chinese fixture contains two separate TTS clips. A three-second silent segment separates the clips. This fixture checks that transcription continues after a speech endpoint.

## Run the test

Build the required packages and run the fake-microphone test:

```shell
pnpm -F @sherpaw/testing-audio test:run
```

Generate the local model packages before the first run:

```shell
./models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/download.sh
./models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/pack.sh
./models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/download.sh
./models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/pack.sh
./models/sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10/download.sh
./models/sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10/pack.sh
```

Use the existing build for a second run:

```shell
pnpm -F @sherpaw/testing-audio test:existing-build
```

Each test task starts a separate Chromium process. Fakemic gives that process a non-looping WAV microphone input.

## When to use this package

Use this package to check browser audio capture, Worker transport, WASM recognition, and transcript output together.

Do not use this package for small recognizer or transport tests. Those tests belong to the package that owns the code.
