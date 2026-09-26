# Sherpaw 🐾

[**Sherpaw**](https://github.com/sumimakito/sherpaw) (the "w" stands for "WASM") is a WebAssembly (WASM) wrapper for [Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx)—a framework for speech-related tasks (ASR, VAD, TTS, STT, SD, etc.) using onnxruntime **purely locally**.

## Development

Install [Git LFS](https://git-lfs.com/) and run `git lfs install` before checking out the submodules so that model data files are downloaded.

```shell
git clone git@github.com:sumimakito/sherpaw.git
git submodule init
git submodule update
```

The published Hugging Face models are pinned as submodules under `models/huggingface/`. Each model includes `preload.data`, `preload.js`, and `preload.js.metadata` in `install/bin/wasm/`.

X-ASR streaming model packs are available in the same preload layout:

| Model | Hugging Face repository | Model data size |
| --- | --- | --- |
| X-ASR zh-en, 480 ms, INT8 | [sherpaw-x-asr-zh-en-480ms-int8](https://huggingface.co/moeru-ai/sherpaw-x-asr-zh-en-480ms-int8) | 169.23 MB |
| X-ASR zh-en, 480 ms, FP32 | [sherpaw-x-asr-zh-en-480ms-fp32](https://huggingface.co/moeru-ai/sherpaw-x-asr-zh-en-480ms-fp32) | 614.98 MB |

Both expose `/decoder.onnx`, `/encoder.onnx`, `/joiner.onnx`, and `/tokens.txt`.
The INT8 encoder/joiner are renamed for compatibility without changing their
bytes. See [packaging and verification](docs/research/x-asr-model-packaging.md)
for reproduction commands, and use the pinned Hugging Face submodules below
`models/huggingface/` for reproducible deployment.

Speaker embedding model packs are also available:

| Model | Hugging Face repository | Model data size |
| --- | --- | --- |
| CAM++ Chinese/English advanced | [sherpaw-campplus-zh-en-advanced](https://huggingface.co/moeru-ai/sherpaw-campplus-zh-en-advanced) | 28.28 MB |
| ERes2NetV2 Chinese common | [sherpaw-eres2netv2-zh-cn](https://huggingface.co/moeru-ai/sherpaw-eres2netv2-zh-cn) | 71.44 MB |

Both packs expose `/speaker-embedding.onnx` in the virtual filesystem and require a separate speaker embedding runtime. Their model cards and manifests record source attribution, packaging details, and SHA-256 hashes. The data files contain the unchanged upstream ONNX bytes. Use the pinned submodule revisions for reproducible downloads.

The [sandbox](packages/sandbox) includes speaker identification at `/speaker-identification`. Run `pnpm dev` and select it from the home page.

Speaker identification is available in [`@sherpaw/speaker-identification`](packages/speaker-identification/README.md), with WASM embedding extraction, enrollment, scored identification, and verification. Download and preload-pack scripts are available for CAM++ Chinese/English advanced and ERes2NetV2 Chinese. See the [model research](docs/research/speaker-identification.md) and [browser / fake-microphone experiments](docs/research/speaker-identification-experiments.md).

## Development at the WASM/C level

### Prerequisites

Follow Sherpa-ONNX's [Install Emscripten](https://k2-fsa.github.io/sherpa/onnx/wasm/install-emscripten.html#install-emscripten) and Emscripten's [Download and install](https://emscripten.org/docs/getting_started/downloads) guides to set up the Emscripten SDK.

> [!IMPORTANT]
> Some versions of Emscripten may be incompatible with Sherpa-ONNX. Ensure you follow their official documentation and use the recommended version.

### Build

```shell
# Assuming Emscripten 3.1.64 is used
# Refer to the documentation above when selecting a version
./emsdk install 3.1.64
./emsdk activate 3.1.64

cd sherpa-onnx
./build.sh
```

The build outputs are located in `sherpa-onnx/build/install/bin/wasm/`.

## License

```
Copyright 2025 Makito

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
