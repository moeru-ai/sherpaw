# Streaming ASR model selector

The `/asr` sandbox offers three streaming model families without an external VAD:

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

**Load model** prepares the recognizer without microphone access; **Start** reuses
it. **Stop**, model changes, and route exit release its resources. Paraformer's
existing custom model setup remains available. Microphone input is the only
interactive audio source.

## Runtime

CPU/WASM is the default. X-ASR and Zipformer use dedicated Workers and a native
C API for Sherpa feature extraction, endpoint detection, decoding, and flushing.
X-ASR FP32 can run its encoder in ONNX Runtime Web while keeping decoder/joiner
on CPU. Separate synchronous CPU and asynchronous WebGPU WASM builds avoid
adding async bridge overhead to CPU inference. Paraformer's experimental
backends use the same tensor transport, including INT64 streaming state.
No custom GPU operators or model graph changes are required.

GPU dispatch counters verify actual GPU activity; missing hardware support and
bridge failures produce errors. Quantized operators can fall back to CPU within
ORT Web, so INT8 WebGPU may be slower than CPU. The X-ASR GPU path copies encoder
inputs, outputs, and caches across the bridge each chunk and retains the native
session for metadata/error recovery. Peak memory and Android/Electron native
performance have not been validated.

## Prepare and run

Use Python 3.11+, Git LFS, pnpm, and activated Emscripten 4.0.23:

```sh
pnpm install
git submodule update --init --recursive sherpa-onnx/upstream \
  models/huggingface/sherpaw-paraformer-zh-en
git -C models/huggingface/sherpaw-paraformer-zh-en lfs pull
pnpm -F @sherpaw/speaker-identification test:prepare
python3 scripts/prepare-asr-models.py
bash scripts/build-webgpu-experiment.sh
# Additional original FP32 weights for Paraformer's FP32 WebGPU option:
uv run scripts/prepare-float-asr.py
pnpm --filter @sherpaw/sandbox... build
pnpm --filter @sherpaw/sandbox dev --host 127.0.0.1 --port 5187
```

The model preparer accepts IDs `x-asr`, `x-asr-fp32`, and `zipformer-zh`; each also
has `models/<upstream-name>/download.sh`. Weights live under each model's `model/`
directory and are served through generated public symlinks. Generated weights
and WASM binaries are not committed. `SHERPAW_DEPS_CACHE` optionally reuses an
existing native dependency cache during bridge builds.

Local production builds copy prepared ONNX assets. They exceed Cloudflare's
static per-file limit, and the deployment uploader currently handles `.data`
files only. Public deployment still needs CDN/manifest integration.

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
