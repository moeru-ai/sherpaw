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
  keywords: [{ matches: [{ tokens: ['zh', 'ōu', 'w', 'àng', 'j', 'ūn'] }], label: '周望军' }],
})

// Feed microphone/other mono PCM, typically in 20–100 ms chunks.
function onAudio(samples: Float32Array, sampleRate: number) {
  for (const hit of spotter.processAudio(samples, sampleRate))
    console.log(hit.label, hit.startTime, hit.timestamps, hit.tokens)
}

// Replace the ENTIRE vocabulary. Await completion before using the new words.
await spotter.setKeywords([
  { matches: [{ tokens: ['l', 'uò', 'sh', 'í'] }], label: '落实', score: 1, threshold: 0.25 },
])
await spotter.setKeywords([]) // Pause; incoming audio is discarded.
await spotter.setKeywords([{ matches: [{ tokens: ['l', 'uò', 'sh', 'í'] }], label: '落实' }])
spotter.dispose()
```

`initKWSModule()` loads the bundled SIMD WASM via a URL relative to the JS module. Preserve `dist/prebuilt/kws.wasm` when serving the package. Bundlers can also resolve the `@sherpaw/kws/module.wasm` export. Serve external models from your origin or with suitable CORS headers. Existing `loadData()` model packs work as well; model paths refer to the same runtime's virtual filesystem. Keep those files unchanged while the spotter is alive.

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

- `createKeywordSpotter(module, { model, keywords, maxActivePaths? })` is synchronous and requires loaded, compatible KWS transducer model files and at least one keyword. The runtime uses 16 kHz, 80-dimensional features, one CPU inference thread, one trailing blank and `maxActivePaths` search candidates (default `4`, a positive int32 integer). Larger values preserve more pronunciation candidates at a higher CPU cost. This setting is retained across vocabulary replacement and pause/resume.
- Each entry has `{ label: string, matches: KeywordMatch[], score?: number, threshold?: number }`. Each match contains `{ tokens: string[], score?: number, threshold?: number }` and represents one complete pronunciation. A keyword must have at least one match. Any match returns the keyword's label unchanged; labels may include spaces. Tokens must exactly match the model's `tokens.txt`. Empty labels, empty match/token arrays, unknown tokens and duplicate token sequences anywhere in the vocabulary are rejected.
- Keyword-level `score` defaults to `1` and must be positive. `threshold` defaults to `0.25` and must be in `(0, 1]`. Matches inherit these values and may override either separately. All supplied settings, including keyword defaults, must fit a finite, normal float32 value. Zero is excluded because upstream interprets it as “use the default.”
- `setKeywords()` snapshots entries at call time and rebuilds the detector and stream in call order. Only a successful rebuild replaces the active vocabulary. Invalid updates reject without losing the current detector, and later updates still run. The old and new detectors briefly coexist in memory. Reloads can pause processing and reset all audio history and the timestamp origin.
- `processAudio()` accepts normalized finite `Float32Array` mono PCM in `[-1, 1]` and integer sample rates from 8000 to 192000 Hz. Keep the sample rate constant until the next successful vocabulary update; changes are rejected before entering WASM. Upstream resamples to 16 kHz. It feeds audio, decodes every ready step, reads each result and resets after every hit. Empty input returns `[]`. For finite recordings, append about one second of silence to allow trailing blanks and the final feature window to complete.
- Detections contain the keyword's `label`, the matched pronunciation's `tokens`, `startTime` and `timestamps`. Times are seconds, preserved from upstream. Token timestamps belong to the upstream decoder segment and may restart after a hit/reset; do not interpret them as absolute positions in the original recording. They do not track wall time or include audio discarded while paused. Updating the vocabulary starts a new stream.
- `dispose()` releases the owned stream and detector and is safe to repeat. Pending updates reject and subsequent operations fail. It leaves caller-owned model files loaded for reuse; the caller may unlink them when no longer needed.

Audio capture and text-to-token conversion are the caller's responsibility. The Promise returned by `setKeywords()` orders updates; it does not move native model loading to another thread. Run this package in a Web Worker to keep loading and inference off the UI thread.

The [sandbox playground](../sandbox/README.md#keyword-spotting-playground) at `/kws` provides microphone and audio-file input, an editable token vocabulary, live replacement, pause/resume and detection history.

## Models and verification

The browser suite loads the published preload packs of the fp32 chunk-16 variants, with test recordings from these [official upstream releases](https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html):

- `sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`: Chinese.
- `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`: Chinese and English.

Both models have reproducible `download.sh`, `pack.sh` and `build.sh` scripts under `models/<model-name>/`. The scripts verify source hashes and generate the standard `install/bin/wasm/preload.{data,js,js.metadata}` assets using Emscripten 4.0.23. The KWS runtime is built separately; no keyword vocabulary is baked into a model.

Published packs:

- [Chinese/English Zipformer 3M](https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20)
- [Chinese Wenetspeech Zipformer 3.3M](https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01)

The revisions are pinned as submodules under `models/huggingface/`. `test:prepare` fetches the packs and upstream test recordings. To load a pack, use `loadData({ module, data, metadata })` with `preload.data` and parsed `preload.js.metadata`, then create the detector using `encoder.onnx`, `decoder.onnx`, `joiner.onnx` and `tokens.txt`.

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
