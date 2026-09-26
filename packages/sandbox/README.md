# Sherpaw sandbox

The Vue sandbox exposes ASR at `/asr`, speaker identification at `/speaker-identification`, and keyword spotting at `/kws`. All routes are linked from the home page.

## Run

From the repository root, install dependencies and prepare the pinned speaker model packs (requires Git LFS):

```sh
pnpm install
pnpm -F @sherpaw/speaker-identification test:prepare
bash scripts/prepare-kws-models.sh
pnpm --filter @sherpaw/sandbox... build
pnpm dev
```

Open `/speaker-identification` at the URL printed by Vite. Load a model, register speakers with multiple recordings, and compare manually recorded identification results. Speakers and individual samples can be renamed or deleted as appropriate. Leaving the route releases its microphone and Worker; returning creates an empty session.

## Keyword spotting playground

Open `/kws`, choose **Model setup** and load the Chinese/English Zipformer 3M model, then start listening or choose an audio file. The page shares its layout, model-setup popover and buttons with `/asr`. Expand **关键词设置** to select a preset or edit the vocabulary.

The English preset contains `Hey Iru`, `Hello Iru`, and `Iru Iru` (Iru pronounced “伊噜”). The Chinese preset contains `你好肥鱼`, `大肥鱼`, and `肥鱼肥鱼`. Each row is `{ label, matches, score, threshold }`; each line of space-separated tokens represents one pronunciation. Tokens must already be encoded for the model. Selecting a preset applies it immediately after loading. Manual edits require **应用词表**.

**暂停检测** applies an empty vocabulary; applying the draft again resumes detection. Invalid updates retain the active vocabulary. Vocabulary changes reset audio state. The playground uses 16 search candidates for English and 32 for Chinese. These are experimental presets: natural pronunciation can still be missed, and passing the upstream regression fixtures does not establish wake-word accuracy.

Audio stays on the device. KWS and speaker identification share the microphone lifecycle and raw PCM worklet in `src/features/audio/`; KWS batches and clamps its input while speaker recordings normalize the whole clip. Stopping or leaving the route releases the device; leaving also terminates the inference Worker. Files are downmixed to mono and padded with one second of silence. The last 100 detections include source names and upstream segment timestamps, which can restart after a hit and are not absolute audio positions.

The model is a pinned Hugging Face preload pack under `models/huggingface/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`. Vite includes `preload.data` and `preload.js.metadata`; the Worker loads them with `@sherpaw/preloader`. Source download and packing scripts live under `models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`. CI downloads the published pack without needing Docker. The npm library includes no model or recordings.

`pnpm -F @sherpaw/sandbox test:kws` exercises the real UI, Worker, packed model, file input, microphone, vocabulary replacement, error recovery and route cleanup. Upstream Chinese and English fixtures use a separate regression vocabulary. Private recording tests are opt-in via `SHERPAW_KWS_TEST_RECORDING`, `SHERPAW_KWS_TEST_REPEATED_RECORDING`, `SHERPAW_KWS_TEST_CHINESE_RECORDING` and `SHERPAW_KWS_TEST_NATURAL_RECORDING`; they require specific local WAV fixtures, and the last includes a known failing seven-utterance target. Keep those recordings and their analysis notes outside Git. Japanese remains unverified.

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
