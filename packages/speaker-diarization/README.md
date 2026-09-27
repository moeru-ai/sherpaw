# @sherpaw/speaker-diarization

Local offline speaker diarization with Sherpa-ONNX WASM. Runs in a Worker by default. You supply a segmentation model, a speaker embedding model and one complete recording of mono PCM; the diarizer returns who spoke when.

A pyannote segmentation model finds local speaker activity in 10-second windows, a speaker embedding model computes one embedding for each local speaker, and agglomerative clustering groups the embeddings into speakers.

## Quick start

```sh
pnpm add @sherpaw/speaker-diarization
```

Download the [models](#models) and serve them. The embedding model is a preload pack with `preload.data` and `preload.js.metadata`. A single ONNX file becomes a pack with a one-entry manifest:

```ts
import { createDiarizer } from '@sherpaw/speaker-diarization'

const [segmentation, data, metadata] = await Promise.all([
  fetch('/models/speaker-segmentation.onnx'),
  fetch('/models/campplus/preload.data'),
  fetch('/models/campplus/preload.js.metadata'),
])

if (!segmentation.ok || !data.ok || !metadata.ok)
  throw new Error('Model download failed')

const onnx = new Uint8Array(await segmentation.arrayBuffer())

const diarizer = await createDiarizer({
  model: {
    segmentation: {
      data: onnx,
      metadata: { files: [{ filename: '/speaker-segmentation.onnx', start: 0, end: onnx.length }], remote_package_size: onnx.length },
    },
    embedding: { data: await data.arrayBuffer(), metadata: await metadata.json() },
  },
  clustering: { numSpeakers: 4 },
})

// Mono PCM in [-1, 1] at diarizer.sampleRate (16000 Hz for pyannote-segmentation-3.0).
const segments = await diarizer.diarize(samples, diarizer.sampleRate)
// [{ start: 0.318, end: 6.865, speaker: 0 }, { start: 7.017, end: 10.747, speaker: 1 }, ...]

// When finished:
diarizer.dispose()
```

`diarize` does not resample. Browser recordings are usually 48 kHz; decode them with an `AudioContext` at `diarizer.sampleRate`, as the [sandbox](../sandbox/src/pages/speaker-diarization.vue) does.

## Clustering and options

`clustering` is either `{ numSpeakers }`, when the count is known, or `{ distanceThreshold }`, the cosine distance at which clusters stop merging. A larger threshold gives fewer speakers; calibrate it for your model and audio. Pass a clustering as the third argument of `diarize` to override it for one call. Speaker labels are numbered by first appearance and are local to one call.

| Option | Default | Behavior |
| --- | --- | --- |
| `windowShiftRatio` | `0.1` | Segmentation window shift as a fraction of the 10-second window, in (0, 1]. Larger values are faster but can miss speaker turns. |
| `minDurationOn` | `0.2` | Discard segments that are not longer than this many seconds. |
| `minDurationOff` | `0.5` | Merge segments of one speaker across gaps that are not longer than this many seconds. |
| `signal` | — | Aborting cancels initialization or disposes the diarizer. |

The native API treats 0 as "unset", so numeric options must be greater than 0. Model files default to `speaker-segmentation.onnx` and `speaker-embedding.onnx`; set `model.paths` for packs with other file names. See the [types](src/types.ts) for details.

## Other entrypoints

- `@sherpaw/speaker-diarization/node`: the same async interface using Node worker threads.
- `@sherpaw/speaker-diarization/worker`: import inside a custom Worker entry, then pass that Worker as `createDiarizer(config, { worker })`. The diarizer owns and terminates it.
- `@sherpaw/speaker-diarization/core`: `initSpeakerDiarizationModule()` initializes WASM asynchronously; `createDiarizer(module, config)` creates a diarizer with synchronous processing for use with `@sherpaw/preloader`.

## Performance and limits

- Diarization is offline: each call processes a whole recording. On an Apple M4 with one thread, the 56.9-second four-speaker test recording takes about 20 seconds.
- A call cannot be cancelled except by disposing the diarizer, which terminates its Worker. There is no progress callback: the JavaScript glue does not include `addFunction`.
- The runtime is sherpa-onnx v1.13.7. It lacks the upstream fix in [k2-fsa/sherpa-onnx#3826](https://github.com/k2-fsa/sherpa-onnx/pull/3826) for a heap use-after-free with non-finite embeddings. C++ exceptions cannot be caught in this build; `diarize` rejects, and you should create a new diarizer.

## Models

| Model | Size | License |
| --- | --- | --- |
| [pyannote-segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0), [ONNX export](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0) | 6.0 MB | MIT |
| [CAM++ Chinese/English advanced](https://huggingface.co/moeru-ai/sherpaw-campplus-zh-en-advanced) | 28 MB | Apache-2.0 |

`models/sherpa-onnx-pyannote-segmentation-3-0/download.sh` downloads the ONNX export and checks its SHA-256. Any embedding pack that `@sherpaw/speaker-identification` supports also works.

Try file upload and clustering in the [sandbox playground](../sandbox/README.md).
