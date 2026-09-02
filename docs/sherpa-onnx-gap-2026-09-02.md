# Sherpaw 与 sherpa-onnx 能力差距盘点

核对日期：2026-09-02（Asia/Shanghai）

> 本文记录同步前基线。仓库随后已将主构建子模块同步到 `917bed95`；同步后的实现和测试状态见 [`sherpa-onnx-sync-2026-09-02.md`](./sherpa-onnx-sync-2026-09-02.md)。以下数字保留用于解释本轮升级的起点，不能作为同步完成后的工作区现状。

## 结论先行

“接入了多少模型”至少有三种口径，不能混算：

1. **仓库内可直接构建的 checkpoint：3 个，来自 2 个模型家族。** 分别是 1 个 streaming Paraformer checkpoint、2 个 streaming Zipformer Transducer checkpoint。目录见 [`models/`](../models/)，下载源均指向 sherpa-onnx 官方 `asr-models` release（例如 [Paraformer 下载脚本](../models/sherpa-onnx-streaming-paraformer-bilingual-zh-en/download.sh)）。语言、训练日期或量化版本只形成新 checkpoint，不形成新架构家族。
2. **Sherpaw JS/WASM 配置面：ASR 22 个顶层配置槽（5 online + 17 offline），VAD 2 个配置槽。** ASR 的 online/offline 槽存在重叠；把 Transducer 槽内部按源码分派的架构展开、再跨 online/offline 去重后，Sherpaw 主构建基线可覆盖约 **23 个 ASR 实现家族**。加上 2 个 VAD 家族，以及 speaker embedding 3 家族和 Pyannote segmentation 1 家族，代码级上限约为 **29/47 个唯一实现家族**。这里的“可覆盖”不代表仓库对每个家族都附带了模型、测试和 demo。
3. **真正包装成任务模块的范围：4 个目录，只有 3 个非 private 包。** 它们是 ASR、VAD、VAD+offline ASR、speaker diarization；其中 speaker diarization 的 `package.json` 标为 `private: true`。上游现有 7 个专用 WASM 任务模块，因此 Sherpaw 缺少 KWS、TTS、speech enhancement 三个 WASM 任务包装。

相对 sherpa-onnx 最新正式版，Sherpaw 的活跃官方子模块落后 **349 commits**：`9aa88f93`（源码版本 1.12.28，位于 v1.12.28 后第 3 个提交）到 `917bed95`（v1.13.7）。直接 tree diff 是 3,090 files、+194,147/-17,457；该数字包含 bindings、示例、CI 和生成文件，不能直接当作开发工作量。

更重要的实际差距是：缺 2 个最新 offline ASR 配置槽（Qwen3-ASR、Cohere Transcribe），缺若干整类任务包装，并存在一个已确认的导出不一致：`@sherpaw/asr` 的 JS/类型声明包含 `OfflineRecognizer`，但其 WASM 构建没有导出 `SherpaOnnxCreateOfflineRecognizer`；离线 ASR 当前应走 `@sherpaw/vad-asr`。

## 口径与基线

本报告把“模型”分为三层：

- **checkpoint**：具体权重包。语言、尺寸、fp32/int8、训练日期不同均可以产生不同 checkpoint。
- **配置槽**：C/C++/JS 配置结构中一个可选择的顶层模型入口。例如 `OfflineModelConfig::whisper`。
- **实现家族**：独立的运行时 adapter / metadata dispatch 路径。例如同一个 `transducer` 配置槽会分派到 Conformer、E-Branchformer、LSTM、Zipformer、Zipformer2；这些算不同实现家族。不同语言或 checkpoint 不增加家族数。

官方没有公布稳定的“模型家族总数”。本文的 **47** 是依据 `917bed95` 当前源码按上述规则做的分析计数，不是上游官方宣传数字。

### 两条子模块路径

仓库同时保留两条 sherpa-onnx 路径：

| 路径 | Git 索引 pin | 用途判断 |
|---|---|---|
| `sherpa-onnx/upstream` | [`9aa88f93aeda5b147488e213198dc58aec5ec166`](https://github.com/k2-fsa/sherpa-onnx/commit/9aa88f93aeda5b147488e213198dc58aec5ec166) | **当前主构建路径**；[`sherpa-onnx/CMakeLists.txt`](../sherpa-onnx/CMakeLists.txt) 的 `add_subdirectory(upstream)` 指向这里 |
| `upstream/sherpa-onnx` | `e7ef78be11fed077be12eb2dbab0dd79ce3da351` | legacy/定制 fork；当前顶层 WASM 构建入口不引用它 |

因此，“Sherpaw 固定上游”应以 `9aa88f93` 为准，不能只看到旧 fork 就以 `e7ef78be` 计算差距。

上游核对点：

- 最新正式版：[`v1.13.7`](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.13.7)
- 最新 commit：[`917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e`](https://github.com/k2-fsa/sherpa-onnx/commit/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e)，2026-09-01
- Sherpaw 活跃 pin：[`9aa88f93`](https://github.com/k2-fsa/sherpa-onnx/commit/9aa88f93aeda5b147488e213198dc58aec5ec166)，2026-03-05；其 [`CMakeLists.txt`](https://github.com/k2-fsa/sherpa-onnx/blob/9aa88f93aeda5b147488e213198dc58aec5ec166/CMakeLists.txt) 版本常量为 1.12.28
- 官方 compare：[`9aa88f93...917bed95`](https://github.com/k2-fsa/sherpa-onnx/compare/9aa88f93aeda5b147488e213198dc58aec5ec166...917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e)

## Sherpaw 当前接入情况

### 仓库自带 checkpoint：3 个 / 2 家族

| 目录 | 家族 | checkpoint 特征 |
|---|---|---|
| `sherpa-onnx-streaming-paraformer-bilingual-zh-en` | Streaming Paraformer | 中英双语 |
| `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20` | Streaming Zipformer Transducer | 中英双语、2023 checkpoint |
| `sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10` | Streaming Zipformer Transducer | 8 语种、2025 checkpoint |

因此，对“项目现在带了几个可用模型包”的回答是 **3**；对“这些包覆盖几个架构家族”的回答是 **2**。

### 配置槽和实现家族

Sherpaw 的 [`OnlineModelConfig`](../packages/asr/src/asr.d.ts) 暴露 5 个槽：Transducer、Paraformer、Zipformer2 CTC、NeMo CTC、T-One CTC。当前上游 core 还有 online WeNet CTC，但官方 C API/WASM 自身也未将它纳入这组 JS 结构，因此不能仅凭 core C++ 字段宣称浏览器侧已支持。上游依据见 [`online-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/online-model-config.h) 和 [online transducer 五种分派](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/online-transducer-model.cc#L35-L41)。

Sherpaw 的 `OfflineModelConfig` 暴露 17 个槽：Transducer、Paraformer、NeMo CTC、Whisper、FireRedASR AED、TDNN、Zipformer CTC、WeNet CTC、SenseVoice、Moonshine、Dolphin、Canary、Omnilingual ASR、FunASR Nano、MedASR、FireRedASR CTC、TeleSpeech CTC。它与 `9aa88f93` 的 offline 结构一致；当前上游已增至 19 个，见 [`offline-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-model-config.h#L30-L49)。因此配置槽口径是 **Sherpaw 22（5+17）/ 当前官方 WASM 24（5+19）**。

按唯一 adapter 路径展开和去重，Sherpaw 主构建 pin 含约 23 个 ASR 家族；当前官方是 25 个。两个新增差额是 Qwen3-ASR 和 Cohere Transcribe。

VAD 完整暴露 Silero VAD、TEN VAD 两个槽，见 [`packages/vad/src/vad.d.ts`](../packages/vad/src/vad.d.ts)；当前上游也仍为这两个家族，见 [`vad-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/vad-model-config.h#L15-L17)。

speaker diarization 代码暴露 Pyannote segmentation 加一个 generic speaker embedding model 路径；上游 embedding extractor 根据 ONNX metadata 分派 WeSpeaker、3D-Speaker、NeMo 三家族，见 [`speaker-embedding-extractor-impl.cc`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/speaker-embedding-extractor-impl.cc#L29-L33)。所以这一块按实现家族算 4 个，但 Sherpaw 包仍是 private。

### 任务模块的真实状态

| 能力 | Sherpaw 状态 | 证据/限制 |
|---|---|---|
| Online ASR | 非 private 包，可调用 | [`@sherpaw/asr`](../packages/asr/package.json)；本地 CMake 只导出 online ASR 函数，见 [`sherpa-onnx/asr/CMakeLists.txt`](../sherpa-onnx/asr/CMakeLists.txt) |
| Offline ASR | 只能可靠地从 VAD-ASR 模块调用 | [`vad-asr/CMakeLists.txt`](../sherpa-onnx/vad-asr/CMakeLists.txt) 导出了 offline C API |
| VAD | 非 private 包，可调用 | [`@sherpaw/vad`](../packages/vad/package.json) |
| VAD + Offline ASR | 非 private 包，可调用 | [`@sherpaw/vad-asr`](../packages/vad-asr/package.json) |
| Speaker diarization | 有 JS/WASM 包装，但 private | [`packages/speaker-diarization/package.json`](../packages/speaker-diarization/package.json) |
| Speaker embedding / ID / verification | native CMake 有目标，但没有同名 npm package | [`sherpa-onnx/speaker-embedding/CMakeLists.txt`](../sherpa-onnx/speaker-embedding/CMakeLists.txt) |
| KWS、TTS、speech enhancement | 未包装 | 上游已有对应 WASM 目标 |

`@sherpaw/asr` 的 JS/声明中存在 `OfflineRecognizer`，但 [`sherpa-onnx/asr/CMakeLists.txt`](../sherpa-onnx/asr/CMakeLists.txt) 的 `EXPORTED_FUNCTIONS` 没有 `_SherpaOnnxCreateOfflineRecognizer` 等 offline 符号。这属于“类型/包装代码存在，但二进制不可调用”，不能计为该包已经完成 offline 接入。

现有真实浏览器推理测试只直接覆盖 streaming Paraformer（[`asr-wav.browser.test.ts`](../packages/asr/tests/asr-wav.browser.test.ts)）和 Silero VAD + offline Moonshine（[`vad-asr.browser.test.ts`](../packages/vad-asr/tests/vad-asr.browser.test.ts)）。standalone VAD 测试只验证模块初始化，speaker diarization 没有仓库内测试。因此 29/47 是代码可达上限，不是测试覆盖率；其余 family 仍缺逐模型 smoke test。

## sherpa-onnx 当前能力面

### 任务类别

上游 README 顶部明确声明 **12 类功能**：ASR、TTS、source separation、speaker identification、speaker diarization、speaker verification、spoken language identification、audio tagging、VAD、KWS、punctuation、speech enhancement，见 [官方 README](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/README.md#L7-L23)。

当前源码还新增了未列入顶部功能表的 offline diacritization/CATT，见 [`offline-diacritization-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-diacritization-model-config.h)。所以：

- 按 README 对外宣称：**12 类**；
- 按当前源码可见独立 API：**13 类**。

VAD+ASR 是组合管线，不额外算一种原子任务；speaker segmentation 是 diarization 内部组件，也不另算任务。

### 唯一实现家族：约 47

| 领域 | 家族 | 数量 |
|---|---|---:|
| ASR | Conformer/E-Branchformer/LSTM/Zipformer/Zipformer2 Transducer、NeMo RNNT/TDT；NeMo/WeNet/Zipformer/TDNN/TeleSpeech/T-One CTC；Dolphin、Omnilingual、MedASR、FireRedASR CTC；Paraformer、Whisper、SenseVoice、Moonshine、FireRedASR AED、Canary、Cohere Transcribe、FunASR Nano、Qwen3-ASR | 25 |
| TTS | VITS/Piper、Matcha、Kokoro、ZipVoice、Kitten、Pocket、Supertonic | 7 |
| VAD | Silero、TEN | 2 |
| Speaker | WeSpeaker、3D-Speaker、NeMo embedding、Pyannote segmentation | 4 |
| Audio tagging | Zipformer、CED | 2 |
| Punctuation | CT-Transformer、CNN-BiLSTM | 2 |
| Speech enhancement | GTCRN、DPDFNet | 2 |
| Source separation | Spleeter、UVR | 2 |
| Diacritization | CATT | 1 |
| KWS | 复用 online transducer | 不新增 |
| Spoken language ID | 复用多语种 Whisper | 不新增 |
| **合计** |  | **约 47** |

核心出处：ASR [online config](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/online-model-config.h)、[offline config](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-model-config.h) 与 [offline dispatcher](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-recognizer-impl.cc)；TTS [`offline-tts-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-tts-model-config.h)；audio tagging [`audio-tagging-impl.cc`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/audio-tagging-impl.cc)；punctuation [offline](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-punctuation-model-config.h) 与 [online](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/online-punctuation-model-config.h)；enhancement [`offline-speech-denoiser-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-speech-denoiser-model-config.h)；source separation [`offline-source-separation-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-source-separation-model-config.h)。

### WASM 任务、后端、平台和语言接口

当前上游仓库有 7 个专用 WASM 任务目录：`asr`、`kws`、`speaker-diarization`、`speech-enhancement`、`tts`、`vad`、`vad-asr`；`wasm/nodejs` 和 `wasm/web` 是承载/打包入口，不另算任务。源码树见 [`wasm/`](https://github.com/k2-fsa/sherpa-onnx/tree/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm)，构建开关见 [`CMakeLists.txt`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/CMakeLists.txt#L60-L69)。

标准 ONNX Runtime provider 有 8 种：CPU、CUDA、CoreML、XNNPACK、NNAPI、TensorRT、DirectML、SpacemiT，见 [`provider.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/provider.h#L16-L25) 和 [`session.cc`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/session.cc)。另有 RKNN、QNN、Ascend、Axera/AXCL 等模型专用 NPU 路径；它们是按模型白名单分派，并不表示每个模型都支持每个 NPU，见 [offline NPU dispatcher](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-recognizer-impl.cc#L83-L237)。

官方 README 声明 12 种语言 API：C++、C、Python、JavaScript、Java、C#、Kotlin、Swift、Go、Dart、Rust、Pascal，并支持 WebAssembly；平台矩阵覆盖 Android、iOS、Windows、macOS、Linux、HarmonyOS 的 x86/x64/arm32/arm64/riscv64 子集，另有 Flutter 和 Tauri，见 [语言与平台表](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/README.md#L26-L75)。该声明是仓库级能力，不代表每个任务在 12 种 binding 中完全等价。

Sherpaw 当前则是 JS/TypeScript + WASM、CPU 路径；[`sherpa-onnx/build.sh`](../sherpa-onnx/build.sh) 明确关闭 GPU、JNI、Python、TTS，只构建 Emscripten 静态 WASM。也就是说，Sherpaw 的目标本来就不是复刻上游全部 OS/语言/provider 矩阵。

## 从 `9aa88f93` 到 `917bed95` 的具体差距

### 新实现家族

相对主构建 pin，当前上游增加 5 个唯一实现家族：

| 新家族 | 任务 | Sherpaw 影响 |
|---|---|---|
| Qwen3-ASR | Offline ASR | 缺 JS 配置、C struct 布局和新 native 实现 |
| Cohere Transcribe | Offline ASR | 同上 |
| Supertonic | TTS | Sherpaw 本来就未包装 TTS |
| DPDFNet | Speech enhancement | Sherpaw 本来就未包装 enhancement；上游还新增 online denoiser API |
| CATT | Diacritization | 新任务 API，Sherpaw 未包装 |

对应源码 diff 可从 [官方 compare](https://github.com/k2-fsa/sherpa-onnx/compare/9aa88f93aeda5b147488e213198dc58aec5ec166...917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e) 复核。当前 offline ASR 的新增结构见 [`offline-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-model-config.h)，Supertonic 见 [`offline-tts-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-tts-model-config.h)，DPDFNet 见 [`offline-speech-denoiser-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-speech-denoiser-model-config.h)。

以 47 家族为分母，Sherpaw 代码中已有的 ASR 23 + VAD 2 + Speaker 4 约为 **29/47（62%）**，缺 **18**：2 ASR、7 TTS、2 audio tagging、2 punctuation、2 enhancement、2 source separation、1 diacritization。若只算非 private、确有 npm 包的代码，不应把 speaker 4 家族算作已公开，公开覆盖上限约 **25/47（53%）**。这仍是“接口可达上限”，不是“逐家族实测通过率”；仓库自带并可直接验证的仍只有前述 2 家族 / 3 checkpoint。

### 任务模块

| 口径 | Sherpaw | 当前上游 | 差额 |
|---|---:|---:|---:|
| 专用 WASM 包装目录 | 4（其中 1 private） | 7 | 缺 KWS、TTS、speech enhancement |
| 官方 README 原子任务 | 非 private 包明确覆盖 ASR、VAD；diarization 为 private | 12 | 不能用“4/7 WASM 模块”替代“12 类原子任务”的覆盖率 |
| 源码独立任务 API | 同上 | 13（含 CATT diacritization） | 新增 diacritization 也未接入 |

### API / ABI 漂移

升级不是只改 submodule SHA：

- 当前上游为 online/offline stream 新增通用 `SetOption` / `GetOption` / `HasOption` C API，官方 WASM JS 也新增对应方法；Sherpaw 当前 CMake exported functions 与类型没有这些入口。用途包括给 streaming Paraformer 设置 `is_final`。依据见当前 [`c-api.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/c-api/c-api.h) 和 [`wasm/asr/sherpa-onnx-asr.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/asr/sherpa-onnx-asr.js)。
- Pyannote segmentation 的 C config 新增 `window_shift_ratio`，默认 0.1；这改变了结构布局。Sherpaw 的 [`speaker-diarization.d.ts`](../packages/speaker-diarization/src/sherpa-onnx-speaker-diarization.d.ts) 和手写 heap layout 都没有该字段。升级 native 与 JS 必须同步，否则是 ABI 错位风险。上游依据见 [`offline-speaker-segmentation-pyannote-model-config.h`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/sherpa-onnx/csrc/offline-speaker-segmentation-pyannote-model-config.h) 和当前 [WASM JS](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/speaker-diarization/sherpa-onnx-speaker-diarization.js)。
- Qwen3-ASR、Cohere Transcribe 会扩展 `SherpaOnnxOfflineModelConfig` 的 C struct。Sherpaw 的 JS 通过 `_CopyHeap` 手工拼接结构；因此必须以同一个 upstream SHA 同步 C header、native WASM、JS layout 和 `.d.ts`，不能逐文件拷贝。
- 上游还增加了 NeMo Parakeet unified streaming、online GTCRN/DPDFNet、更多 QNN 模型路径，以及 Flutter/Tauri/Rust 等 binding 增量。这些不都增加“唯一家族数”，但会增加迁移和测试面。

## 建议的后续衡量方式

后续不要只维护一个“模型数”。建议同时维护：

1. **Checkpoint coverage**：仓库实际提供并能下载/预加载/推理的权重包数量；当前是 3。
2. **Family coverage**：可成功实例化的唯一实现家族 / 上游约 47；代码可达上限约 29，但尚未逐家族验证。
3. **Task coverage**：已发布 WASM 任务模块 / 上游 7；当前非 private 是 3/7，若包含 private diarization 是 4/7。
4. **Production-ready coverage**：具备真实模型测试、浏览器测试和 demo 的家族数。这个数字最接近“真的接入完成”，目前不能从配置声明直接推出。

为每个 family 记录 `config exists → WASM symbol exported → can instantiate → real model test → demo/release artifact` 五级状态，可避免再次把“有类型”误报为“已接入”。
