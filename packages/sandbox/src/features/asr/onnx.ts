/// <reference types="@webgpu/types" />
import ortModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import * as ort from 'onnxruntime-web/webgpu'

import { countGpuDispatches } from './gpu-diagnostics'

export type Network = 'encoder' | 'decoder'
interface Descriptor { name: string, type: number, dims: number[], count: number, ptr: number }
export interface TensorBridge {
  HEAPU8: Uint8Array
  _malloc: (bytes: number) => number
  _free: (ptr: number) => void
  UTF8ToString: (ptr: number) => string
  stringToUTF8: (value: string, ptr: number, bytes: number) => void
  lengthBytesUTF8: (value: string) => number
  runAsr: (model: Network, inputs: Descriptor[]) => Promise<number>
  asrError?: string
}

type Weights = Partial<Record<Network, { bytes: Uint8Array, provider: 'wasm' | 'webgpu' }>>

/** Own ORT sessions, hardware validation, tensor transport, and optional worker diagnostics. */
export async function createOnnxBridge(bridge: TensorBridge, weights: Weights, diagnostics = false) {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter || adapter.info.isFallbackAdapter)
    throw new Error('Hardware WebGPU is unavailable in this browser')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = { mjs: ortModuleUrl, wasm: ortWasmUrl }
  const sessions: Partial<Record<Network, ort.InferenceSession>> = {}
  let counter: ReturnType<typeof countGpuDispatches> | undefined
  let disposed = false
  async function dispose() {
    if (disposed)
      return
    disposed = true
    counter?.dispose()
    await Promise.all(Object.values(sessions).map(session => session.release()))
  }
  try {
    for (const [name, model] of Object.entries(weights))
      sessions[name as Network] = await ort.InferenceSession.create(model.bytes, { executionProviders: [model.provider] })
    const info = (await ort.env.webgpu.device).adapterInfo
    if (info.isFallbackAdapter)
      throw new Error('ONNX Runtime selected a software GPU adapter')
    counter = countGpuDispatches(diagnostics)
    installAsrRunner(bridge, sessions)
    return { device: `${info.vendor} ${info.architecture}`, gpuDispatches: counter.read, dispose }
  }
  catch (error) {
    await dispose()
    throw error
  }
}

/** Connect the Sherpa session boundary to browser inference, preserving tensor ownership. */
function installAsrRunner(
  bridge: TensorBridge,
  sessions: Partial<Record<Network, ort.InferenceSession>>,
) {
  /** Triggering workflow: C++ AsrWebRun -> async session.run -> tensors copied into Sherpa heap -> C++ decoding resumes. */
  bridge.runAsr = async (model, descriptors) => {
    const inputs: Record<string, ort.Tensor> = {}
    const allocations: number[] = []
    let outputs: ort.InferenceSession.ReturnType | undefined
    try {
      for (const input of descriptors) {
        const bytes = bridge.HEAPU8.slice(input.ptr, input.ptr + input.count * (input.type === 7 ? 8 : 4))
        if (input.type === 1)
          inputs[input.name] = new ort.Tensor('float32', new Float32Array(bytes.buffer), input.dims)
        else if (input.type === 6)
          inputs[input.name] = new ort.Tensor('int32', new Int32Array(bytes.buffer), input.dims)
        else if (input.type === 7)
          inputs[input.name] = new ort.Tensor('int64', new BigInt64Array(bytes.buffer), input.dims)
        else
          throw new Error(`Unsupported ASR input type ${input.type}`)
      }
      const session = sessions[model]!
      outputs = await session.run(inputs)
      const result = []
      for (const name of session.outputNames) {
        const tensor = outputs[name]!
        const data = await tensor.getData()
        if (tensor.type !== 'float32' && tensor.type !== 'int32' && tensor.type !== 'int64')
          throw new Error(`Unsupported ASR output type ${tensor.type}`)
        const array = data as Float32Array | Int32Array | BigInt64Array
        const ptr = bridge._malloc(array.byteLength) >>> 0
        if (!ptr)
          throw new Error('Not enough WASM memory for an inference output')
        allocations.push(ptr)
        bridge.HEAPU8.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), ptr)
        result.push({ type: tensor.type === 'float32' ? 1 : tensor.type === 'int32' ? 6 : 7, dims: tensor.dims, ptr })
      }
      const json = JSON.stringify(result)
      const size = bridge.lengthBytesUTF8(json) + 1
      const ptr = bridge._malloc(size) >>> 0
      if (!ptr)
        throw new Error('Not enough WASM memory for output descriptors')
      allocations.push(ptr)
      bridge.stringToUTF8(json, ptr, size)
      // Ownership of all output allocations transfers to C++.
      allocations.length = 0
      return ptr
    }
    finally {
      for (const ptr of allocations) bridge._free(ptr)
      for (const tensor of Object.values(inputs)) tensor.dispose()
      if (outputs) {
        for (const tensor of Object.values(outputs)) tensor.dispose()
      }
    }
  }
}
