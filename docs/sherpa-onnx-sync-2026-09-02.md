# sherpa-onnx v1.13.7 同步与模型支持矩阵

日期：2026-09-02
上游基线：[`k2-fsa/sherpa-onnx@917bed95`](https://github.com/k2-fsa/sherpa-onnx/commit/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e)，即 v1.13.7

## 本轮结论

- 主构建子模块从 `9aa88f93` 更新到 `917bed95`，与核对时的上游正式版相差 **0 commits**。
- ASR、VAD、VAD+ASR 和 speaker diarization 的 ESM wrapper 已按同一提交同步；主 WASM 构建和各 checkpoint 的 Docker 构建统一使用 **Emscripten 4.0.23**。
- ASR 配置面由 22 个槽补齐为上游当前的 **24 个槽（5 online + 19 offline）**，新增 Qwen3-ASR 与 Cohere Transcribe。VAD 仍为 Silero、TEN 两个槽。
- `@sherpaw/asr` 现在同时导出 online 与 offline C API，修复此前“TypeScript 声明 OfflineRecognizer、WASM 却缺少 offline symbol”的不一致。
- online/offline stream 新增 `setOption()` / `getOption()`；Pyannote segmentation 补齐 `windowShiftRatio`，避免升级后的结构体布局错位。
- 仓库仍只承诺并维护 **3 个模型 checkpoint、2 个 recognizer 家族**。本轮不新增模型，用真实浏览器 fake microphone 覆盖这 3 个 checkpoint。

## 本轮必须支持并测试的 checkpoint

| Checkpoint | 家族 | 语言范围 | 浏览器测试 |
|---|---|---|---|
| `sherpa-onnx-streaming-paraformer-bilingual-zh-en` | Streaming Paraformer | 中、英 | 中文、英文、停顿后继续识别 |
| `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20` | Streaming Zipformer Transducer | 中、英 | 中文、英文、停顿后继续识别 |
| `sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10` | Streaming Zipformer Transducer | 阿、英、印尼、日、俄、泰、越、中 | 中文、英文、停顿后继续识别 |

测试路径是：

```text
WAV fixture -> Chromium file-backed microphone -> getUserMedia
-> AudioWorklet -> Web Worker -> sherpa-onnx WASM -> transcript oracle
```

三模型清单只有一个代码来源：[`packages/testing-audio/src/models.ts`](../packages/testing-audio/src/models.ts)。中文、英文、停顿中文三个 case 都遍历该清单，因而形成 3 × 3 的语义测试矩阵；另有一条 AudioWorklet 加载 smoke。

## 其他现有集成 fixture

这些 fixture 用来验证模块或组合管线，但不计入“仓库维护的 3 个 streaming checkpoint”：

| 模块 | 模型 | 层级 | 当前用途 |
|---|---|---|---|
| `@sherpaw/asr` | Streaming Paraformer bilingual zh/en | PCM 浏览器集成 | 直接加载权重、喂 WAV、验证 online stream 和 option round-trip |
| `@sherpaw/vad` | Silero VAD | PCM 浏览器集成 | VAD 初始化/分段 |
| `@sherpaw/vad-asr` | Silero VAD + Moonshine tiny JA | PCM 浏览器集成 | VAD 分段、offline ASR、option round-trip |
| `@sherpaw/speaker-diarization` | 无仓库模型 | 构建/ABI | 本轮只验证同步后的 WASM 产物与 JS 结构 |

## 代码可达的模型配置槽

“配置可达”表示 JS heap layout、C API 和 WASM 来自同一上游提交；不表示仓库附带对应权重或逐模型测试。

### Online ASR（5）

1. Transducer（内部可分派 Conformer、E-Branchformer、LSTM、Zipformer、Zipformer2，以及 NeMo RNNT/TDT）
2. Paraformer
3. Zipformer2 CTC
4. NeMo CTC
5. T-One CTC

### Offline ASR（19）

1. Transducer
2. Paraformer
3. NeMo CTC
4. Whisper
5. FireRedASR AED
6. TDNN
7. Zipformer CTC
8. WeNet CTC
9. SenseVoice
10. Moonshine
11. Dolphin
12. Canary
13. Omnilingual ASR
14. FunASR Nano
15. MedASR
16. FireRedASR CTC
17. TeleSpeech CTC
18. Qwen3-ASR
19. Cohere Transcribe

### 其他已包装配置

- VAD：Silero、TEN。
- Speaker diarization：Pyannote segmentation；speaker embedding 运行时可分派 WeSpeaker、3D-Speaker、NeMo。

按同步前报告的唯一实现家族算法，本轮补齐两个 ASR 家族后，代码可达上限由约 **29/47** 提升为约 **31/47**。但生产可用口径仍应看真实模型测试：当前是 **3 checkpoints / 2 streaming recognizer families**。

## 测试分层和上游贡献边界

上游 v1.13.7 没有 Playwright、Vitest 或 fake-media 自动化。它已有交互式 `getUserMedia` demo、build-only WASM/Flutter Web CI，以及 Node/Flutter/WebSocket 的 WAV/PCM 直注入路径。

Sherpaw 因而保留完整 fakemic 层，覆盖自己的 AudioWorklet、Worker、ESM preloader 和 provider；若向上游贡献，优先提交通用 `wasm/web` 的 Chromium PCM smoke，再考虑官方 demo 的单模型 fakemic smoke。完整证据与建议见 [`sherpa-onnx-fakemic-test-strategy-2026-09-02.md`](./sherpa-onnx-fakemic-test-strategy-2026-09-02.md)。

## 后续扩展准入条件

新增 checkpoint 只有同时满足以下条件才进入“已支持”数字：

1. 下载地址和归一化文件名有可复现脚本；
2. Emscripten 4.0.23 可生成 preload data/metadata；
3. `packages/testing-audio/src/models.ts` 登记 family 与 checkpoint；
4. 至少一个 16 kHz fixture 有稳定 transcript oracle；
5. Chromium fakemic 测试通过，并记录模型、fixture 与 WASM SHA。

仅增加 TypeScript 配置字段或能实例化 recognizer，不增加 checkpoint 支持数。
