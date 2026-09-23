# Sherpaw playgrounds: speaker identification

A local playground for `@sherpaw/speaker-identification`: load a model, register speakers with multiple recordings, and compare identification results from manual microphone recordings.

## Run

From the repository root, install dependencies and prepare the pinned Hugging Face model submodules (requires Git LFS):

```sh
pnpm install
pnpm -F @sherpaw/speaker-identification test:prepare
pnpm --filter @sherpaw/playground-speaker-identification... build
pnpm dev:speaker
```

Open the URL printed by Vite. Select a model, load it, and enter a name to start recording. The same name can have multiple samples. Rename or remove speakers, delete individual samples, and create independent identification recordings. Each result displays candidate similarity scores. The session is kept in memory and clears on refresh or model changes.

## Organization

- `src/`: page UI, Worker client and protocol, sample management, recording, and score rendering.
- `tests/`: UI interactions, recorder regressions, and a separate browser harness for fixed audio cases. Fixture loading and timed recording are not included in the app build.
- `../../packages/speaker-identification`: the public extractor/database API and its library tests.
- `../../packages/testing-audio/cases/speaker-identification`: the fixed, reviewed audio corpus and regression cases.

The app and tests load `preload.data` from the model submodules. These packs contain unchanged ONNX bytes. Building the playground includes the model and WASM assets, so a production preview can run without source files or a Hugging Face request.

## Validate

```sh
pnpm -F @sherpaw/playground-speaker-identification typecheck
pnpm -F @sherpaw/playground-speaker-identification test:run
pnpm -F @sherpaw/testing-audio test:speakers
pnpm -F @sherpaw/playground-speaker-identification build
pnpm -F @sherpaw/playground-speaker-identification preview
```

The playground has four interaction tests and four recorder tests. The six fixed audio cases use the same Worker/recorder through the test harness, with external browser requests blocked. Tests never generate TTS audio.
