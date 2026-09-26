/// <reference types="@webgpu/types" />
import ortModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import * as ort from 'onnxruntime-web/webgpu'

const packUrl = new URL('../../../../../models/huggingface/sherpaw-paraformer-zh-en/install/bin/wasm/preload.data', import.meta.url).href
const metadataUrl = new URL('../../../../../models/huggingface/sherpaw-paraformer-zh-en/install/bin/wasm/preload.js.metadata', import.meta.url).href
export type Model = 'encoder' | 'decoder'
export type AsrPlacement = 'both' | Model
export type AsrPrecision = 'int8' | 'fp32' | 'fp16'
interface Descriptor { name: string, type: number, dims: number[], count: number, ptr: number }
export interface TensorBridge {
  HEAPU8: Uint8Array
  HEAPF32: Float32Array
  FS: { writeFile: (path: string, bytes: Uint8Array) => void, unlink: (path: string) => void }
  _malloc: (bytes: number) => number
  _free: (ptr: number) => void
  UTF8ToString: (ptr: number) => string
  stringToUTF8: (value: string, ptr: number, bytes: number) => void
  lengthBytesUTF8: (value: string) => number
  runAsr: (model: Model, inputs: Descriptor[]) => Promise<number>
  asrError?: string
}
export interface Bridge extends TensorBridge {
  ccall: (name: string, result: null, types: never[], args: never[], options: { async: true }) => Promise<void>
  _AsrCreate: () => void
  _AsrStart: (web: number) => void
  _AsrAccept: (ptr: number, count: number) => void
  _AsrFinish: () => void
  _AsrReady: () => number
  _AsrDecode: () => void
  _AsrText: () => number
  _AsrDestroy: () => void
}

export async function fetchChecked(url: string) {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${url}`)
  return response
}

/** Load optional float experiment weights; native metadata/reference still uses the original int8 pack. */
export async function loadFloatAsrModel(model: Model, precision: 'fp32' | 'fp16') {
  const url = `${import.meta.env.BASE_URL}webgpu-experiment/${precision}/${model}.onnx`
  return new Uint8Array(await (await fetchChecked(url)).arrayBuffer())
}

export function configureAsrOrt() {
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmPaths = { mjs: ortModuleUrl, wasm: ortWasmUrl }
}

/** Triggering workflow: ASR session initialization -> local WASM/model fetch -> bridge and model bytes. */
export async function loadAsrBridge(report: (message: string) => void) {
  configureAsrOrt()
  report('Loading locally built ASR bridge and Paraformer models…')
  const root = `${import.meta.env.BASE_URL}webgpu-experiment/`
  const { default: init } = await import(/* @vite-ignore */ `${root}asr-probe.js`)
  const messages: string[] = []
  const bridge: Bridge = await init({
    locateFile: () => `${root}asr-probe.wasm`,
    print: (line: string) => messages.push(line),
    printErr: (line: string) => messages.push(line),
  })
  const metadata: { files: { filename: string, start: number, end: number }[] } = await (await fetchChecked(metadataUrl)).json()
  const pack = new Uint8Array(await (await fetchChecked(packUrl)).arrayBuffer())
  const modelBytes: Partial<Record<Model, Uint8Array>> = {}
  for (const entry of metadata.files) {
    const bytes = pack.subarray(entry.start, entry.end)
    bridge.FS.writeFile(entry.filename, bytes)
    if (entry.filename === '/encoder.onnx' || entry.filename === '/decoder.onnx')
      modelBytes[entry.filename.slice(1, -5) as Model] = bytes
  }
  return { bridge, modelBytes, metadata, messages }
}

/** Connect the Sherpa session boundary to browser inference, preserving tensor ownership. */
export function installAsrRunner(
  bridge: TensorBridge,
  sessions: Partial<Record<Model, ort.InferenceSession>>,
  onRun: (model: Model, ms: number, dispatches: number) => void = () => {},
  getDispatches: () => number = () => 0,
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
      const start = performance.now()
      const dispatchStart = getDispatches()
      outputs = await session.run(inputs)
      const result = []
      for (const name of session.outputNames) {
        const tensor = outputs[name]!
        const data = await tensor.getData()
        if (tensor.type !== 'float32' && tensor.type !== 'int32' && tensor.type !== 'int64')
          throw new Error(`Unsupported ASR output type ${tensor.type}`)
        const array = data as Float32Array | Int32Array | BigInt64Array
        const ptr = bridge._malloc(array.byteLength)
        allocations.push(ptr)
        bridge.HEAPU8.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), ptr)
        result.push({ type: tensor.type === 'float32' ? 1 : tensor.type === 'int32' ? 6 : 7, dims: tensor.dims, ptr })
      }
      onRun(model, performance.now() - start, getDispatches() - dispatchStart)
      const json = JSON.stringify(result)
      const size = bridge.lengthBytesUTF8(json) + 1
      const ptr = bridge._malloc(size)
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
