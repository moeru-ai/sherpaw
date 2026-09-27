# @sherpaw/kws

Local streaming keyword spotting with Sherpa-ONNX WASM. Runs in a Worker by default. You supply the model, encoded keyword tokens and mono PCM audio.

## Quick start

```sh
pnpm add @sherpaw/kws
```

Download a [model pack](#models) and serve its `preload.data` and `preload.js.metadata` files:

```ts
import { createKeywordSpotter } from '@sherpaw/kws'

const [data, metadata] = await Promise.all([
  fetch('/models/kws/preload.data'),
  fetch('/models/kws/preload.js.metadata'),
])

if (!data.ok || !metadata.ok)
  throw new Error('Model download failed')

const spotter = await createKeywordSpotter({
  model: {
    data: await data.arrayBuffer(),
    metadata: await metadata.json(),
  },
  // Tokens for the Chinese/English Zipformer model below.
  keywords: [{
    label: 'LIGHT UP',
    matches: [{ tokens: ['L', 'AY1', 'T', 'AH1', 'P'] }],
  }],
})

// Call from your audio capture code with mono PCM in [-1, 1].
async function onAudio(samples: Float32Array, sampleRate: number) {
  const hits = await spotter.processAudio(samples, sampleRate)

  for (const hit of hits)
    console.log(hit.label, hit.tokens, hit.startTime, hit.timestamps)
}

// When finished:
spotter.dispose()
```

## Keywords and controls

Each keyword has a `label` and a `matches` array. Add alternative token sequences to `matches` for multiple pronunciations; all return the same label. Tokens must exist in the model's `tokens.txt`. Text-to-token conversion is not included.

Both keywords and individual matches accept `score` (default `1`, positive) and `threshold` (default `0.25`, in `(0, 1]`). Match settings override keyword settings.

| Method | Behavior |
| --- | --- |
| `await spotter.processAudio(samples, sampleRate)` | Returns detections. Caller buffers remain usable. |
| `await spotter.setKeywords(entries)` | Replaces the entire vocabulary and resets audio state. Invalid updates preserve the previous vocabulary. `[]` pauses detection. |
| `await spotter.reset()` | Starts a fresh audio stream with the same keywords. |
| `spotter.dispose()` | Stops the Worker and rejects pending operations. |

Initialization requires at least one keyword. Keep the sample rate constant until a reset or vocabulary update. Detection timestamps are seconds within the decoder segment, not absolute recording positions. For audio files, append about one second of silence to flush the final detection.

Optional configuration includes `signal` for cancellation, `maxActivePaths` (default `4`) for the search beam, and `maxPendingAudio` (default `4`) for outstanding audio requests. Await audio processing to avoid exceeding the queue limit. See the [types](src/worker-types.ts) for details.

## Other entrypoints

- `@sherpaw/kws/node`: the same async interface using Node worker threads.
- `@sherpaw/kws/worker`: import inside a custom Worker entry, then pass that Worker as `createKeywordSpotter(config, { worker })`. The detector owns and terminates it.
- `@sherpaw/kws/core`: synchronous `initKWSModule()` and `createKeywordSpotter(module, config)` for use with `@sherpaw/preloader`.

Vite 7 requires `optimizeDeps: { exclude: ['@sherpaw/kws'] }`. Vite 8 and Rspack support the default Worker setup.

## Models

Models are downloaded separately:

- [Chinese/English Zipformer 3M](https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20) — used in the example above.
- [Chinese Wenetspeech Zipformer 3.3M](https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01).

Both packs provide `install/bin/wasm/preload.data` and `preload.js.metadata`. Japanese is not verified.

Try microphone input and editable keywords in the [sandbox playground](../sandbox/README.md#keyword-spotting-playground).
