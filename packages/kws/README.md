# @sherpaw/kws

Streaming keyword spotting in browsers with a standalone Sherpa-ONNX WASM runtime. Supply mono PCM and keywords already encoded as model tokens. Models are loaded separately with `@sherpaw/preloader`; no model is bundled in the npm package.

```ts
import { createKeywordSpotter, initKWSModule } from '@sherpaw/kws'
import { loadVirtualData } from '@sherpaw/preloader'

const module = await initKWSModule()
async function download(url: string) {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}`)
  return response.arrayBuffer()
}

// Host a matching KWS transducer encoder, decoder, joiner and tokens.txt.
const [encoder, decoder, joiner, tokens] = await Promise.all(
  ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt']
    .map(file => download(`/models/kws/${file}`)),
)
loadVirtualData({
  module,
  virtualData: { 'encoder.onnx': encoder, 'decoder.onnx': decoder, 'joiner.onnx': joiner, 'tokens.txt': tokens },
})

const spotter = createKeywordSpotter(module, {
  model: { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' },
  keywords: [{ tokens: ['zh', 'ōu', 'w', 'àng', 'j', 'ūn'], label: '周望军' }],
})

// Feed microphone/other mono PCM, typically in 20–100 ms chunks.
function onAudio(samples: Float32Array, sampleRate: number) {
  for (const hit of spotter.processAudio(samples, sampleRate))
    console.log(hit.label, hit.startTime, hit.timestamps, hit.tokens)
}

// Replace the ENTIRE vocabulary. Await completion before using the new words.
await spotter.setKeywords([
  { tokens: ['l', 'uò', 'sh', 'í'], label: '落实', score: 1, threshold: 0.25 },
])
await spotter.setKeywords([]) // Pause; incoming audio is discarded.
await spotter.setKeywords([{ tokens: ['l', 'uò', 'sh', 'í'], label: '落实' }])
spotter.dispose()
```

`initKWSModule()` loads the bundled SIMD WASM via a URL relative to the JS module. Preserve `dist/prebuilt/kws.wasm` when serving the package. Bundlers can also resolve the `@sherpaw/kws/module.wasm` export. Serve external models from your origin or with suitable CORS headers. Existing `loadData()` model packs work as well; model paths refer to the same runtime's virtual filesystem. Keep those files unchanged while the spotter is alive.

## Contract

- `createKeywordSpotter(module, { model, keywords })` is synchronous and requires loaded, compatible KWS transducer model files and at least one keyword. The runtime uses 16 kHz, 80-dimensional features, one CPU inference thread, four active paths and one trailing blank.
- Each entry has `{ tokens: string[], label: string, score?: number, threshold?: number }`. Tokens must exactly match the model's `tokens.txt`. Labels are returned unchanged and may include spaces. Empty labels, empty token sequences, unknown tokens and duplicate token sequences are rejected. Multiple pronunciations may share a label.
- `score` defaults to `1` and must be positive. `threshold` defaults to `0.25` and must be in `(0, 1]`. Both must fit a finite, normal float32 value. Zero is excluded because upstream interprets it as “use the default.”
- `setKeywords()` snapshots entries at call time and rebuilds the detector and stream in call order. Only a successful rebuild replaces the active vocabulary. Invalid updates reject without losing the current detector, and later updates still run. The old and new detectors briefly coexist in memory. Reloads can pause processing and reset all audio history and the timestamp origin.
- `processAudio()` accepts normalized finite `Float32Array` mono PCM in `[-1, 1]` and integer sample rates from 8000 to 192000 Hz. Keep the sample rate constant until the next successful vocabulary update; changes are rejected before entering WASM. Upstream resamples to 16 kHz. It feeds audio, decodes every ready step, reads each result and resets after every hit. Empty input returns `[]`. For finite recordings, append about one second of silence to allow trailing blanks and the final feature window to complete.
- Detections contain `label`, `tokens`, `startTime` and `timestamps`. Times are seconds, preserved from upstream: token timestamps are relative to `startTime` in the current stream. They do not track wall time or include audio discarded while paused. Updating the vocabulary starts a new stream.
- `dispose()` releases the owned stream and detector and is safe to repeat. Pending updates reject and subsequent operations fail. It leaves caller-owned model files loaded for reuse; the caller may unlink them when no longer needed.

Audio capture and text-to-token conversion are the caller's responsibility. The Promise returned by `setKeywords()` orders updates; it does not move native model loading to another thread. Run this package in a Web Worker to keep loading and inference off the UI thread.

## Models and verification

The browser suite uses the fp32 chunk-16 variants and test recordings from these [official upstream releases](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html):

- `sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`: Chinese.
- `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`: Chinese and English.

Japanese is **not verified**. A caller may supply a compatible KWS transducer model and its already encoded tokens; an ordinary Japanese ASR model is not sufficient. This package has no raw keyword-string API or pinyin, phoneme or BPE encoder.

```sh
pnpm -F @sherpaw/kws test:prepare
pnpm -F @sherpaw/kws build
pnpm -F @sherpaw/kws typecheck
pnpm -F @sherpaw/kws test:run
pnpm -F @sherpaw/kws test:run:browser
```

Browser tests load the built npm JS, bundled WASM, external model files and upstream WAVs through HTTP in Chromium. They cover Chinese/English hits, unrelated audio and silence, repeated hits, multiple hits in one chunk, replacement, pause/resume, invalid-update rollback and native resource destruction across repeated updates. Test downloads stay outside the published package.

To rebuild the runtime, activate Emscripten 4.0.23 and run `cd sherpa-onnx && ./build.sh` from the repository root. The `kws` CMake target installs `kws.js` and `kws.wasm` into this package's `src/prebuilt/` directory, using the pinned upstream submodule and no model preload.
