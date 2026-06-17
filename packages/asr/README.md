# @sherpaw/asr

A WebAssembly (WASM) wrapper for ASR-related features.

> [**Sherpaw**](https://github.com/sumimakito/sherpaw) (the "w" stands for "WASM") is a WebAssembly (WASM) wrapper for [Sherpa-ONNX](https://github.com/k2-fsa/sherpa-onnx)—a framework for speech-related tasks (ASR, VAD, TTS, STT, SD, etc.) using onnxruntime **purely locally**.

## Quick start

> [!NOTE]
> This section may be subject to change as the API is still stabilizing.

## Install dependencies

```bash
npm i @sherpaw/asr @sherpaw/preloader
# or with pnpm
pnpm add @sherpaw/asr @sherpaw/preloader
# or with yarn
yarn add @sherpaw/asr @sherpaw/preloader
```

### Set up a recognizer

```ts
import type { OnlineRecognizer } from '@sherpaw/asr'
import type { DataMetadata } from '@sherpaw/preloader'

import { createOnlineRecognizer, initASRModule } from '@sherpaw/asr'
import asrWASMFile from '@sherpaw/asr/module.wasm?url'
import { loadData } from '@sherpaw/preloader'

async function setupRecognizer(): OnlineRecognizer {
  // Load model metadata and data with @sherpaw/preloader
  const metadata = await (await fetch('/models/my-asr/metadata.json')).json() as DataMetadata
  const data = await (await fetch('/models/my-asr/data.bin')).arrayBuffer()

  // Provide the path to the WASM file and initialize the ASR module
  const asr = await initASRModule({ locateFile: () => asrWASMFile })
  loadData({
    module: asr,
    metadata,
    data,
  })

  // Create an online recognizer
  return createOnlineRecognizer(asr)
}
```

### Create a stream, feed audio samples, and get the transcription

```ts
import type { OnlineRecognizer, OnlineStream } from '@sherpaw/asr'

const lines: string[] = ['']
let stream: OnlineStream | undefined

function processSamples(recognizer: OnlineRecognizer, samples: Float32Array) {
  if (!stream) {
    stream = recognizer.createStream()
  }

  stream.acceptWaveform(16000, samples) // Sample rate at 16 kHz
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream)
  }

  const { text } = recognizer.getResult(stream)
  // Update the current transcription line
  lines[lines.length - 1] = text

  if (recognizer.isEndpoint(stream)) {
    // Start a new transcription line
    lines.push('')
    recognizer.reset(stream)
  }
}
```

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
