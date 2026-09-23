# Speaker identification

Local speaker embeddings, enrollment, identification, and verification with Sherpa-ONNX WASM. The package ships the runtime; download a compatible speaker model separately.

Embedding extraction and in-memory search are independent exports. Use only the extractor when your application stores and searches vectors in its own database.

```ts
import { loadVirtualData } from '@sherpaw/preloader'
import { createExtractor, initSpeakerIdentificationModule } from '@sherpaw/speaker-identification'

const module = await initSpeakerIdentificationModule()
// Published CAM++ pack pinned to a specific revision; preload.data contains ONNX bytes.
const response = await fetch('https://huggingface.co/moeru-ai/sherpaw-campplus-zh-en-advanced/resolve/5fc23543ac94200ae77514cf1c40596c5d70f6e8/install/bin/wasm/preload.data')
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

The published [CAM++ Chinese/English advanced](https://huggingface.co/moeru-ai/sherpaw-campplus-zh-en-advanced) and [ERes2NetV2 Chinese common](https://huggingface.co/moeru-ai/sherpaw-eres2netv2-zh-cn) packs are pinned as submodules. With Git LFS installed, fetch them from the repository root:

```sh
git submodule update --init -- \
  models/huggingface/sherpaw-campplus-zh-en-advanced \
  models/huggingface/sherpaw-eres2netv2-zh-cn
```

The demo, browser tests, and ablation use `install/bin/wasm/preload.data` from these submodules. Each pack contains exactly one unchanged ONNX file, so its data file can be loaded directly as the model bytes. If LFS downloads were skipped during checkout, run `git lfs pull` inside each model submodule. `test:prepare` also initializes both submodules and fetches their LFS data.

For applications, use a pinned Hugging Face revision as in the example above or host the files yourself. The packs also include `preload.js` and `preload.js.metadata` for the standard preload loader, plus provenance and SHA-256 metadata. Download and `pack.sh` scripts under the original `models/3dspeaker_*` directories remain available for reproducing the packs. See the [model research](../../docs/research/speaker-identification.md) for sources and licenses.

The runtime is generated by the `speaker-embedding` CMake target and installed into `src/prebuilt`. To rebuild with Emscripten 4.0.23, run `sherpa-onnx/build.sh` from its directory. The published `./module.wasm` export points to `dist/prebuilt/speaker-embedding.wasm`.

## Playground

The interactive UI lives in [`playgrounds/speaker-identification`](../../playgrounds/speaker-identification), alongside the XSAI playground. See its README for model preparation, recording controls, and UI tests.

```sh
pnpm dev:speaker
```

## Tests

The standard browser tests use public upstream recordings and require no TTS credentials:

```sh
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm -F @sherpaw/speaker-identification test:run
pnpm -F @sherpaw/speaker-identification typecheck
```

UI, sample-management, and recorder regressions belong to the playground:

```sh
pnpm -F @sherpaw/playground-speaker-identification test:run
```

Compact speaker identification and fake-microphone cases live in [`@sherpaw/testing-audio`](../testing-audio/cases/speaker-identification/README.md). The eight pre-generated TTS WAVs and one unknown-speaker recording are versioned with SHA-256 checksums. Tests never generate speech or require a provider key.

```sh
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm -F @sherpaw/testing-audio test:speakers
pnpm -F @sherpaw/testing-audio ablate:speakers
```

The [ablation report](../../docs/research/speaker-identification-ablation.md) compares Chinese-only and bilingual enrollment, thresholds, unknown speakers, clip length, and amplitude handling. Earlier pitch/speed experiments remain [research only](../../docs/research/speaker-identification-experiments.md); those transformations are not part of the library or default test suite.

The playground separates Worker RPC, sample/centroid management, capture, and score rendering under its `src/` directory. Fixture loading and timed recording live in its `tests/` harness. The recorder scales an entire clip down only if its floating-point peak exceeds one; invalid nonfinite values remain errors. Public extractor input is still normalized mono PCM.
