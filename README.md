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
