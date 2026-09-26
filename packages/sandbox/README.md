# Sherpaw sandbox

The Vue sandbox exposes ASR at `/asr` and speaker identification at `/speaker-identification`. Both routes are linked from the home page.

## Run

From the repository root, install dependencies and prepare the pinned speaker model packs (requires Git LFS):

```sh
pnpm install
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm --filter @sherpaw/sandbox... build
pnpm dev
```

Open `/speaker-identification` at the URL printed by Vite. Load a model, register speakers with multiple recordings, and compare manually recorded identification results. Speakers and individual samples can be renamed or deleted as appropriate. Leaving the route releases its microphone and Worker; returning creates an empty session.

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
pnpm -F @sherpaw/testing-audio test:speakers
pnpm -F @sherpaw/sandbox build
pnpm -F @sherpaw/sandbox preview
```

Speaker tests cover UI interactions, route cleanup, sample management, recording peaks, and long recordings. Fixed audio cases use the same Worker/recorder with external browser requests blocked. Tests never generate TTS audio.

## Streaming ASR models

The `/asr` selector offers Paraformer zh-en, X-ASR zh-en (INT8 or FP32), and
Chinese Zipformer 2025. Use **Load model** to preload, then **Start** to open the microphone.
X-ASR and Zipformer use dedicated Workers. X-ASR FP32 offers an experimental
WebGPU encoder with CPU decoder/joiner; other catalog variants use CPU/WASM.
Paraformer also offers experimental WebGPU backends. These sandbox experiments require additional
model assets and locally built WASM bridges; follow the
[ASR preparation and validation guide](../../docs/research/asr-model-catalog.md).
