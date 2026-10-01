# @sherpaw/speaker-diarization

Local speaker diarization with Sherpa-ONNX WASM. Runs in a Worker by default. The offline diarizer takes a segmentation model, a speaker embedding model and one complete recording of mono PCM, and returns who spoke when. The [streaming speaker tracker](#streaming-speaker-tracking) labels utterances as they arrive.

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

## Streaming speaker tracking

`createSpeakerTracker` labels each utterance with a speaker number as soon as the utterance ends, for example each VAD segment of a voice agent. It needs only the speaker embedding pack:

```ts
import { createSpeakerTracker } from '@sherpaw/speaker-diarization'

const tracker = await createSpeakerTracker({ model: { data: await data.arrayBuffer(), metadata: await metadata.json() } })

const turn = await tracker.track(utterance, 16000) // after each utterance, in time order
const guess = await tracker.peek(lastSeconds, 16000) // while someone is still speaking
```

How it works:

- The tracker embeds each utterance in 1.5-second windows and clusters the recent embeddings again after each utterance, as in 3D-Speaker. Speaker numbers follow the cluster centroids, so a speaker keeps a number when clusters merge or split.
- Re-clustering can change the labels of earlier utterances. `turn.revisions` reports these changes.
- A new voice is `pending` until it has 4 seconds of speech. Until then, it can show the number of a similar speaker, but never the number of an enrolled person. For a voice agent, `tuning: { borrowThreshold: 1 }` turns this off.
- A VAD needs a pause to end an utterance, so quick turn-taking puts two people into one utterance. `peek` finds such a speaker change, so that the caller can cut the utterance there.

Optional features:

- **Known speakers.** `enroll(speech, 16000)` adds a person, for example the owner of a device, from at least 5 seconds of their speech. Their utterances get that number from the first one. `enroll` rejects audio with more than one voice. In meetings and conversations, enrolled people got their number in 78%–93% of their utterances.
- **Segmentation model.** Pass pyannote segmentation-3.0 as `segmentation` and install the optional peer dependency `onnxruntime-web`. For 16 kHz audio, `peek` then finds speaker changes frame by frame, so more short turns get their own label. `track` also flags utterances where two people talk at once (`overlap`). The runtime and the model add a 19.5 MB download.
- **Speech detection.** With the segmentation model, `createSpeechDetector` finds utterances in place of a VAD. Use it where Silero VAD misses speech, such as films with music. On films, it found 80%–83% of the speech instead of 61%–70%, with about the same false alarms. Utterances end 0.5–1.25 seconds later than with a VAD.
- **Tuning and inspection.** `tuning` changes the thresholds that `defaultSpeakerTrackerTuning` lists. `inspect` returns the embeddings that the tracker compares, for example to plot them.

Limits:

- Each utterance gets one label, the label of its main speaker, also when two people talk at once.
- Labels are hints. Each label has a confidence estimate; confirm before an action that depends on who spoke.
- On AMI and AliMeeting test meetings, 89%–91% of utterances got the right label, and 98.5%–98.7% of the `high` confidence labels were right.

## Other entrypoints

- `@sherpaw/speaker-diarization/node`: the same async interface using Node worker threads.
- `@sherpaw/speaker-diarization/worker`: import inside a custom Worker entry, then pass that Worker as `createDiarizer(config, { worker })` or `createSpeakerTracker(config, { worker })`. The diarizer or tracker owns and terminates it.
- `@sherpaw/speaker-diarization/core`: `initSpeakerDiarizationModule()` initializes WASM asynchronously. `createDiarizer(module, config)` creates a diarizer with synchronous processing for use with `@sherpaw/preloader`. `createSpeakerTracker(extractor, config)` creates a tracker in the current thread from an `@sherpaw/speaker-identification` extractor. `config.segment` takes a function that runs the segmentation model and returns its scores.

## Performance and limits

- Diarization is offline: each call processes a whole recording. On an Apple M4 with one thread, the 56.9-second four-speaker test recording takes about 20 seconds.
- The tracker uses the `@sherpaw/speaker-identification` runtime for embeddings. On an Apple M4 with one thread, it takes 0.03–0.05 seconds per second of audio.
- A call cannot be cancelled except by disposing the diarizer, which terminates its Worker. There is no progress callback: the JavaScript glue does not include `addFunction`.
- The runtime is sherpa-onnx v1.13.7. It lacks the upstream fix in [k2-fsa/sherpa-onnx#3826](https://github.com/k2-fsa/sherpa-onnx/pull/3826) for a heap use-after-free with non-finite embeddings. C++ exceptions cannot be caught in this build; `diarize` rejects, and you should create a new diarizer.

## Models

| Model | Size | License |
| --- | --- | --- |
| [pyannote-segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0), [ONNX export](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0) | 6.0 MB | MIT |
| [CAM++ Chinese/English advanced](https://huggingface.co/moeru-ai/sherpaw-campplus-zh-en-advanced) | 28 MB | Apache-2.0 |

`models/sherpa-onnx-pyannote-segmentation-3-0/download.sh` downloads the ONNX export and checks its SHA-256. Any embedding pack that `@sherpaw/speaker-identification` supports also works.

Try file upload and clustering, and live speaker tracking from the microphone, in the [sandbox playground](../sandbox/README.md).
