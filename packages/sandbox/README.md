# Sherpaw sandbox

The Vue sandbox exposes ASR at `/asr`, speaker identification at `/speaker-identification`, speaker diarization at `/speaker-diarization`, and keyword spotting at `/kws`. All routes are linked from the home page.

## Run

From the repository root, install dependencies and prepare the pinned speaker model packs (requires Git LFS):

```sh
pnpm install
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm -F @sherpaw/speaker-diarization test:prepare
pnpm --filter @sherpaw/sandbox... build
pnpm dev
```

Open `/speaker-identification` at the URL printed by Vite. Load a model, register speakers with multiple recordings, and compare manually recorded identification results. Speakers and individual samples can be renamed or deleted as appropriate. Leaving the route releases its microphone and Worker; returning creates an empty session.

Open `/speaker-diarization`, choose **Model setup** and select **Initialize**, then choose an audio file. Set a known number of speakers or a distance threshold under **Clustering**, and select **Analyze again** to rerun without reloading the models. Select a segment to play it. In development the page first uses the local segmentation model from `models/sherpa-onnx-pyannote-segmentation-3-0/download.sh` and the local CAM++ pack, then falls back to Hugging Face.

## Keyword spotting playground

Open `/kws`, choose **Model setup** and load the Chinese/English Zipformer 3M model, then select **Start** or **Test audio file**. Inside **Model setup**, expand **Keywords** to select a preset or edit the vocabulary.

The English preset contains `Hey Iru`, `Hello Iru`, and `Iru Iru` (Iru pronounced “ee-roo”). The Chinese preset contains `你好肥鱼`, `大肥鱼`, and `肥鱼肥鱼`. Each line of space-separated tokens represents one pronunciation. Tokens must already be encoded for the model. Selecting a preset applies it immediately after loading. Manual edits require **Apply**.

**Pause detection** stops matching; **Apply** resumes with the edited keywords. Invalid updates retain the active vocabulary. Updates reset the audio state. These presets are experimental and can miss natural pronunciation.

Audio processing stays on the device. **Stop** releases the microphone; leaving the page ends the session. Detection timestamps are relative to decoder segments, not absolute positions in the recording.

The deployed playground downloads its model from Hugging Face. Development first checks the local model packs under `models/huggingface/`, then falls back to Hugging Face. To download the local packs, run:

```sh
bash scripts/prepare-kws-models.sh
```

To build model packs yourself, use the scripts in `models/<model-name>/`.

## Speaker page organization

- `src/pages/speaker-identification.vue`: route integration and mount/unmount lifecycle.
- `src/features/speaker-identification/`: page markup and controller, scoped styles, Worker protocol, sample management, recording, and result rendering.
- `tests/speaker-identification/`: UI/recorder regressions and a separate harness used by `testing-audio`.
- `../speaker-identification`: the public extractor/database API and library tests.
- `../testing-audio/cases/speaker-identification`: the fixed, reviewed audio corpus.
- `src/pages/speaker-diarization.vue` and `src/features/speaker-diarization/models.ts`: the diarization route and its model loading.

The page and tests load unchanged ONNX bytes from the pinned Hugging Face model submodules. The speaker page still bundles its model/WASM assets and excludes the test harness. Prepare the model submodules before building.

## Deploy

The [Cloudflare Workers deployment guide](../../docs/deployment/cloudflare-workers.md) covers production, reviewed PR previews, required secrets, and local deployment checks. As in AIRI, `unplugin-basemove` uploads large model assets to S3-compatible storage and rewrites their URLs to stay within Workers' static asset size limit.

## Validate

Run the sandbox tests and checks from the repository root:

```sh
pnpm -F @sherpaw/sandbox typecheck
pnpm -F @sherpaw/sandbox test
pnpm -F @sherpaw/testing-audio test:speakers
pnpm -F @sherpaw/sandbox build
pnpm -F @sherpaw/sandbox preview
```

Speaker tests cover UI interactions, route cleanup, sample management, recording peaks, and long recordings. Diarization tests upload the four-speaker recording, rerun it with a different clustering, cancel a run, and check that leaving the route terminates the Worker. Fixed audio cases use the same Worker/recorder with external browser requests blocked. Tests never generate TTS audio.
