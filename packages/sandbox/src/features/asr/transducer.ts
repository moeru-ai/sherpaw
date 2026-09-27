import type { Recognizer, RecognizerOptions } from './protocol'

import { asrModels } from './catalog'
import { loadTransducerWeights } from './models'
import { acceptAudio, loadNativeRuntime } from './native'
import { createOnnxBridge } from './onnx'

/** Triggering workflow: runtime.worker load -> pinned Transducer weights -> native session and optional GPU encoder. */
export async function createTransducerRecognizer(options: RecognizerOptions, baseUrl: string, report: (message: string) => void): Promise<Recognizer> {
  const { modelId, backend } = options
  const useGpu = backend === 'webgpu-encoder'
  if (backend !== 'cpu' && !(useGpu && modelId === 'x-asr-fp32'))
    throw new Error('Transducer WebGPU requires the X-ASR FP32 encoder backend')
  const model = asrModels.find(model => model.id === modelId)
  if (!model)
    throw new Error(`Unknown model: ${modelId}`)
  report(`Loading ${model.label} · CPU / WASM…`)
  const { runtime, errors } = await loadNativeRuntime(useGpu ? 'catalog-asr-webgpu' : 'catalog-asr', baseUrl)
  const files = await loadTransducerWeights(model)
  if (files.reduce((size, file) => size + file.bytes.byteLength, 0) !== model.modelBytes)
    throw new Error(`Incomplete model weights: ${model.label}`)
  for (const file of files) runtime.FS.writeFile(file.filename, file.bytes)
  const config = {
    webgpuEncoder: useGpu,
    family: model.family,
    featureDim: model.featureDim,
    encoder: '/encoder.onnx',
    decoder: '/decoder.onnx',
    joiner: '/joiner.onnx',
    tokens: '/tokens.txt',
  }
  report(`Initializing ${model.label} · CPU / WASM…`)
  const success = runtime.ccall('CatalogCreate', 'number', ['string'], [JSON.stringify(config)])
  if (!success)
    throw new Error(`Could not initialize ${model.label}: ${errors.join('\n')}`)
  // Sessions own their weights now. Release the MEMFS copies before recording.
  for (const file of files) runtime.FS.unlink(file.filename)
  const gpu = useGpu
    ? await createOnnxBridge(runtime, { encoder: { bytes: files.find(file => file.filename === '/encoder.onnx')!.bytes, provider: 'webgpu' } }, options.diagnostics)
    : undefined
  let decodedChunks = 0
  function snapshot() {
    if (runtime.asrError)
      throw new Error(runtime.asrError)
    const snapshot: { text: string, decodedChunks: number } = JSON.parse(runtime.ccall('CatalogSnapshot', 'string', [], []))
    decodedChunks = snapshot.decodedChunks
    return snapshot.text
  }
  report(`Ready · ${model.label} · ${useGpu ? 'WebGPU encoder + CPU decoder/joiner' : 'CPU / WASM'} · streaming`)
  return {
    /** Triggering workflow: runtime.worker accept -> CatalogAccept -> streaming transcript. */
    async accept(samples) {
      await acceptAudio(runtime, 'CatalogAccept', samples)
      return snapshot()
    },
    /** Triggering workflow: runtime.worker finish -> CatalogFinish -> trailing context and final transcript. */
    async finish() {
      await runtime.ccall('CatalogFinish', null, [], [], { async: true })
      return snapshot()
    },
    async dispose() {
      runtime.ccall('CatalogDestroy', null, [], [])
      await gpu?.dispose()
    },
    stats: () => ({ decodedChunks, gpuDispatches: gpu?.gpuDispatches() ?? 0 }),
  }
}
