import type { WebGpuModule, WebGpuWeights } from '@sherpaw/asr/webgpu'

import { createStreamingRecognizer, initASRModule, OnlineRecognizerTypes } from '@sherpaw/asr'
import { loadVirtualData } from '@sherpaw/preloader'

import type { Recognizer, RecognizerOptions } from './protocol'

import { asrModels } from './catalog'
import { countGpuDispatches } from './gpu-diagnostics'
import { loadPackedWeights, loadParaformerFloatWeights, loadTransducerWeights } from './models'

/** Triggering workflow: runtime.worker load -> application model policy -> shared SDK recording lifecycle. */
export async function loadRecognizer(options: RecognizerOptions, report: (message: string) => void): Promise<Recognizer> {
  const { modelId, backend } = options
  const paraformer = modelId === 'paraformer'
  const model = asrModels.find(model => model.id === modelId)
  if (!paraformer && !model)
    throw new Error(`Unknown model: ${modelId}`)
  if (backend !== 'cpu' && (paraformer ? backend === 'webgpu-encoder' : !(modelId === 'x-asr-fp32' && backend === 'webgpu-encoder')))
    throw new Error('This model does not support the selected WebGPU backend')

  const label = paraformer ? 'Paraformer zh-en' : model!.label
  report(`Loading ${label}…`)
  const gpuApi = backend === 'cpu' ? undefined : await import('@sherpaw/asr/webgpu')
  const module = gpuApi ? await gpuApi.initWebGpuASRModule() : await initASRModule()
  const files = paraformer
    ? await loadPackedWeights('sherpaw-paraformer-zh-en', '46701cc733a82ed5cb94c7f3200a002d010243f6')
    : await loadTransducerWeights(model!)
  if (model && files.reduce((size, file) => size + file.bytes.byteLength, 0) !== model.modelBytes)
    throw new Error(`Incomplete model weights: ${label}`)

  const weights: WebGpuWeights = {}
  if (gpuApi) {
    for (const network of paraformer ? ['encoder', 'decoder'] as const : ['encoder'] as const) {
      weights[network] = {
        bytes: backend === 'webgpu-fp32'
          ? await loadParaformerFloatWeights(network)
          : files.find(file => file.filename === `/${network}.onnx`)!.bytes,
        provider: backend === 'webgpu-decoder' && network === 'encoder' ? 'wasm' : 'webgpu',
      }
    }
  }
  loadVirtualData({ module, virtualData: Object.fromEntries(files.map(file => [file.filename, file.bytes])) })
  try {
    report(`Initializing ${label} · ${gpuApi ? 'WebGPU' : 'CPU / WASM'}…`)
    const execution = await gpuApi?.createWebGpuBackend(module as WebGpuModule, weights)
    // The SDK owns execution from here, including cleanup if native initialization fails.
    const session = await createStreamingRecognizer(module, {
      type: paraformer ? OnlineRecognizerTypes.Paraformer : OnlineRecognizerTypes.Transducer,
      featConfig: { sampleRate: 16000, featureDim: model?.featureDim ?? 80 },
      modelConfig: { provider: 'cpu', numThreads: 1, debug: 0, modelingUnit: paraformer ? 'cjkchar' : '' },
      enableEndpoint: paraformer ? 0 : 1,
      rule2MinTrailingSilence: 0.8,
    }, execution)
    const counter = countGpuDispatches(Boolean(gpuApi && options.diagnostics))
    report(`Ready · ${label} · ${gpuApi ? 'WebGPU' : 'CPU / WASM'} · streaming`)
    return {
      ...session,
      /** Triggering workflow: worker dispose -> SDK cleanup -> restore worker-only GPU instrumentation. */
      async dispose() {
        try {
          await session.dispose()
        }
        finally {
          counter.dispose()
        }
      },
      stats: () => ({ ...session.stats(), gpuDispatches: counter.read() }),
    }
  }
  finally {
    // Native sessions own their weights now; discard temporary filesystem copies.
    for (const file of files) module.FS_unlink?.(file.filename)
  }
}
