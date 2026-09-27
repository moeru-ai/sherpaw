# Sherpaw sandbox

The Vue sandbox exposes ASR at `/asr`, speaker identification at `/speaker-identification`, and keyword spotting at `/kws`. All routes are linked from the home page.

## Run

From the repository root, install dependencies and prepare the pinned speaker model packs (requires Git LFS):

```sh
pnpm install
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm --filter @sherpaw/sandbox... build
pnpm dev
```

Open `/speaker-identification` at the URL printed by Vite. Load a model, register speakers with multiple recordings, and compare manually recorded identification results. Speakers and individual samples can be renamed or deleted as appropriate. Leaving the route releases its microphone and Worker; returning creates an empty session.

## Keyword spotting playground

Open `/kws`, choose **Model setup** and load the Chinese/English Zipformer 3M model, then select **Start** or **Test audio file**. The page shares its layout, model-setup popover and buttons with `/asr`. Inside **Model setup**, expand **Keywords** to select a preset or edit the vocabulary.

The English preset contains `Hey Iru`, `Hello Iru`, and `Iru Iru` (Iru pronounced “ee-roo”). The Chinese preset contains `你好肥鱼`, `大肥鱼`, and `肥鱼肥鱼`. Each row is `{ label, matches, score, threshold }`; each line of space-separated tokens represents one pronunciation. Tokens must already be encoded for the model. Selecting a preset applies it immediately after loading. Manual edits require **Apply**.

**Pause detection** applies an empty vocabulary; applying the draft again resumes detection. Invalid updates retain the active vocabulary. Vocabulary changes reset audio state. The playground uses 16 search candidates for English and 32 for Chinese. These are experimental presets: natural pronunciation can still be missed, and passing the upstream regression fixtures does not establish wake-word accuracy.

Audio stays on the device. KWS and speaker identification share the microphone lifecycle and raw PCM worklet in `src/features/audio/`. Following AIRI, `useDevicesList` selects the available default input and `useUserMedia` owns the stream. Each recording has its own Vue effect scope, released together with the stream on stop/abort, including a late permission grant. A stale device retries the browser default; the input stays fixed during a recording. KWS batches and clamps its input while speaker recordings normalize the whole clip. Stopping or leaving the route releases the device; leaving also terminates the inference Worker. Files are downmixed to mono and padded with one second of silence. The last 100 detections include source names and upstream segment timestamps, which can restart after a hit and are not absolute audio positions.

The sandbox downloads the pinned Hugging Face `preload.data` and `preload.js.metadata` at runtime and passes the bytes to `@sherpaw/preloader`. Its URL and fallback policy live in `src/features/kws/models.ts`; `@sherpaw/kws` has no model download policy, local paths or Hugging Face URLs. Library users fetch their chosen model in JS/TS and load it before creating the detector.

In development, `virtual:local-models` exports `fetchLocalModel(path): Promise<Response>`. The Vite plugin serves files relative to the repository's `models/` directory over the dev server. KWS first tries `huggingface/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/install/bin/wasm/`. If local loading fails, it downloads the remote pack. To use local packs, optionally run `bash scripts/prepare-kws-models.sh`. Source download/build/pack scripts remain under `models/<model-name>/`.

For production builds the virtual module exports an async function that throws when called. The same sandbox code catches it and downloads from Hugging Face. Building requires no local KWS model, emits no KWS model assets or local paths, and Cloudflare deployment does not prepare KWS models. The WASM runtime remains bundled; inference and audio stay on the device.

`pnpm -F @sherpaw/sandbox test:kws` exercises the real UI, Worker, packed model, file input, microphone, vocabulary replacement, error recovery and route cleanup. Upstream Chinese and English fixtures use a separate regression vocabulary. Private recording tests are opt-in via `SHERPAW_KWS_TEST_RECORDING`, `SHERPAW_KWS_TEST_REPEATED_RECORDING`, `SHERPAW_KWS_TEST_CHINESE_RECORDING` and `SHERPAW_KWS_TEST_NATURAL_RECORDING`; they require specific local WAV fixtures, and the last includes a known failing seven-utterance target. Keep those recordings and their analysis notes outside Git. Japanese remains unverified.

## Speaker page organization

- `src/pages/speaker-identification.vue`: route integration and mount/unmount lifecycle.
- `src/features/speaker-identification/`: page markup and controller, scoped styles, Worker protocol, sample management, recording, and result rendering.
- `tests/speaker-identification/`: UI/recorder regressions and a separate harness used by `testing-audio`.
- `../speaker-identification`: the public extractor/database API and library tests.
- `../testing-audio/cases/speaker-identification`: the fixed, reviewed audio corpus.

The page and tests load unchanged ONNX bytes from the pinned Hugging Face model submodules. The speaker page still bundles its model/WASM assets and excludes the test harness. Prepare the model submodules before building.

## Deploy

The [Cloudflare Workers deployment guide](../../docs/deployment/cloudflare-workers.md) covers production, reviewed PR previews, required secrets, and local deployment checks. As in AIRI, `unplugin-basemove` uploads large model assets to S3-compatible storage and rewrites their URLs to stay within Workers' static asset size limit.

## Validate

All sandbox tests use `vitest.config.ts`: Node tests drive the pages and test the Vite plugin, while browser tests exercise the recorder. `tsconfig.tests.json` checks all test sources. `pnpm -F @sherpaw/sandbox test` runs them together; the feature commands below filter test paths without separate configs. Run `pnpm -F @sherpaw/kws test:prepare` to download the pinned packs and upstream audio fixtures for KWS regression tests. Production loading tests intercept the exact HF URLs with those model bytes for repeatability.

```sh
pnpm -F @sherpaw/sandbox typecheck
pnpm -F @sherpaw/sandbox test:speaker
pnpm -F @sherpaw/sandbox test:kws
pnpm -F @sherpaw/testing-audio test:speakers
pnpm -F @sherpaw/sandbox build
pnpm -F @sherpaw/sandbox preview
```

Speaker tests cover UI interactions, route cleanup, sample management, recording peaks, and long recordings. Fixed audio cases use the same Worker/recorder with external browser requests blocked. Tests never generate TTS audio.
