# Speaker identification: upstream implementation and on-device models

Research date: 2026-09-22. Sources are upstream code, model cards, papers, and release assets. Model-card results are author-reported and were not reproduced in Sherpaw. Here, deployment primarily means browser WASM; native mobile support alone does not establish browser compatibility.

Sherpa already provides embedding extraction, enrollment, search, and verification. No classifier of speaker names is needed. CAM++ Chinese/English advanced is the initial compact candidate; ERes2NetV2 is the larger comparison. ReDimNet2 is a research candidate that still requires export and feature compatibility work.

## Upstream behavior

Verification asks whether two recordings belong to the same speaker. Identification searches an enrolled library. Diarization assigns speakers to time segments. Names come from application enrollment; the model returns a vector, not a person's real identity. See the [official identification guide](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/index.html).

```text
enroll:   single-speaker audio -> embedding -> application speaker ID -> manager
identify: single-speaker audio -> embedding -> cosine search -> best match or unknown
verify:   single-speaker audio -> embedding -> named enrollment -> accept or reject
```

- `SpeakerEmbeddingExtractor` selects the WeSpeaker, 3D-Speaker, or NeMo backend from model metadata. The first two use the general filter-bank path and metadata-controlled utterance mean normalization; NeMo has a separate implementation. A runnable ONNX graph alone does not establish compatibility. See [backend selection](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/speaker-embedding-extractor-impl.cc) and the [general extractor](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/speaker-embedding-extractor-general-impl.h).
- `SpeakerEmbeddingManager` stores normalized vectors in memory. Multiple enrollment embeddings are summed and normalized into one representative vector per name. Queries are normalized and scored against every enrollment by dot product, equivalent to cosine similarity. It also supports verification, ranked matches, and removal. See the [manager implementation](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/speaker-embedding-manager.cc).
- `OnlineStream` describes input delivery, not reliable frame-by-frame identity decisions. The general extractor checks for unprocessed feature frames and consumes them when computing an embedding. Segment speech or collect an utterance before extraction, then validate duration and stability separately. See the [VAD example](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/speaker-identification-with-vad.py).

## Downloadable candidates

Sizes are decimal bytes from the official [release assets](https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/tags/speaker-recongition-models). The misspelling in the release tag is upstream's original name.

| Candidate | ONNX asset | Size | Original model-card result | Card license |
| --- | --- | --- | --- | --- |
| CAM++ Chinese/English advanced | `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` | 28,281,164 bytes | CN-Celeb Test EER 5.98%; VoxCeleb-O 1.16% | Apache-2.0 |
| ERes2NetV2 Chinese common | `3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx` | 71,441,526 bytes | CN-Celeb Test EER 3.81% | Apache-2.0 |

The [CAM++ card](https://modelscope.cn/api/v1/models/iic/speech_campplus_sv_zh_en_16k-common_advanced/repo?Revision=master&FilePath=README.md) describes Chinese/English training. The [ERes2NetV2 card](https://modelscope.cn/api/v1/models/iic/speech_eres2netv2_sv_zh-cn_16k-common/repo?Revision=master&FilePath=README.md) describes about 200,000 Chinese speakers and 16 kHz input. These are not comparable architecture benchmarks under identical training and preprocessing, nor verified results for the release ONNX files. The cards' example thresholds, 0.33 and 0.365, are not production identification thresholds.

CAM++ is the demo default because it covers both languages and is about 40% of the larger model's download size. This is an engineering choice, not a claim of universally better accuracy or latency.

## Other candidates

An on-device SOTA claim needs a specified dataset, utterance duration, scoring method, and device. Deployment maturity and research accuracy are separate considerations.

| Candidate | Evidence | Sherpaw assessment |
| --- | --- | --- |
| CAM++ / 3D-Speaker | Efficiency-oriented architecture, ONNX export tooling, and existing sherpa assets | Initial browser candidate |
| ERes2Net / ERes2NetV2 | Existing sherpa assets; variants have different sizes and training data | Larger comparison; measure mobile memory and startup |
| WeSpeaker ResNet / CAM++ / ECAPA | Official ONNX model catalog; sherpa includes several ResNet variants and CAM++ | Useful existing-backend baselines; catalog availability is not automatic sherpa compatibility |
| SpeechBrain ECAPA-TDNN | Card reports 0.80% cleaned VoxCeleb1-test EER; embedding checkpoint about 83.3 MB; Apache-2.0 | Requires export and preprocessing alignment |
| ReDimNet2 | B0-B6 models, paper, and MIT-labeled repository/weight release | Promising size/accuracy research candidate; validate ONNX operators and features |
| ECAPA2 | Author-provided TorchScript; CC-BY-NC-4.0 model license | Research comparison, with license and deployment constraints |

Sources: [CAM++ paper](https://www.isca-archive.org/interspeech_2023/wang23ha_interspeech.html), [3D-Speaker](https://github.com/modelscope/3D-Speaker), [WeSpeaker catalog](https://github.com/wenet-e2e/wespeaker/blob/master/docs/pretrained.md), [SpeechBrain card](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb), [SpeechBrain files](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/tree/main), [ReDimNet2](https://github.com/PalabraAI/redimnet2), [ECAPA2 card](https://huggingface.co/Jenthe/ECAPA2).

3D-Speaker is a toolkit and model source, not another architecture. Its benchmark recipes are different from the specific downloadable model cards above. WeSpeaker also distinguishes code licenses from model/data licenses; see its [model license section](https://github.com/wenet-e2e/wespeaker/blob/master/docs/pretrained.md#model-license).

Selected ReDimNet2 results use VoxCeleb2-dev training and cleaned VoxCeleb1 testing:

| Variant | Parameters | Vox1-O / E / H EER | Released `*-vox2-lm.pt` size |
| --- | --- | --- | --- |
| B0 | 1.1 M | 1.04 / 1.16 / 1.97% | 5.61 MB |
| B2 | 3.6 M | 0.57 / 0.76 / 1.41% | 15.90 MB |
| B3 | 4.1 M | 0.42 / 0.66 / 1.22% | 17.93 MB |
| B6 | 12.3 M | 0.29 / 0.52 / 0.99% | 50.88 MB |

Sources: [official results](https://github.com/PalabraAI/redimnet2#results), [paper](https://arxiv.org/abs/2603.11841), [release API](https://api.github.com/repos/PalabraAI/redimnet2/releases/tags/v1.0.0). Checkpoint sizes are not ONNX/WASM sizes. Parameter counts and reported operation counts do not establish browser real-time performance. Models trained with additional VoxBlink2 or CN-Celeb2 data require separate comparisons.

## Implementation and model preparation

The native implementation uses upstream commit `917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e`. [`@sherpaw/speaker-identification`](../../packages/speaker-identification/README.md) exposes independent `createExtractor` and `createInMemoryDB` factories. Persistence belongs to the caller. Save model identity/version and dimension with every vector; equal dimensions do not make models interchangeable. Run synchronous extraction in a Worker.

Model download/pack scripts and published Hugging Face submodules were merged separately in [#10](https://github.com/moeru-ai/sherpaw/pull/10) and [#11](https://github.com/moeru-ai/sherpaw/pull/11). The demo and regression tests read the pinned submodules’ `install/bin/wasm/preload.data`, which is byte-for-byte identical to the source ONNX. The following download/pack workflow reproduces these published assets. Both models normalize to `model/normalized/speaker-embedding.onnx`. Downloads use the upstream release and pinned SHA-256 values, skip valid existing files, and avoid replacing files on a failed download. Optional `pack.sh` scripts use Docker with `emscripten/emsdk:4.0.23`, producing the standard separate-metadata preload files with virtual path `/speaker-embedding.onnx`. Runtime compilation is independent of model packaging.

Initial checks covered script syntax, download checksums, repeat-download behavior, Docker packaging, and byte-for-byte agreement between packaged data and ONNX. Native macOS CPU tests with sherpa-onnx 1.13.8 / ONNX 1.23.0 produced finite, nonzero 192-dimensional embeddings. Both assets declare 16 kHz, `3d-speaker`, and global-mean feature normalization.

| Model | fangjun: same / other score | leijun: same / other score | Unregistered liudehua: highest score |
| --- | --- | --- | --- |
| CAM++ advanced | 0.853525 / 0.306154 | 0.783094 / 0.190430 | 0.387771 |
| ERes2NetV2 | 0.901050 / 0.249239 | 0.812471 / 0.156868 | 0.252293 |

These three queries established basic loading and search behavior, not accuracy. Browser results and limitations are in the [historical experiments](speaker-identification-experiments.md) and [current ablation](speaker-identification-ablation.md).

## Remaining deployment work

Validate noise, distance, language changes, overlapping speech, and enrollment-library size with real users. VAD does not guarantee a single speaker. Measure cold start, peak memory, extraction p50/p95, and real-time factor on target phones; ONNX size is not runtime memory. The current runtime starts with 512 MiB WASM memory.

Native CPU success does not establish browser support. Likewise, ONNX Runtime Web's WebGPU and threading settings do not directly configure sherpa's C++/Emscripten module. Alternate execution paths require the corresponding build and browser deployment setup: [ORT Web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html), [thread configuration](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#envwasmnumthreads).
