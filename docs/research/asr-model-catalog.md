# Streaming ASR model selector

The sandbox retains three model families: Paraformer zh-en, X-ASR zh-en, and the
2025 Chinese Zipformer. All three accept continuous microphone input without
an external VAD. Other experimental model integrations have been removed.

## Models

| Model | Runtime files | Backend |
| --- | ---: | --- |
| Paraformer zh-en | Existing pinned model pack | CPU/WASM; experimental WebGPU |
| X-ASR zh-en, punctuation, 480 ms, INT8 | 169 MB | CPU/WASM Worker |
| X-ASR zh-en, punctuation, 480 ms, FP32 | 615 MB | CPU/WASM Worker |
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
A small native C API bridge owns model configuration, endpoint detection, and
stream flushing. The existing Paraformer experiment preserves Sherpa's audio
frontend and decoding while optionally running its encoder/decoder through
ONNX Runtime Web. That WebGPU bridge does not support X-ASR or Zipformer.

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
X-ASR FP32 still executes through CPU/WASM; it does not enable WebGPU.
