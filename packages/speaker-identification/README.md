# Speaker identification

Local speaker embeddings, enrollment, identification, and verification with Sherpa-ONNX WASM. The package ships the runtime; download a compatible speaker model separately.

Embedding extraction and in-memory search are independent exports. Use only the extractor when your application stores and searches vectors in its own database.

```ts
import { loadVirtualData } from '@sherpaw/preloader'
import { createExtractor, initSpeakerIdentificationModule } from '@sherpaw/speaker-identification'

const module = await initSpeakerIdentificationModule()
const response = await fetch('/models/speaker-embedding.onnx')
if (!response.ok)
  throw new Error('Could not download the speaker model')

loadVirtualData({
  module,
  virtualData: { 'speaker.onnx': new Uint8Array(await response.arrayBuffer()) },
})
const extractor = createExtractor(module, { model: 'speaker.onnx' })

// Run extraction in a Web Worker. Supply single-speaker mono PCM in [-1, 1].
// sampleRate must describe the actual PCM; the native feature extractor resamples it.
const enrollment = extractor.extract(enrollmentSamples, 16000)
const query = extractor.extract(querySamples, 16000)

// These are independent Float32Array copies. Your application can save them,
// and search query against saved vectors using its own cosine-search database.
extractor.dispose()
```

For local search, create a separate database from the same package:

```ts
import { createInMemoryDB } from '@sherpaw/speaker-identification'

const db = createInMemoryDB(module, { dimension: enrollment.length })
try {
  db.enroll('alice', [enrollment])
  const match = db.identify(query, 0.6)
  // match is { name, score }, or null. Calibrate this example threshold for your audio.
  console.log(match)
  console.log(db.matches(query, -1, 3))
  console.log(db.verify('alice', query, 0.6))
  console.log(db.speakers)
  db.remove('alice')
}
finally {
  db.dispose()
}
```

`createExtractor` owns only the native extractor; `createInMemoryDB` owns only the native enrollment manager. They can share one WASM module and have independent lifetimes. Disposing either leaves the other usable. `extract` creates and releases one stream per utterance and returns a copy of the embedding. Both `dispose` methods are idempotent; operations on a disposed instance throw.

## Persistence and external databases

Persistence belongs to the application. Store the speaker or recording ID, exact model version, dimension, and embedding together. For JSON storage, convert with `Array.from(embedding)` and restore with `new Float32Array(saved.embedding)`. Equal dimensions do not make different models compatible.

An application can restore saved vectors into a fresh in-memory database without loading an ONNX model or creating an extractor. It still needs the WASM runtime:

```ts
import { createInMemoryDB, initSpeakerIdentificationModule } from '@sherpaw/speaker-identification'

// savedRecords and savedDimension come from application storage;
// all records and query vectors must use the same model version.
const module = await initSpeakerIdentificationModule()
const db = createInMemoryDB(module, { dimension: savedDimension })
for (const record of savedRecords)
  db.enroll(record.id, record.embeddings.map(values => new Float32Array(values)))

// Later: db.identify(query, threshold), then db.dispose() when no longer needed.
```

Enrollment accepts a list of embeddings. The upstream manager sums them and normalizes the result, storing one representative vector per name. Existing names return `false`; remove a name before replacing its registration. Use speaker IDs to search people, or unique recording IDs with one embedding each to search individual recordings. Search scans the in-memory vectors and ranks by cosine similarity; it is not an approximate nearest-neighbor index.

With an external vector database, call `extractor.extract(...)` for both enrollment and queries, save enrollment vectors through the application's database client, and query that database directly. `createInMemoryDB` and `enroll` are optional. Select cosine similarity, keep model versions separate, and account for whether the database returns similarity or distance before applying a threshold. A nearest result still needs threshold validation to reject unknown speakers.

The default minimum clip duration is one second. This checks duration, not speech activity or speaker purity. Use VAD or explicit recording boundaries, exclude overlapping speakers, and collect several enrollment clips in the languages you expect. A score is cosine similarity, not a probability. Unknown-speaker rejection needs validation on held-out voices.

## Models

From the repository root:

```sh
models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced/download.sh
# Optional comparison model:
models/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common/download.sh
```

The normalized model is `model/normalized/speaker-embedding.onnx` under each directory. Optional `pack.sh` scripts create the existing preload format. See the [model research](../../docs/research/speaker-identification.md) for sources and licenses.

The runtime is generated by the `speaker-embedding` CMake target and installed into `src/prebuilt`. To rebuild with Emscripten 4.0.23, run `sherpa-onnx/build.sh` from its directory. The published `./module.wasm` export points to `dist/prebuilt/speaker-embedding.wasm`.

## Local demo

```sh
pnpm -F @sherpaw/speaker-identification dev
```

Choose and load a downloaded model, then enter a name and manually start/stop recording to register each voice. Use the recording button beside a speaker, or enter the same name again, to append another sample. The demo retains the original sample embeddings and rebuilds that speaker’s normalized vector from all samples. The speaker menu supports renaming and deleting a speaker; each sample can also be deleted. Removing a sample rebuilds the vector from the remaining samples, and removing the last sample removes the speaker. Historical result rows retain their original names and scores. Create new recordings in the identification area and stop them to enqueue recognition. Results appear in a compact table with visible candidate scores and similarity bars. Bars mark the 0.6 threshold; unmatched queries still show their highest similarity. Each row keeps its own processing state, matching scores, and result; another recording can start while previous work runs in the Worker. The demo does not load example voices or require TTS fixtures. Switching models clears registrations; previous result rows retain their model labels. Refreshing clears the session.

## Tests

The standard browser tests use public upstream recordings and require no TTS credentials:

```sh
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm -F @sherpaw/speaker-identification test:run
pnpm -F @sherpaw/speaker-identification typecheck
```

UI state and sample-management regressions use the local browser demo:

```sh
pnpm -F @sherpaw/speaker-identification test:demo
```

Compact speaker identification and fake-microphone cases live in [`@sherpaw/testing-audio`](../testing-audio/cases/speaker-identification/README.md). The eight pre-generated TTS WAVs and one unknown-speaker recording are versioned with SHA-256 checksums. Tests never generate speech or require a provider key.

```sh
models/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common/download.sh
pnpm -F @sherpaw/testing-audio test:speakers
pnpm -F @sherpaw/testing-audio ablate:speakers
```

The [ablation report](../../docs/research/speaker-identification-ablation.md) compares Chinese-only and bilingual enrollment, thresholds, unknown speakers, clip length, and amplitude handling. Earlier pitch/speed experiments remain [research only](../../docs/research/speaker-identification-experiments.md); those transformations are not part of the library or default test suite.

The demo separates Worker RPC (`client.ts`), sample/centroid management (`enrollments.ts`), capture (`recorder.ts`), and score rendering (`result-view.ts`). Test fixtures and timed recording are loaded only by the test harness (`test-api.ts`), never by the interactive demo. The recorder scales an entire clip down only if its floating-point peak exceeds one; invalid nonfinite values remain errors. Public extractor input is still normalized mono PCM.
