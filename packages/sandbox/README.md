# Sherpaw sandbox

The Vue sandbox exposes ASR at `/asr`, speaker identification at `/speaker-identification`, and keyword spotting at `/kws`. All routes are linked from the home page.

## Run

From the repository root, install dependencies and prepare the pinned speaker model packs (requires Git LFS):

```sh
pnpm install
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm -F @sherpaw/kws test:prepare
pnpm --filter @sherpaw/sandbox... build
pnpm dev
```

Open `/speaker-identification` at the URL printed by Vite. Load a model, register speakers with multiple recordings, and compare manually recorded identification results. Speakers and individual samples can be renamed or deleted as appropriate. Leaving the route releases its microphone and Worker; returning creates an empty session.

## Keyword spotting playground

Open `/kws`, load the Chinese/English Zipformer 3M model, then start microphone listening or choose a local audio file. The default English preset contains `Hey Iru`, `Hello Iru`, and `Iru Iru`, with Iru pronounced “伊噜.” The Chinese preset contains `你好肥鱼`, `大肥鱼`, and `肥鱼肥鱼`. Selecting a preset replaces the active vocabulary immediately after loading; click **应用词表** to apply manual edits. The page accepts already encoded, space-separated model tokens, display labels, boost scores and thresholds; it does not convert text to tokens. The English preset uses `IY1 L UW0` for the recorded “伊噜” pronunciation and also accepts pinyin variants for Hey Iru and Iru Iru and a mixed English/pinyin variant for Hello Iru, with boost `1.5` and threshold `0.1`. Each line in a token field becomes one item in the keyword’s `matches` array. A row maps directly to `{ label, matches, score, threshold }`; the library expands pronunciations for the native detector. The playground edits shared keyword settings; per-match overrides are available through the library API. The playground uses a search beam of `16`; the library default remains `4`. The original English `R` pronunciation and four-path beam missed a local recording of all three phrases. The first local recording passes file and simulated-microphone replay with the updated preset. A second recording exposed missing mixed English/pinyin coverage for Hello Iru: adding it recovers three of five attempts in the unmodified file, but two still fail. Prepending 160 ms of silence recovers all five, so this remains an experimental preset sensitive to feature-frame alignment; broader accent and false-trigger accuracy requires more recordings. See the [recording analysis](../../docs/research/kws-iru-recording.md) for the offset and audio-perturbation results.

The Chinese preset retains standard second-tone `f éi` and adds the model’s observed first-tone `f ēi` alternatives, with boost `1` and threshold `0.1`. On one supplied recording this improves full-phrase detections from two of eight to five of eight; three 肥鱼肥鱼 attempts remain missed. The accidental standalone 肥鱼 does not trigger. See the [Chinese recording analysis](../../docs/research/kws-feiyu-recording.md) for the controlled probes and remaining limits.

Edit the vocabulary and click **应用词表** to replace it while listening. **暂停检测** applies an empty vocabulary; applying the draft again resumes detection. Invalid updates leave the active words unchanged. Stopping listening releases the microphone; starting again or processing a file creates fresh audio state. Leaving the route terminates capture and the Worker. Files are downmixed to mono and padded with one second of silence to finish streaming detection.

The page keeps the last 100 hits with source names and upstream token timestamps. Those timestamps belong to decoder segments and can restart after a hit; they are not absolute positions in the source recording. Model loading and inference run in a Worker, with a bounded microphone queue to prevent an ever-growing backlog. Audio stays on the device.

`test:prepare` downloads the official `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20` release. Vite includes its encoder, decoder, joiner and token table as separate sandbox assets (about 14 MB total), alongside the KWS WASM. The npm library still ships without models. Production and preview build workflows prepare these assets as well. Regression tests use upstream `zh_5.wav` and `en_0.wav` with a separate test vocabulary (`周望军`, `落实`, `LIGHT UP`); those recordings do not contain the playground wake words. The recordings are test fixtures and are not bundled into the page.

For a private Iru regression recording, set `SHERPAW_KWS_TEST_RECORDING=/absolute/path/iru.wav` when running `test:kws`. Supply mono 16-bit PCM WAV audio saying Hey Iru, Hello Iru, then Iru Iru with pauses. The opt-in test checks the exact three detections through file input (including 160 ms and 480 ms of added leading silence) and Chromium’s simulated microphone; without the variable it is skipped. For the second, 27-second repeated-Hello recording, set `SHERPAW_KWS_TEST_REPEATED_RECORDING=/absolute/path/repeated-iru.wav`. That opt-in test preserves the known partial result (three of five Hellos), checks all five with a 160 ms shift, and checks each full Hello phrase in isolation. These variables refer to specific local regression fixtures, not arbitrary audio. Keep private recordings outside the repository. The regular suite also checks the English preset against unrelated upstream English and Chinese audio.

For the specific Chinese recording described above, set `SHERPAW_KWS_TEST_CHINESE_RECORDING=/absolute/path/chinese.wav`. Its opt-in test checks five recovered phrases through file input, at least three through simulated-microphone input (capture alignment changes the result), and rejection of the standalone-name crop. All three private recording variables can be supplied together.

A fourth natural-speech recording has an unresolved seven-utterance target. Set `SHERPAW_KWS_TEST_NATURAL_RECORDING=/absolute/path/natural.wav` to run its opt-in regression: it currently **fails** with three detections instead of seven. This differs from the earlier tests that document partial successes; do not interpret their passing status as general wake-word reliability. The [Chinese recording analysis](../../docs/research/kws-feiyu-recording.md#fourth-recording-natural-speech-versus-deliberate-articulation) includes the decoder trace and rejected tuning changes.

The implementation lives in `src/features/kws/` and `src/pages/kws.vue`. `pnpm -F @sherpaw/sandbox test:kws` exercises the real UI, Worker, external model assets, file input, microphone capture, vocabulary replacement, error recovery and route cleanup in Chromium. Japanese remains unverified; this playground uses the Chinese/English model.

## Speaker page organization

- `src/pages/speaker-identification.vue`: route integration and mount/unmount lifecycle.
- `src/features/speaker-identification/`: page markup and controller, scoped styles, Worker protocol, sample management, recording, and result rendering.
- `tests/speaker-identification/`: UI/recorder regressions and a separate harness used by `testing-audio`.
- `../speaker-identification`: the public extractor/database API and library tests.
- `../testing-audio/cases/speaker-identification`: the fixed, reviewed audio corpus.

The page and tests load unchanged ONNX bytes from the pinned Hugging Face model submodules. A normal sandbox build includes model/WASM assets and excludes the test harness. Prepare the model submodules before building.

## Deploy

The [Cloudflare Workers deployment guide](../../docs/deployment/cloudflare-workers.md) covers production, reviewed PR previews, required secrets, and local deployment checks. As in AIRI, `unplugin-basemove` uploads large model assets to S3-compatible storage and rewrites their URLs to stay within Workers' static asset size limit.

## Validate

```sh
pnpm -F @sherpaw/sandbox typecheck
pnpm -F @sherpaw/sandbox test:speaker
pnpm -F @sherpaw/sandbox test:kws
pnpm -F @sherpaw/testing-audio test:speakers
pnpm -F @sherpaw/sandbox build
pnpm -F @sherpaw/sandbox preview
```

Speaker tests cover UI interactions, route cleanup, sample management, recording peaks, and long recordings. Fixed audio cases use the same Worker/recorder with external browser requests blocked. Tests never generate TTS audio.
