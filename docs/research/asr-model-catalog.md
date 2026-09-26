# Streaming ASR model selector

The sandbox retains three model families: Paraformer zh-en, X-ASR zh-en, and the
2025 Chinese Zipformer. All three accept continuous microphone input without
an external VAD. Other experimental model integrations have been removed.

## Models

| Model | Runtime files | Backend |
| --- | ---: | --- |
| Paraformer zh-en | Existing pinned model pack | CPU/WASM; experimental WebGPU |
| X-ASR zh-en, punctuation, 480 ms, INT8 | 169 MB | CPU/WASM Worker |
| X-ASR zh-en, punctuation, 480 ms, FP32 | 615 MB | CPU/WASM Worker; experimental WebGPU encoder |
| Zipformer Chinese, 2025-06-30, INT8 | 167 MB | CPU/WASM Worker; Chinese only |

The source of truth for the new model variants is
[`models/asr-catalog.json`](../../models/asr-catalog.json). Download scripts
pin archive sizes and SHA-256 digests from the official
[ASR release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models).
The Transducer decoder stays in its upstream precision; encoder and joiner
are INT8 in the quantized variants. The optional X-ASR FP32 variant uses the
upstream floating-point encoder, decoder, and joiner, rather than converting
quantized weights back to float. The catalog explicitly names every weight
file so that an FP32 selection cannot silently prefer an INT8 file.
These sizes describe model files, not peak runtime memory.

The **Load model** button initializes the selected recognizer without opening
the microphone. **Start** reuses that recognizer. **Stop**, changing models,
and leaving the route release its resources. The only interactive audio input
is the microphone. The old custom model setup remains available under
Paraformer's backend selector.

X-ASR and Zipformer execute in dedicated Workers with one CPU inference thread.
X-ASR FP32 also offers **WebGPU — FP32 encoder, CPU decoder/joiner**.
This backend retains Sherpa feature extraction, endpoint detection, token decoding,
and streaming state updates while ONNX Runtime Web executes the encoder.
It requires hardware WebGPU; failures are reported instead of silently succeeding
on the native CPU encoder. GPU dispatch counts are included in live metrics.
A small native C API bridge owns model configuration, endpoint detection, and
stream flushing. The existing Paraformer experiment preserves Sherpa's audio
frontend and decoding while optionally running its encoder/decoder through
ONNX Runtime Web. The shared tensor bridge also supports the X-ASR encoder, including its INT64
processed-length state. No custom GPU operators or model graph changes are used.

Paraformer's FP32 WebGPU option is experimental: it requires additional weights, and
performance depends on the GPU and browser. INT8 WebGPU can be slower than CPU
because unsupported quantized operators fall back to CPU. Default inference
remains CPU/WASM. This work does not validate Android or Electron native builds.

## Prepare and run

Use Python 3.11+, Git LFS, pnpm, and Emscripten 4.0.23. From the repository root:

```sh
pnpm install
git submodule update --init --recursive sherpa-onnx/upstream \
  models/huggingface/sherpaw-paraformer-zh-en
git -C models/huggingface/sherpaw-paraformer-zh-en lfs pull
pnpm -F @sherpaw/speaker-identification test:prepare
python3 scripts/prepare-asr-models.py
# Activate Emscripten before building the optional sandbox bridges.
bash scripts/build-webgpu-experiment.sh
pnpm --filter @sherpaw/sandbox... build
pnpm --filter @sherpaw/sandbox dev --host 127.0.0.1 --port 5187
```

The preparer supports selected IDs: `x-asr`, `x-asr-fp32`, and `zipformer-zh`. Each also has
its own `models/<upstream-name>/download.sh`. Weights are stored under
`models/<upstream-name>/model/`; generated public symlinks serve them to Vite.
Neither weights nor generated WASM binaries are committed. An optional
`SHERPAW_DEPS_CACHE` points the bridge build at an existing native dependency
cache; it is not needed for a normal fresh build.

For the optional FP32 Paraformer WebGPU choice:

```sh
uv run scripts/prepare-float-asr.py --fp32-only
```

The sandbox's local production build copies prepared public model assets.
These raw ONNX assets are too large for Cloudflare's static per-file limit;
the existing deployment uploader only handles `.data` files. Hosting the new
models on a CDN and rewriting their manifests is a separate deployment task.

## Verification

Short fixtures run in Chrome against the dev server:

```sh
node scripts/check-asr-models.mjs
```

The driver checks the Chinese fixture for every variant and English for X-ASR.
It records actual text and timings; phrase matches are smoke checks, not a
CER/WER benchmark. `SHERPAW_ASR_MODELS` selects comma-separated model IDs.

The real-time suite uses the existing fakemic plugin and the visible selector:

```sh
node scripts/generate-realtime-asr.mjs
pnpm --filter @sherpaw/sandbox build
pnpm --filter @sherpaw/sandbox exec vitest run \
  --config vitest.asr-realtime.config.ts tests/asr/models.audio.test.ts
```

Each model gets 60 seconds of audio at microphone speed. X-ASR uses the mixed
Chinese/English fixture; Chinese-only Zipformer uses eight repeated Chinese
utterances. Tests check speech after 45 seconds, capture/processing continuity,
final flushing, stopped microphone tracks and Worker release. Reports are
written to `docs/research/asr-models-realtime/`; fixtures are generated locally.
The Paraformer suite is `tests/asr/realtime.audio.test.ts`; WebGPU cases require
hardware-accelerated Chrome and the optional FP32 model assets.

## Validation after reducing the model list

On 2026-09-26, Chrome on the development Mac passed:

- 60-second microphone tests for X-ASR, Chinese Zipformer, and Paraformer FP32
  WebGPU: 3 passed; the other 3 Paraformer backend cases were not rerun.
- Both real-time metric tests: 2 passed.
- Short-fixture checks: Chinese for both new models, English for X-ASR.
- Visible selector inspection: exactly `paraformer`, `zipformer-zh`, `x-asr`.
- Native bridge builds, sandbox production build, type checking, changed-source
  lint, and changed-file spell checking.

These checks verify the local sandbox and audio lifecycle. They do not establish
recognition accuracy on arbitrary speech or performance on Android devices.

## X-ASR FP32 validation

The FP32 option uses the matching upstream 2026-06-05 bilingual, punctuation,
480 ms model. Its archive size and SHA-256 were verified before extraction.
ONNX inspection confirmed FLOAT weights and no quantization operators in all
three networks. Their input/output signatures and frontend metadata match the
INT8 variant; the decoder and token file are byte-identical between variants.

On 2026-09-26, Chrome on the development Mac passed Chinese and English short
fixtures for both X-ASR precisions. The visible selector has four choices:
`paraformer`, `zipformer-zh`, `x-asr`, and `x-asr-fp32`. Sandbox production build,
type checking, changed-source lint, and changed-file spell checking passed.
The FP32 60-second microphone test also passed, including continued text after
45 seconds, matching capture/processing duration, final flush, and resource
cleanup. It processed 60.12 seconds of audio with 6.72 seconds of total processing
time on this Mac; this single functional run is not a comparative benchmark.
This initial validation used CPU/WASM. See the WebGPU experiment below for the
subsequent encoder integration.

## X-ASR FP32 WebGPU experiment

Choose X-ASR FP32, then its WebGPU encoder backend in `/asr`. Other catalog
variants keep CPU/WASM. The GPU option uses the same original FP32 weights.
The decoder and joiner remain on CPU. A separate `catalog-asr-webgpu` runtime
contains the asynchronous bridge; `catalog-asr` keeps its synchronous CPU build.
A target-local Zipformer2 encoder hook
preserves the pinned upstream source; it shares tensor transport with Paraformer.

Run the GPU checks with:

```sh
SHERPAW_ASR_MODELS=x-asr-fp32 SHERPAW_ASR_BACKEND=webgpu-encoder \
  SHERPAW_ASR_REPORT_SUBDIR=asr-models-webgpu/ node scripts/check-asr-models.mjs
pnpm --filter @sherpaw/sandbox build
SHERPAW_ASR_MODELS=x-asr-fp32 SHERPAW_ASR_BACKEND=webgpu-encoder \
  pnpm --filter @sherpaw/sandbox exec vitest run \
  --config vitest.asr-realtime.config.ts tests/asr/models.audio.test.ts
```

The short Chinese and English fixtures passed with nonzero GPU dispatches.
The prototype copies encoder inputs and all outputs, including streaming caches,
across the WASM/browser boundary on each chunk. It also retains the native CPU
session for Sherpa metadata and error recovery, so memory includes both runtimes.
This implementation establishes compatibility; it does not imply a speedup or
suitable peak memory use on Android.

### Real-time comparison on 2026-09-26

After native builds completed, Chrome 153 on the development Mac ran CPU and
WebGPU sequentially against the same 60-second bilingual fakemic fixture.
Both passed late-speech, continuity, final-text, microphone-stop, and Worker
cleanup checks. Their final transcripts were identical.

| Metric | CPU/WASM FP32 | WebGPU encoder + CPU decoder/joiner |
| --- | ---: | ---: |
| Captured and processed audio | 60.056 s | 60.120 s |
| Cumulative audio processing time | 6.813 s | 11.157 s |
| Inference batch P95 | 66.2 ms | 116.3 ms |
| First partial text from capture start | 3.088 s | 3.193 s |
| Maximum outstanding audio | 0.176 s | 0.336 s |
| Stop drain | 106.4 ms | 236.6 ms |
| GPU dispatches | 0 | 439,039 |

Processing time sums audio accept calls; it excludes model loading, waiting for
microphone input, and the separately reported Stop drain. Batch latency is not
word-level recognition latency. These are single functional runs, with shaders
potentially cached from the earlier smoke tests, not a warmed multi-run benchmark.
The current GPU path spent about 64% more time processing than CPU on this Mac,
while both kept up with live input. Cache transfers, dispatch overhead, and async
bridging are optimization candidates; this run does not isolate their costs.
CPU remains the default.

The shared bridge also passed the existing Paraformer FP32 WebGPU 60-second
regression test. Other Paraformer backends were not rerun. Production build,
type checking, changed-source lint, and changed-file spell checks passed.
