# @sherpaw/kws

Streaming keyword spotting with a dedicated Worker by default. Supply mono PCM, a downloaded model pack, and keywords already encoded as model tokens. The package owns WASM initialization, model loading, request ordering and cleanup; model URLs and download policies belong to the application. No model is bundled in the npm package.

```ts
import { createKeywordSpotter } from '@sherpaw/kws'

const [dataResponse, metadataResponse] = await Promise.all([
  fetch('/models/kws/preload.data'),
  fetch('/models/kws/preload.js.metadata'),
])

if (!dataResponse.ok || !metadataResponse.ok)
  throw new Error('Model download failed')

const lifetime = new AbortController()
const spotter = await createKeywordSpotter({
  model: {
    data: await dataResponse.arrayBuffer(),
    metadata: await metadataResponse.json(),
  },
  keywords: [{ label: '周望军', matches: [{ tokens: ['zh', 'ōu', 'w', 'àng', 'j', 'ūn'] }] }],
  signal: lifetime.signal,
})

// Feed mono PCM, typically in 20–100 ms chunks. Input buffers stay usable.
async function onAudio(samples: Float32Array, sampleRate: number) {
  const hits = await spotter.processAudio(samples, sampleRate)

  for (const hit of hits)
    console.log(hit.label, hit.startTime, hit.timestamps, hit.tokens)
}

await spotter.setKeywords([
  { label: '落实', matches: [{ tokens: ['l', 'uò', 'sh', 'í'] }] },
])
await spotter.setKeywords([]) // Pause; incoming audio is discarded.
await spotter.setKeywords([{ label: '落实', matches: [{ tokens: ['l', 'uò', 'sh', 'í'] }] }])
await spotter.reset() // Fresh audio stream, same model and vocabulary.
spotter.dispose() // Or lifetime.abort(), including during initialization.
```

The model pack is the `preload.data` and parsed `preload.js.metadata` produced by Emscripten and used by `@sherpaw/preloader`. The default file paths are `encoder.onnx`, `decoder.onnx`, `joiner.onnx`, and `tokens.txt`; set `model.paths` for other names. The library mounts the pack inside the Worker. Both model data and PCM are copied at call time, without transferring ownership or detaching the caller's buffers.

## Node.js

Use the same asynchronous interface from `@sherpaw/kws/node`. It runs WASM and inference in a dedicated `node:worker_threads` Worker; it does not use a remote service.

```ts
import { createKeywordSpotter } from '@sherpaw/kws/node'
import { readFile } from 'node:fs/promises'

const spotter = await createKeywordSpotter({
  model: {
    data: await readFile('./models/preload.data'),
    metadata: JSON.parse(await readFile('./models/preload.js.metadata', 'utf8')),
  },
  keywords: [{ label: 'LIGHT UP', matches: [{ tokens: ['L', 'AY1', 'T', 'AH1', 'P'] }] }],
})

try {
  const hits = await spotter.processAudio(new Float32Array(1600), 16000)

  console.log(hits)
}
finally {
  spotter.dispose()
}
```

## Worker entry and synchronous core

The default browser factory uses the standard `new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module' })` syntax understood by [Vite](https://vite.dev/guide/features.html#web-workers) and [Rspack](https://rspack.rs/guide/features/web-workers). It has no Vite-specific imports or plugin requirement. Vite 8 and Rspack work with their default Worker handling. In Vite 7, set `optimizeDeps: { exclude: ['@sherpaw/kws'] }`: its older dependency prebundler otherwise relocates the relative Worker URL. No `worker.format` override is needed. Keep the published JS chunks and `dist/prebuilt/kws.wasm` together when serving without a bundler. The WASM is also exported as `@sherpaw/kws/module.wasm`.

Applications that need their own Worker entry can create a local file containing:

```ts
// keyword.worker.ts
import '@sherpaw/kws/worker'
```

Then pass the Worker to `createKeywordSpotter(config, { worker: new Worker(new URL('./keyword.worker.ts', import.meta.url), { type: 'module' }) })`. Its ownership transfers to the detector: initialization failure, abort or disposal terminates it. `@sherpaw/kws/worker` is an executable Worker entry, not an import for the main thread.

For applications that explicitly own the WASM runtime or load separate model files, the earlier synchronous interface is available from `@sherpaw/kws/core`:

```ts
import { createKeywordSpotter, initKWSModule } from '@sherpaw/kws/core'
import { loadVirtualData } from '@sherpaw/preloader'

const module = await initKWSModule()
// modelFiles is a caller-provided map of filenames to downloaded bytes/text.
loadVirtualData({ module, virtualData: modelFiles })

const spotter = createKeywordSpotter(module, {
  model: { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' },
  keywords,
})
```

The core's `processAudio()` and `reset()` are synchronous. Core disposal releases its detector and stream while leaving caller-owned model files available for reuse. Calling the core on a browser's main thread also runs inference there. The package root now provides the asynchronous Worker factory; previous synchronous callers should change their import to `/core`.

## Multiple pronunciations

Group alternative pronunciations inside one keyword. For the bilingual model used by the sandbox:

```ts
await spotter.setKeywords([
  {
    label: '肥鱼肥鱼',
    threshold: 0.1,
    matches: [
      { tokens: ['f', 'éi', 'y', 'ú', 'f', 'éi', 'y', 'ú'] },
      { tokens: ['f', 'ēi', 'y', 'ú', 'f', 'ēi', 'y', 'ú'] },
    ],
  },
])
```

Each match can optionally override `score` or `threshold`; otherwise it inherits the keyword's settings. `setKeywords()` still replaces the entire vocabulary, so include every keyword you want to keep listening for. The library handles expansion into native keyword lines and maps every pronunciation back to the parent label.

This replaces the earlier flat `{ label, tokens }` shape from this PR. Wrap a single pronunciation in `matches: [{ tokens }]`; combine repeated-label pronunciation entries into one keyword's `matches` array.

## Contract

- `await createKeywordSpotter({ model, keywords, maxActivePaths?, signal?, maxPendingAudio? })` initializes a dedicated Worker and requires a compatible KWS transducer pack and at least one keyword. The runtime uses 16 kHz, 80-dimensional features, one CPU inference thread, one trailing blank and `maxActivePaths` search candidates (default `4`, a positive int32 integer). Larger values preserve more pronunciation candidates at a higher CPU cost. This setting is retained across vocabulary replacement and pause/resume. Pass `{ maxActivePaths }` as the second argument to `setKeywords()` to change it atomically with the vocabulary.
- Each entry has `{ label: string, matches: KeywordMatch[], score?: number, threshold?: number }`. Each match contains `{ tokens: string[], score?: number, threshold?: number }` and represents one complete pronunciation. A keyword must have at least one match. Any match returns the keyword's label unchanged; labels may include spaces. Tokens must exactly match the model's `tokens.txt`. Empty labels, empty match/token arrays, unknown tokens and duplicate token sequences anywhere in the vocabulary are rejected.
- Keyword-level `score` defaults to `1` and must be positive. `threshold` defaults to `0.25` and must be in `(0, 1]`. Matches inherit these values and may override either separately. All supplied settings, including keyword defaults, must fit a finite, normal float32 value. Zero is excluded because upstream interprets it as “use the default.”
- All operations execute in call order. `setKeywords()` snapshots entries at call time and rebuilds the detector and stream in call order. Only a successful rebuild replaces the active vocabulary. Invalid updates reject without losing the current detector, and later updates still run. The old and new detectors briefly coexist in memory. Reloads can pause processing and reset all audio history and the timestamp origin.
- `await processAudio()` accepts normalized finite `Float32Array` mono PCM in `[-1, 1]` and integer sample rates from 8000 to 192000 Hz. Keep the sample rate constant until the next successful vocabulary update; changes are rejected before entering WASM. Upstream resamples to 16 kHz. It feeds audio, decodes every ready step, reads each result and resets after every hit. Empty input returns `[]`. For finite recordings, append about one second of silence to allow trailing blanks and the final feature window to complete.
- Detections contain the keyword's `label`, the matched pronunciation's `tokens`, `startTime` and `timestamps`. Times are seconds, preserved from upstream. Token timestamps belong to the upstream decoder segment and may restart after a hit/reset; do not interpret them as absolute positions in the original recording. They do not track wall time or include audio discarded while paused. Updating the vocabulary starts a new stream.
- `await reset()` creates a fresh stream and resets timestamps and sample-rate tracking without reloading the model or changing the vocabulary.
- The default limit is four outstanding audio requests, including the executing request. Set `maxPendingAudio` to a positive safe integer to adjust it. An over-limit call rejects without enqueuing or dropping earlier work; await requests or stop capture if processing cannot keep up.
- `dispose()` terminates the owned Worker, releases its model/runtime memory, rejects pending operations and is safe to repeat. Subsequent operations reject. Initialization failure also terminates the Worker. `signal` can cancel initialization or the initialized detector. Unexpected Worker errors, deserialization errors and Node thread exits reject pending operations.

Audio capture, model downloads and text-to-token conversion remain the caller's responsibility. WASM initialization, model mounting and inference run off the main thread by default.

The [sandbox playground](../sandbox/README.md#keyword-spotting-playground) at `/kws` provides microphone and audio-file input, an editable token vocabulary, live replacement, pause/resume and detection history.

## Models and verification

The browser suite loads the published preload packs of the fp32 chunk-16 variants, with test recordings from these [official upstream releases](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html):

- `sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`: Chinese.
- `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`: Chinese and English.

Both models have reproducible `download.sh`, `pack.sh` and `build.sh` scripts under `models/<model-name>/`. The scripts verify source hashes and generate the standard `install/bin/wasm/preload.{data,js,js.metadata}` assets using Emscripten 4.0.23. The KWS runtime is built separately; no keyword vocabulary is baked into a model.

Published packs:

- [Chinese/English Zipformer 3M](https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20)
- [Chinese Wenetspeech Zipformer 3.3M](https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01)

The revisions are pinned as submodules under `models/huggingface/`. `test:prepare` fetches the packs and upstream test recordings. Pass the downloaded `preload.data` and parsed `preload.js.metadata` to the factory as `model: { data, metadata }`. The synchronous core still supports `loadData({ module, data, metadata })`.

Japanese is **not verified**. A caller may supply a compatible KWS transducer model and its already encoded tokens; an ordinary Japanese ASR model is not sufficient. This package has no raw keyword-string API or pinyin, phoneme or BPE encoder.

```sh
pnpm -F @sherpaw/kws test:prepare
pnpm -F @sherpaw/kws build
pnpm -F @sherpaw/kws typecheck
pnpm -F @sherpaw/kws test:run
pnpm -F @sherpaw/kws test:run:browser
```

Browser tests load the built npm JS, bundled WASM, external model files and upstream WAVs through HTTP in Chromium. They cover Chinese/English hits, unrelated audio and silence, repeated hits, multiple hits in one chunk, replacement, pause/resume, invalid-update rollback and native resource destruction across repeated updates. The default browser Worker is also exercised for ordered updates, buffer ownership, error propagation and disposal. Test downloads stay outside the published package.

To rebuild the runtime, activate Emscripten 4.0.23 and run `cd sherpa-onnx && ./build.sh` from the repository root. The `kws` CMake target installs `kws.js` and `kws.wasm` into this package's `src/prebuilt/` directory, using the pinned upstream submodule and no model preload.

Worker communication uses [Eventa](https://github.com/moeru-ai/eventa) invoke events and its browser/Node adapters. The package owns ordered decoding, audio backpressure and Worker lifetime.

Node integration tests exercise the built `/node` entry with the real WASM and audio fixtures, including ownership, queue ordering, rollback, reset, queue limits, abort and disposal.
