# sherpa-onnx 浏览器音频测试调研与 Fakemic 策略

日期：2026-09-02
基线：[`k2-fsa/sherpa-onnx@917bed95`](https://github.com/k2-fsa/sherpa-onnx/tree/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e)，即发布 v1.13.7 的提交
范围：官方仓库的 `wasm/`、Flutter Web、Node.js WASM examples、GitHub Actions 和测试辅助代码。除当前 Sherpaw 仓库用于差异对照外，只采用 sherpa-onnx 官方一手资料。

## 结论

截至该基线，sherpa-onnx **没有**与 `@sherpaw/vitest-plugin-fakemic` 等价的自动化方案。具体说，官方仓库没有 Playwright、Puppeteer、Selenium、Vitest 或 Chromium fake-media 启动参数，也没有 CI 在真实浏览器里把 WAV 作为虚拟麦克风送入 `getUserMedia()`。

上游已经具备三块可复用基础，但它们还没有组成自动化浏览器音频测试：

1. 官方 ASR、KWS、VAD、VAD+ASR 页面确实使用 `navigator.mediaDevices.getUserMedia()`，可以成为虚拟麦克风测试对象；
2. Node.js WASM CI 会下载官方模型和 WAV，然后把 PCM 直接送入 recognizer/VAD，覆盖了大量模型的“能加载、能运行、不崩溃”路径；
3. 新的通用 Web WASM port、Flutter from-file 示例已经具备 ArrayBuffer/Float32 PCM、Emscripten FS 和 Web Worker 注入路径。

因此最合适的方向不是把整个 Sherpaw Vitest 插件搬到上游，而是：

- 给 sherpa-onnx 上游先贡献通用 Web port 的浏览器 PCM smoke，再视接受度增加一个面向官方 demo 的薄 Chromium fakemic smoke；
- 把 Vitest 自定义 runner、ESM package、Vite server、Sherpaw AudioWorklet/Web Worker/transcription pipeline 和完整模型矩阵留在 Sherpaw；
- 在 Sherpaw 中同时保留“PCM 直注入”和“虚拟麦克风”两类测试，因为它们隔离的是不同故障面。

## 调研方法和负面证据

在固定提交上执行以下可复现检索：

```bash
git grep -n -I -E \
  'use-file-for-fake-audio-capture|use-fake-device-for-media-stream|use-fake-ui-for-media-stream|MediaStreamTrackGenerator|playwright|puppeteer|selenium|webdriver|vitest|jest|karma|cypress' \
  917bed95 -- ':!*.lock' ':!*.onnx'

git grep -n -I -E \
  'flutter test|dart test|integration_test|flutter drive|chromedriver|chrome --headless|google-chrome.*headless' \
  917bed95 -- '.github/**' 'flutter/**' 'flutter-examples/**'
```

第一条没有相关命中，第二条只有两份 `.gitignore` 中的 `integration_tests` 路径；CI 源码中没有执行浏览器测试的命令。这个结论也与仓库内的 JavaScript 包清单吻合：官方只有 Node/Tauri 示例的 `package.json`，没有浏览器测试框架依赖。可核对固定提交的[完整源树](https://github.com/k2-fsa/sherpa-onnx/tree/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e)和 [`nodejs-examples/package.json`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/nodejs-examples/package.json)。

“没有等价方案”不等于“没有浏览器代码”或“没有文件注入能力”。后两者都已经存在，区别见下文。

## 上游当前具备什么

### 1. 官方 microphone demo：真实 Web Audio 路径，但只供交互使用

`wasm/asr/app-asr.js`、`wasm/kws/app.js`、`wasm/vad/app-vad.js`、`wasm/vad-asr/app-vad-asr.js` 都会调用 `getUserMedia({audio: true})`，创建 `AudioContext` 和 `MediaStreamAudioSourceNode`，再用 `ScriptProcessorNode.onaudioprocess` 将音频送入 WASM。以 ASR 为例，源码见 [`wasm/asr/app-asr.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/asr/app-asr.js)；VAD+ASR 的同类路径见 [`wasm/vad-asr/app-vad-asr.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/vad-asr/app-vad-asr.js)。

这些页面没有测试入口、完成事件或结构化结果接口；结果主要写到 DOM/控制台。它们证明官方有可被自动化的真实采集路径，但目前仍是人工 demo。

Python WebSocket browser client 也有真实麦克风入口：[`offline_record.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/python-api-examples/web/js/offline_record.js#L105-L154)和 [`streaming_record.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/python-api-examples/web/js/streaming_record.js#L114-L165)同样直接使用实际设备，没有可替换的 media-provider seam。

还需注意：这些旧版官方 demo 使用 `ScriptProcessorNode`，而 Sherpaw 的目标管线使用 `AudioWorklet`。因此即使给官方 demo 增加 fakemic smoke test，也不能替代 Sherpaw 对自己 AudioWorklet 的端到端测试。

### 2. WASM CI：构建、打包、发布，不启动页面

官方为 ASR、VAD、VAD+ASR、KWS、TTS、speaker diarization 和 speech enhancement 等维护了 WASM 构建。典型的 [`wasm-simd-hf-space-en-asr-zipformer.yaml`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/.github/workflows/wasm-simd-hf-space-en-asr-zipformer.yaml)会下载模型、运行 `build-wasm-simd-asr.sh`、打包产物并发布；[`wasm-simd-hf-space-vad-asr.yaml`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/.github/workflows/wasm-simd-hf-space-vad-asr.yaml)用分片矩阵生成多组 VAD+ASR 构建。

这些 workflow 没有静态服务器、浏览器启动、麦克风授权、音频注入或 transcript 断言，所以只能证明“模型和 WASM 可构建/打包”，不能证明浏览器能初始化，更不能证明麦克风链路可用。固定提交中的 9 个 `build-wasm*.sh` 还全部显式传入 `-DSHERPA_ONNX_ENABLE_TESTS=OFF`；例如通用 Web 脚本见 [`build-wasm-simd-web.sh#L41-L62`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/build-wasm-simd-web.sh#L41-L62)。

### 3. Flutter Web CI：覆盖新的通用 Web port，但仍是 build-only

v1.13.5 引入了 Flutter/Dart Web 的通用 WASM port；变更记录见 [`CHANGELOG.md`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/CHANGELOG.md)。通用构建脚本 [`build-wasm-simd-web.sh`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/build-wasm-simd-web.sh)显式关闭 C++ tests，开启 `SHERPA_ONNX_ENABLE_WASM_WEB`；[`wasm/web/CMakeLists.txt`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/web/CMakeLists.txt)生成模块化的 `SherpaOnnx` Web 工厂。

Flutter 的 Web workflow 会：构建通用 WASM、复制到 Web plugin、下载模型、执行 `flutter build web`、压缩并上传。它没有 `flutter test -d chrome`、`flutter drive`、Chrome/Chromedriver 或页面断言。代表性证据是 [`test-flutter-vad-asr.yaml`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/.github/workflows/test-flutter-vad-asr.yaml)和 [`test-flutter-vad.yaml`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/.github/workflows/test-flutter-vad.yaml)。

这里的价值是它已经提供一套很接近测试夹具的浏览器数据通路：

- [`audio_decoder_web.dart`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/flutter-examples/vad-non-streaming-asr-from-file/lib/audio_decoder_web.dart)用 Web Audio API 从文件 bytes 解码并重采样；
- [`worker_web.dart`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/flutter-examples/vad-non-streaming-asr-from-file/lib/worker_web.dart)把模型 bytes、WASM binary 和 `Float32List` 发给 Web Worker；
- [`vad-asr-worker.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/flutter-examples/vad-non-streaming-asr-from-file/web/vad-asr-worker.js)把模型写入 Emscripten FS，并对 PCM 执行 VAD+ASR。

这是“浏览器文件/PCM 直注入示例”，不是“虚拟麦克风测试”。前者绕过 `getUserMedia` 和浏览器音频采集节点，适合验证 WASM/Worker；后者才验证权限、设备、AudioContext 和采集时序。

另一个相邻实现是 Python WebSocket 页面的 [`upload.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/python-api-examples/web/js/upload.js#L84-L128)：用户选择 WAV 后，页面用 `FileReader` 和 `decodeAudioData` 得到 PCM，再按 1024 个 float 的字节块发送；源码明确把分片目的之一称为 “Simulate streaming”。它是很好的 fixture 分帧参考，但仍然不生成 `MediaStream`，不会触发被测页面的 `getUserMedia`。

### 4. Node.js WASM CI：模型覆盖广，但属于命令式 smoke test

[`test-nodejs.yaml`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/.github/workflows/test-nodejs.yaml)会从源码构建 Node.js WASM 包，再调用 [`.github/scripts/test-nodejs-npm.sh`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/.github/scripts/test-nodejs-npm.sh)。后者下载许多官方模型和测试 WAV，逐个执行 `node test-*.js`。定时任务 [`test-nodejs-npm.yaml`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/.github/workflows/test-nodejs-npm.yaml)也运行同一套脚本。

在线 Transducer 示例 [`test-online-transducer.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/nodejs-examples/test-online-transducer.js)用 `wav.Reader` 分块读取 WAV，并将 `Float32Array` 直接交给 `acceptWaveform()`；离线 Paraformer 示例 [`test-offline-paraformer.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/nodejs-examples/test-offline-paraformer.js)通过 `readWave()` 一次性注入。VAD+ASR 也是直接遍历 PCM 窗口，见 [`test-vad-with-non-streaming-asr-whisper.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/nodejs-examples/test-vad-with-non-streaming-asr-whisper.js)。

这套 CI 的优势是模型面广、直接使用官方发布物；局限是多数脚本只打印 transcript/RTF，以进程不报错作为成功条件，没有稳定的文本 oracle。它适合继续承担模型兼容 smoke，不适合作为浏览器 microphone 回归测试的替代品。

### 5. 可复用的底层文件注入设施

通用 Web/Node WASM 导出了 `SherpaOnnxReadWaveFromBinaryData`、Emscripten `FS` 和各 recognizer/VAD C API；完整导出列表在 [`wasm/wasm-common.cmake`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/wasm-common.cmake)。[`wasm/nodejs/sherpa-onnx-wave.js`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/nodejs/sherpa-onnx-wave.js)已经实现 `readWaveFromBinaryData(uint8Array, Module)`。

官方 ASR wrapper 本身也已经提供稳定的输入 seam：[`OfflineStream.acceptWaveform()`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/asr/sherpa-onnx-asr.js#L1782-L1806)和 [`OnlineStream.acceptWaveform()`](https://github.com/k2-fsa/sherpa-onnx/blob/917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e/wasm/asr/sherpa-onnx-asr.js#L1883-L1916)都接收 `Float32Array` 并复制进 WASM heap。

因此，上游增加“浏览器内从 fixture 直接喂 PCM”的测试不需要改 core API；只需测试页面、fixture、浏览器 runner 和结果 oracle。

## 和 Sherpaw Fakemic 的实质差异

Sherpaw 当前实现分成通用 runtime 和项目专属适配两层：

- [`packages/vitest-plugin-fakemic/src/index.ts`](../packages/vitest-plugin-fakemic/src/index.ts)用 Playwright 启动 Chromium/Electron，并追加 `--use-fake-ui-for-media-stream`、`--use-fake-device-for-media-stream`、`--use-file-for-fake-audio-capture=<wav>%noloop`；
- [`packages/vitest-plugin-fakemic/src/runner.ts`](../packages/vitest-plugin-fakemic/src/runner.ts)通过 Vitest 自定义 runner 把每个音频用例包成独立 runtime session；
- [`packages/testing-audio/app/src/main.ts`](../packages/testing-audio/app/src/main.ts)实际执行 `getUserMedia -> AudioWorklet -> WritableStream -> Web Worker -> sherpa-onnx WASM`；
- [`packages/testing-audio/cases`](../packages/testing-audio/cases)不仅要求进程不崩溃，还对 transcript 内容、停顿后继续识别、状态和错误字段做断言。

这比上游现有 CI 多验证了四类风险：浏览器权限/设备选择、文件麦克风时序、AudioWorklet 传输、应用级 Worker/流式转写组装。

## 推荐测试层级

| 层级 | 目标 | 输入路径 | 主要断言 | 建议归属 | 触发频率 |
|---|---|---|---|---|---|
| L0：构建/ABI | Emscripten 构建、产物与导出符号 | 无音频 | `.js/.wasm` 存在；模块可实例化；关键 symbol 存在 | 上游 + Sherpaw | 每次相关 PR |
| L1：JS/ESM 契约 | heap layout、配置默认值、生命周期、错误处理 | 合成小数组或无模型 | config 映射、create/free、option round-trip、明确错误 | 各自 wrapper 所在仓库 | 每次 PR |
| L2：PCM 直注入 | 模型加载、WASM、recognizer/VAD、Worker | WAV bytes/Float32Array 直接注入 | 非空或规范化 transcript；VAD segment；无泄漏/崩溃 | 上游主测；Sherpaw 做 port 回归 | PR 上选定小矩阵；nightly 全矩阵 |
| L3：虚拟麦克风 E2E | `getUserMedia`、AudioContext、采集节点、流式时序 | Chromium file-backed fake microphone | 预期短语、endpoint/停顿、无 error、可清理 | 上游薄 smoke；Sherpaw 完整矩阵 | Sherpaw PR；上游 nightly/相关 PR |
| L4：真实设备/跨浏览器 | 浏览器差异、硬件、权限 UI、采样率 | 真实麦克风或平台测试设备 | 人工/平台级行为 | 发布前人工或专门设备实验室 | 发布前 |

关键原则：L2 和 L3 不互相替代。L2 失败更接近 WASM/模型/API；L3 失败更接近浏览器音频和应用管线。若只保留 L3，模型下载和实时等待会让定位慢且容易产生假失败；若只保留 L2，则完全看不到 microphone 链路回归。

## 可实施方案

### A. Sherpaw：近期即可落地

1. **保留现有 Fakemic 作为 L3。** 每个用例独立 Chromium、WAV 使用 `%noloop`、模型加载完成后再申请麦克风，这些都是避免丢失 fixture 开头的必要约束。
2. **把 L2 固定为快速 port gate。** `@sherpaw/asr`、`@sherpaw/vad-asr` 的 browser tests 继续直接加载 model bytes 和 PCM，断言具体短语或至少稳定 token，而非只断言非空。VAD 单包应加入真实 Silero 模型的 segment 断言；当前“模块存在或缺 prebuilt”只能算初始化测试。
3. **L3 只覆盖仓库维护模型，不扩模型面。** 首轮使用现有 3 个 streaming checkpoint：
   - `sherpa-onnx-streaming-paraformer-bilingual-zh-en`
   - `sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20`
   - `sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10`
4. **用例维度保持正交。** 每个 checkpoint 至少跑一条 16 kHz 单句；中文/英文按模型语言能力选择；另为每个 recognizer family 跑一条“语音—静音—语音”，验证 endpoint 后继续识别。不要给三个 checkpoint 复制所有语言 fixture。
5. **CI 分速率。** PR 必跑 L0/L1；改动 WASM、wrapper、Worker、AudioWorklet 或模型打包时跑 L2/L3；完整 3 模型 × 多 fixture 放 nightly。缓存模型 archive 和打包后的 `.data/.metadata`，以 SHA256 或模型 release URL 作为 cache key。
6. **失败产物。** 保存浏览器 console、page error、最终 snapshot、运行时/模型 ID、fixture、WASM SHA；超时也必须执行 `stop/close`。这比只留视频更利于定位音频测试。

推荐的首轮门禁矩阵：

| 包/管线 | 模型 | Fixture | Oracle |
|---|---|---|---|
| `@sherpaw/asr` L2 | streaming Paraformer | 官方模型 `test_wavs/0.wav` | 规范化后的固定短语或稳定子串 |
| `@sherpaw/asr` L2 | bilingual streaming Zipformer Transducer | 官方模型 `test_wavs/0.wav` | 固定短语或稳定子串 |
| `@sherpaw/vad-asr` L2 | Silero VAD + 当前 Moonshine fixture | 当前日/中文 fixture | 至少一个 segment，且 transcript 匹配固定子串 |
| `@sherpaw/testing-audio` L3 | 上述 3 个仓库模型 | 现有中、英、停顿中文 fixture | 预期短语、先后顺序、`error === ''`、正常停止 |

### B. sherpa-onnx 上游：建议贡献的最小切片

建议拆成两个“小而拥有明确边界”的 browser smoke PR，而不是提交 `@sherpaw/vitest-plugin-fakemic`。

第一步先做通用 Web port 的 PCM smoke，最容易稳定也最符合 core 边界：

1. 构建 `wasm/web` 后启动静态服务器和 headless Chromium，实例化 `SherpaOnnx()`；
2. 写入一个官方 streaming Zipformer 模型，读取其 `test_wavs/0.wav`，分帧调用官方 `OnlineStream.acceptWaveform(Float32Array)`；
3. 断言模块初始化、关键导出、无 page error，并匹配规范化后的固定 transcript 子串；
4. workflow 路径过滤到 `wasm/web/**`、`wasm/asr/sherpa-onnx-asr.js`、C API、核心在线 recognizer 和构建脚本，模型 archive 使用 Actions cache。

第二步才是可选的官方 fakemic smoke：

1. 在 `wasm/asr/` 为现有官方页面增加测试友好的只读状态，例如 `window.__sherpaOnnxTest = { ready, result, error, stop }`，或发出同等的 CustomEvent。生产 demo 行为不变。
2. 新增一个最小 Playwright 脚本和静态 server 配置；只测试 Chromium，因为 `--use-file-for-fake-audio-capture` 是 Chromium 的测试能力，不应声称跨浏览器。
3. 使用官方已经在 WASM workflow 下载的 bilingual streaming Zipformer 模型和它自带的 `test_wavs/0.wav`。初始 PR 只做 1 模型、1 fixture、1 transcript 子串；这样能验证官方 demo 的 `getUserMedia -> ScriptProcessor -> WASM`，而不会把矩阵成本塞进每个 PR。
4. 增加独立 workflow；成功标准必须是页面 ready、fake mic 被消费、出现预期 transcript、无 page error，并完成资源释放。
5. 后续再按相同接口扩到 `wasm/vad/`、`wasm/vad-asr/`、`wasm/kws/`；不要在首个贡献中同时引入所有任务和模型。

第一个切片保护通用 WASM/JS ABI；第二个切片保护官方 microphone demo。两者的测试对象都是上游自己的发布物和官方模型，能填补现有 workflow 从“构建成功”到“浏览器实际可用”的空白。上游即使不接受 Chromium-specific 的第二步，第一步仍然有独立价值；Sherpaw 的 L3 不应因此停做。

### C. 应留在 Sherpaw 的部分

以下内容与 sherpa-onnx core/官方 demo 无关，不建议推给上游：

- Vitest `TestRunner` 的自定义 task registry 和 `Symbol.for(...)` 桥接；它依赖 Sherpaw 选择的 Vitest 版本和内部 seam；
- `web()` / `electron()` 双 runtime 抽象、Vite preview 生命周期和 Sherpaw 的 session/preflight/artifact API；
- `@sherpaw/preloader` 的 `.data` / `.metadata` 加载和仓库 `models/` 打包约定；
- `xsai-transcription` Provider、Readable/WritableStream 协议、Sherpaw Web Worker 和 AudioWorklet；
- 3 个 Sherpaw checkpoint 的全矩阵、语言 fixture、Paraformer/Transducer 差异化 oracle；
- Electron-specific user-data 清理和应用 selector/route。

这些部分继续留在 Sherpaw，才能让 Fakemic 保持可复用而不迫使上游接受某个包管理器、test runner 或应用架构。

## 上游贡献边界判定表

| 候选内容 | 上游 | Sherpaw | 理由 |
|---|---:|---:|---|
| 官方 WASM demo 的 ready/result/error 测试接口 | 是 | 可消费 | 接口属于被测 demo 本身 |
| 官方 demo 的 1 模型 Chromium fakemic smoke | 是 | 可参照 | 直接保护上游浏览器发布物 |
| `wasm/web` 的实例化与导出符号 smoke | 是 | 也应有 | 通用 port/ABI 是上游职责 |
| C API/JS helper 的 WAV binary、PCM 直注入测试 | 是 | 也应有 | 与应用采集方式无关，定位价值高 |
| Vitest plugin、自定义 runner | 否 | 是 | 工具链和生命周期是 Sherpaw 的选择 |
| AudioWorklet + xsai Worker 端到端 | 否 | 是 | 上游 demo 当前不使用这条管线 |
| Sherpaw 模型包格式和三模型矩阵 | 否 | 是 | 属于 Sherpaw 发布物与兼容承诺 |
| 真实麦克风/跨浏览器设备测试 | 不放普通 CI | 不放普通 CI | Chromium file fake mic 不能代表真实设备或 Safari/Firefox |

## 风险与限制

- Chromium fake microphone 验证的是浏览器媒体栈，不等于真实设备验证；驱动、回声消除、系统权限和实际采样率仍需 L4。
- `--use-file-for-fake-audio-capture` 不应作为 Web 标准能力抽象；上游 smoke 和 Sherpaw Fakemic 都应明确标注 Chromium-only。
- transcript oracle 应使用规范化后的稳定子串，避免把标点、空格、大小写和 endpoint 差异变成无关回归；但不能退化成“非空”，否则错误模型也可能通过。
- 模型和 WASM 很大。PR 矩阵必须按“实现家族代表”而非“配置枚举笛卡尔积”设计；全模型兼容性放 nightly。
- 上游 Node.js scripts 主要以退出码为 oracle。复用它们的模型清单可以，不能直接把现有脚本数量当作语义正确性覆盖率。

## 建议验收标准

Sherpaw 完成本轮同步与测试探索时，应至少满足：

- L0：同步后的 Web/Node WASM 都可构建，关键导出和 ESM 初始化通过；
- L1：新增/变更配置字段和 stream option 有 JS 单测；
- L2：Paraformer、Transducer、Silero+Moonshine 的实际浏览器 PCM 测试有稳定语义断言；
- L3：3 个现有仓库模型通过 file-backed microphone，且覆盖一条停顿后继续识别；
- CI 明确区分 build-only、PCM integration 和 fakemic E2E，不用其中一层的结果替另一层背书；
- 上游提案只含官方 demo 的薄 Chromium smoke 和必要测试 hook，不携带 Sherpaw 的 Vitest/ESM/Provider 体系。

在这个边界下，Sherpaw 能立即获得高价值回归保护，同时也有一个规模合理、理由清晰的 sherpa-onnx 上游贡献路径。
