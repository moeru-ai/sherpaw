# @sherpaw/xsai-transcription

xsai-style streaming transcription provider for Sherpa-ONNX WASM.

This package now follows a provider/executor design similar to `xsai-transformers`:

- provider: `createSherpawProvider().speech(...)`
- execution: `streamTranscription({ ...providerResult })`

## Structure

- `src/stream-transcription/core.ts`
  - low-level module/session helpers (`initTranscriptionModule`, `createSession`, etc.)
- `src/stream-transcription/provider.ts`
  - `createSherpawProvider`
  - implements fetch-override RPC adapter
- `src/stream-transcription/execute.ts`
  - `streamTranscription(...)` final API executor
- `src/stream-transcription/session.ts`
  - runtime streaming session built on `@sherpaw/asr`
- `src/stream-transcription/events.ts`
  - event communication via `@moeru/eventa`

## Main API (xsai-style)

```ts
import {
  asRemoteUrl,
  createSherpawProvider,
  streamTranscription,
} from '@sherpaw/xsai-transcription'
import transcriptionWorkerURL from '@sherpaw/xsai-transcription/worker?worker&url'

const sherpawProvider = createSherpawProvider({
  workerURL: transcriptionWorkerURL,
})

const speech = sherpawProvider.speech({
  metadata: asRemoteUrl('https://huggingface.co/.../tokens.json'),
  data: asRemoteUrl('https://huggingface.co/.../model.int8.onnx.data'),
  sampleRate: 16000,
})

await speech.loadSpeech()

const transcription = streamTranscription({ ...speech })
const writer = transcription.input.getWriter()
await writer.write(float32Chunk)
await writer.close()
const final = await transcription.done

for await (const textPart of transcription.textStream) {
  console.log('delta:', textPart)
}

const text = await transcription.text
console.log('text:', text)
```

## Provider design

`createSherpawProvider()` returns:

- `speech(model)` -> `{ baseURL, fetch, loadSpeech, terminateSpeech }`

`streamTranscription` accepts realtime `Float32Array` chunks through `input` and exposes xsai-compatible transcription output streams.

`loadSpeech()` is optional preloading for model assets before streaming starts. `terminateSpeech()` terminates provider-owned worker state for the speech transport instance.

Use `asRemoteUrl(...)` when model assets should be fetched on the main thread before being transferred into the worker.

## Event model

`streamTranscription(...)` exposes output fields aligned with `@xsai/stream-transcription`:

- `fullStream`: `ReadableStream<{ type: 'transcript.text.delta' | 'transcript.text.done', delta: string }>`
- `textStream`: `ReadableStream<string>`
- `text`: `Promise<string>`

These are routed with `@moeru/eventa` internally.

## Low-level APIs

You can still use lower-level primitives directly:

- `initTranscriptionModule()`
- `loadModelFiles(module, { metadata, data })`
- `createStreamingTranscriptionSession(...)`
- `createSession(module, options)`
- `transcribeOnce(...)`
- `pcm16ToFloat32(...)`

## Worker entry

`@sherpaw/xsai-transcription/worker` is still available for worker-based usage.
