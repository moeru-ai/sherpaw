import * as ort from 'onnxruntime-web/webgpu'

import type { Model } from './asr-runtime'

import { installAsrRunner, loadAsrBridge, loadFloatAsrModel } from './asr-runtime'

export type LiveBackend = 'cpu' | 'webgpu' | 'webgpu-decoder' | 'webgpu-fp32'
export interface LiveRecognizer {
  accept: (samples: Float32Array) => Promise<string>
  finish: () => Promise<string>
  dispose: () => Promise<void>
  stats?: () => { decodedChunks: number, gpuDispatches: number }
}

/** Triggering workflow: ASR Start -> selected backend -> local Paraformer sessions -> serial audio inference. */
export async function createLiveRecognizer(backend: LiveBackend, report: (message: string) => void): Promise<LiveRecognizer> {
  if (backend !== 'cpu') {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter || adapter.info.isFallbackAdapter)
      throw new Error('WebGPU is unavailable. Use Chrome with hardware acceleration, or select CPU / WASM.')
  }
  const { bridge, modelBytes, metadata } = await loadAsrBridge(report)
  const sessions: Partial<Record<Model, ort.InferenceSession>> = {}
  let destroyed = false
  let dispatches = 0
  let decodedChunks = 0
  let device = 'CPU / WASM · Paraformer zh-en'
  const originalDispatch = globalThis.GPUComputePassEncoder?.prototype.dispatchWorkgroups
  let restoreDispatch = () => {}
  installAsrRunner(bridge, sessions)

  async function dispose() {
    if (destroyed)
      return
    destroyed = true
    restoreDispatch()
    bridge._AsrDestroy()
    await Promise.all(Object.values(sessions).map(session => session.release()))
  }

  /** Triggering workflow: accept/finish -> AsrReady -> await AsrDecode -> partial/final text and device status. */
  async function decode() {
    while (bridge._AsrReady()) {
      await bridge.ccall('AsrDecode', null, [], [], { async: true })
      decodedChunks++
      if (bridge.asrError)
        throw new Error(bridge.asrError)
    }
    report(backend === 'cpu' ? device : `${device} · GPU dispatches: ${dispatches}`)
    return bridge.UTF8ToString(bridge._AsrText())
  }

  try {
    report('Preparing Paraformer…')
    bridge._AsrCreate()
    for (const entry of metadata.files) bridge.FS.unlink(entry.filename)
    if (backend !== 'cpu') {
      for (const model of ['encoder', 'decoder'] as const) {
        const provider = backend === 'webgpu-decoder' && model === 'encoder' ? 'wasm' : 'webgpu'
        report(`Loading Paraformer ${model} (${backend === 'webgpu-fp32' ? 'FP32 WebGPU' : provider})…`)
        const bytes = backend === 'webgpu-fp32' ? await loadFloatAsrModel(model, 'fp32') : modelBytes[model]!
        sessions[model] = await ort.InferenceSession.create(bytes, { executionProviders: [provider] })
      }
      const info = (await ort.env.webgpu.device).adapterInfo
      if (info.isFallbackAdapter)
        throw new Error('ONNX Runtime selected a software GPU adapter')
      device = `WebGPU · ${info.vendor} ${info.architecture} · ${backend === 'webgpu-decoder' ? 'decoder only' : 'encoder + decoder'} · ${backend === 'webgpu-fp32' ? 'FP32' : 'int8'}`
      if (!originalDispatch)
        throw new Error('WebGPU compute API is unavailable')
      /** Triggering workflow: selected ORT GPU session -> dispatchWorkgroups -> live GPU activity counter. */
      const countDispatch: typeof originalDispatch = function (this: GPUComputePassEncoder, ...args) {
        dispatches++
        return originalDispatch.apply(this, args)
      }
      GPUComputePassEncoder.prototype.dispatchWorkgroups = countDispatch
      restoreDispatch = () => {
        if (GPUComputePassEncoder.prototype.dispatchWorkgroups === countDispatch)
          GPUComputePassEncoder.prototype.dispatchWorkgroups = originalDispatch
      }
    }
    bridge._AsrStart(backend === 'cpu' ? 0 : 1)
    report(device)
    return {
      /** Triggering workflow: recording audio queue -> copy PCM -> Sherpa stream -> decode. */
      async accept(samples) {
        if (destroyed)
          throw new Error('Recognizer has been released')
        const ptr = bridge._malloc(samples.byteLength)
        try {
          bridge.HEAPF32.set(samples, ptr / 4)
          bridge._AsrAccept(ptr, samples.length)
        }
        finally { bridge._free(ptr) }
        return decode()
      },
      /** Triggering workflow: Stop -> drain audio queue -> final chunk flush -> final transcript. */
      async finish() {
        bridge._AsrFinish()
        return decode()
      },
      dispose,
      stats: () => ({ decodedChunks, gpuDispatches: dispatches }),
    }
  }
  catch (error) {
    await dispose()
    throw error
  }
}
