# Streaming ASR model selector

The sandbox's existing **Transcription** page offers three streaming model
families through its **Model setup** popover, without an external VAD:

| Model | Runtime files | Backend |
| --- | ---: | --- |
| Paraformer zh-en | Existing pinned model pack | CPU/WASM; experimental WebGPU |
| X-ASR zh-en, punctuation, 480 ms, INT8 | 169 MB | CPU/WASM Worker |
| X-ASR zh-en, punctuation, 480 ms, FP32 | 615 MB | CPU/WASM Worker; experimental WebGPU encoder |
| Zipformer Chinese, 2025-06-30, INT8 | 167 MB | CPU/WASM Worker; Chinese only |

[`models/asr-catalog.json`](../../models/asr-catalog.json) pins the new variants'
archive sizes, SHA-256 digests, and explicit weight roles from the official
[ASR release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models).
FP32 uses original upstream weights. INT8 quantizes the encoder and joiner;
the decoder keeps its upstream precision. Sizes above exclude runtime memory.
X-ASR's published Hugging Face packs follow the existing Sherpaw layout; see
[packaging and verification](./x-asr-model-packaging.md).

Inside **Model setup**, **Load model** prepares the recognizer without microphone access; **Start** reuses
it. **Stop**, model changes, and route exit release its resources. Paraformer's
existing custom model setup remains available. Microphone input is the only
interactive audio source. Recognition diagnostics are available in Model setup
after recording.

## Runtime

CPU/WASM is the default. Each built-in recognizer owns a dedicated Worker.
The page calls `createRecognizer({ modelId, backend, diagnostics })` and only
handles recording and display. Model adapters share the Worker protocol, native
runtime loading, PCM transfer, and ORT session/tensor transport:

- `features/asr/recognizer.ts`, `runtime.worker.ts`, `protocol.ts`: Eventa session boundary, shared with the KWS transport approach.
- `paraformer.ts`, `transducer.ts`: model-specific initialization and decoding.
- `custom.ts`: legacy Model setup adapter for its existing main-thread WASM instance.
- `native.ts`, `onnx.ts`: native and browser inference bridges.
- `features/models.ts`, `asr/models.ts`: local-models dev loading and pinned HF fallback.
- `features/audio/microphone.ts`: shared microphone capture with KWS and speaker identification; ASR requests 16 kHz and retains render-clock diagnostics.
- `realtime-metrics.ts`, `gpu-diagnostics.ts`: measurement and optional diagnostics.
- `sherpa-onnx/asr-runtime/`: native runtimes and explicit upstream hook patches.

The native C API retains Sherpa feature extraction, endpoint detection, decoding,
and flushing. Patches apply to build-local sources with zero fuzz; upstream
submodules stay unchanged.
X-ASR FP32 can run its encoder in ONNX Runtime Web while keeping decoder/joiner
on CPU. Separate synchronous CPU and asynchronous WebGPU WASM builds avoid
adding async bridge overhead to CPU inference. Paraformer's experimental
backends use the same tensor transport, including INT64 streaming state.
No custom GPU operators or model graph changes are required.

GPU dispatch counters verify actual GPU activity. Instrumentation is disabled
by default; the sandbox enables it inside the recognizer's Worker. Missing
hardware support and bridge failures produce errors. Quantized operators can
fall back to CPU within ORT Web, so INT8 WebGPU may be slower than CPU. The X-ASR GPU path copies encoder
inputs, outputs, and caches across the bridge each chunk and retains the native
session for metadata/error recovery. Peak memory and Android/Electron native
performance have not been validated.

## Prepare and run

Use Python 3.11+, Git LFS, pnpm, and activated Emscripten 4.0.23:

```sh
pnpm install
git submodule update --init --recursive sherpa-onnx/upstream
pnpm -F @sherpaw/speaker-identification test:prepare
bash scripts/build-asr-runtime.sh
pnpm --filter @sherpaw/sandbox... build
pnpm --filter @sherpaw/sandbox dev --host 127.0.0.1 --port 5187
```

ASR follows the KWS loading policy: the `local-models` Vite plugin serves
prepared weights from `models/` during development. Missing local weights and
production builds use pinned Hugging Face URLs. X-ASR and Paraformer read the
existing `preload.data` / `preload.js.metadata` packs; Chinese Zipformer and
Paraformer FP32 read upstream ONNX files. Browser inference no longer needs the
preparer's archive manifest or `public/asr-models` symlinks.

Optional local caches:

```sh
git submodule update --init models/huggingface/sherpaw-paraformer-zh-en \
  models/huggingface/sherpaw-x-asr-zh-en-480ms-int8 \
  models/huggingface/sherpaw-x-asr-zh-en-480ms-fp32
# Run git lfs pull in those submodules if LFS smudging is disabled.
python3 scripts/prepare-asr-models.py zipformer-zh
uv run scripts/prepare-paraformer-fp32.py
```

The archive preparer still accepts `x-asr` and `x-asr-fp32` for model packaging;
`models/<upstream-name>/download.sh` uses the same pinned archive verification.
Generated weights and WASM binaries are not committed. `SHERPAW_DEPS_CACHE`
optionally reuses an existing native dependency cache during bridge builds.
ASR weights are downloaded at runtime instead of copied into production builds.
Deployment still requires the locally built ASR JS/WASM bridges; model download
requires network access to Hugging Face when no local dev cache is available.

## Automated verification

One fakemic suite covers every model/backend combination through the visible UI:

```sh
pnpm --filter @sherpaw/sandbox test:asr-realtime
# Or select cases after generating fixtures and building:
SHERPAW_ASR_MODELS=x-asr-fp32 SHERPAW_ASR_BACKEND=cpu,webgpu-encoder \
  pnpm --filter @sherpaw/sandbox exec vitest run \
  --config vitest.asr-realtime.config.ts
```

Both filters accept comma-separated values; unset filters select all cases.
By default the suite tests the production build, including HF downloads. For
repeatable inference checks with prepared local weights, start the dev server
and run the same suite with `SHERPAW_ASR_DEV_URL=http://127.0.0.1:5187/asr`.
Cold FP32 downloads can exceed the test's 180-second loading deadline; the dev
option uses local-models and avoids measuring network availability.
Hardware-accelerated Chrome and prepared weights/bridges are required for GPU
cases. Each case loads without microphone access, then receives 60 seconds at
microphone speed. Zipformer uses repeated Chinese speech; others use a bilingual
fixture. Assertions cover late speech, capture/processing continuity, backlog,
final flushing, GPU dispatches, stopped tracks, and Worker release. Reports go to
`docs/research/asr-realtime/`; fixtures and reports stay local. Phrase checks are
functional checks, not a CER/WER benchmark.

## X-ASR FP32 comparison

On 2026-09-26, Chrome 153 on the development Mac ran CPU and WebGPU sequentially
with the same bilingual fixture. Both passed the lifecycle checks and produced
identical final text:

| Metric | CPU/WASM FP32 | WebGPU encoder + CPU decoder/joiner |
| --- | ---: | ---: |
| Captured and processed audio | 60.056 s | 60.120 s |
| Cumulative audio processing time | 6.813 s | 11.157 s |
| Inference batch P95 | 66.2 ms | 116.3 ms |
| First partial text from capture start | 3.088 s | 3.193 s |
| Maximum outstanding audio | 0.176 s | 0.336 s |
| Stop drain | 106.4 ms | 236.6 ms |
| GPU dispatches | 0 | 439,039 |

Processing time sums audio accept calls, excluding loading, microphone waits,
and Stop drain. Batch latency is not word-level latency. These single functional
runs may have cached shaders; they are not a warmed multi-run benchmark. GPU
processing took about 64% longer here, although both kept up with live input.
Cache transfers, dispatch overhead, and async bridging remain optimization
candidates; this measurement does not isolate their costs.
