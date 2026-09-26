import type { Network } from './onnx'
import type { Recognizer, RecognizerOptions } from './types'

import { acceptAudio, fetchChecked, loadNativeRuntime } from './native'
import { createOnnxBridge } from './onnx'

const packUrl = new URL('../../../../../models/huggingface/sherpaw-paraformer-zh-en/install/bin/wasm/preload.data', import.meta.url).href
const metadataUrl = new URL('../../../../../models/huggingface/sherpaw-paraformer-zh-en/install/bin/wasm/preload.js.metadata', import.meta.url).href

/** Triggering workflow: runtime.worker load -> Paraformer pack and optional ORT sessions -> recording adapter. */
export async function createParaformerRecognizer(options: RecognizerOptions, baseUrl: string, report: (message: string) => void): Promise<Recognizer> {
  const { backend } = options
  if (backend === 'webgpu-encoder')
    throw new Error('WebGPU encoder backend requires X-ASR FP32')
  report('Loading Paraformer runtime and models…')
  const { runtime } = await loadNativeRuntime('paraformer-asr', baseUrl)
  let gpu: Awaited<ReturnType<typeof createOnnxBridge>> | undefined
  let destroyed = false
  let decodedChunks = 0
  async function dispose() {
    if (destroyed)
      return
    destroyed = true
    runtime.ccall('AsrDestroy', null, [], [])
    await gpu?.dispose()
  }
  async function decode() {
    while (runtime.ccall('AsrReady', 'number', [], [])) {
      await runtime.ccall('AsrDecode', null, [], [], { async: true })
      decodedChunks++
      if (runtime.asrError)
        throw new Error(runtime.asrError)
    }
    return runtime.ccall('AsrText', 'string', [], []) as string
  }
  try {
    const metadata: { files: { filename: string, start: number, end: number }[] } = await (await fetchChecked(metadataUrl)).json()
    const pack = new Uint8Array(await (await fetchChecked(packUrl)).arrayBuffer())
    const weights: Parameters<typeof createOnnxBridge>[1] = {}
    for (const entry of metadata.files) {
      const bytes = pack.subarray(entry.start, entry.end)
      runtime.FS.writeFile(entry.filename, bytes)
      if (backend !== 'cpu' && (entry.filename === '/encoder.onnx' || entry.filename === '/decoder.onnx')) {
        const network = entry.filename.slice(1, -5) as Network
        weights[network] = {
          bytes: backend === 'webgpu-fp32'
            ? new Uint8Array(await (await fetchChecked(new URL(`asr-models/paraformer-fp32/${network}.onnx`, baseUrl))).arrayBuffer())
            : bytes,
          provider: backend === 'webgpu-decoder' && network === 'encoder' ? 'wasm' : 'webgpu',
        }
      }
    }
    runtime.ccall('AsrCreate', null, [], [])
    for (const entry of metadata.files) runtime.FS.unlink(entry.filename)
    if (backend !== 'cpu') {
      report('Initializing Paraformer WebGPU sessions…')
      gpu = await createOnnxBridge(runtime, weights, options.diagnostics)
    }
    runtime.ccall('AsrStart', null, ['number'], [gpu ? 1 : 0])
    report(`Ready · Paraformer zh-en · ${gpu ? `WebGPU · ${gpu.device}` : 'CPU / WASM'}`)
    return {
      /** Triggering workflow: runtime.worker accept -> native PCM input -> Paraformer decode loop. */
      async accept(samples) {
        await acceptAudio(runtime, 'AsrAccept', samples)
        return decode()
      },
      /** Triggering workflow: runtime.worker finish -> final streaming context -> final transcript. */
      async finish() {
        runtime.ccall('AsrFinish', null, [], [])
        return decode()
      },
      dispose,
      stats: () => ({ decodedChunks, gpuDispatches: gpu?.gpuDispatches() ?? 0 }),
    }
  }
  catch (error) {
    await dispose()
    throw error
  }
}
