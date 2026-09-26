import type { ModelManifest } from './catalog'
import type { Recognizer, RecognizerOptions } from './types'

import { acceptAudio, fetchChecked, loadNativeRuntime } from './native'
import { createOnnxBridge } from './onnx'

/** Triggering workflow: runtime.worker load -> pinned Transducer manifest -> native session and optional GPU encoder. */
export async function createTransducerRecognizer(options: RecognizerOptions, baseUrl: string, report: (message: string) => void): Promise<Recognizer> {
  const { modelId, backend } = options
  const useGpu = backend === 'webgpu-encoder'
  if (backend !== 'cpu' && !(useGpu && modelId === 'x-asr-fp32'))
    throw new Error('Transducer WebGPU requires the X-ASR FP32 encoder backend')
  const root = new URL(`asr-models/${modelId}/`, baseUrl)
  const response = await fetch(new URL('manifest.json', root))
  if (!response.ok || !response.headers.get('content-type')?.includes('json'))
    throw new Error('Model files are missing. Run python3 scripts/prepare-asr-models.py in the worktree.')
  const manifest: ModelManifest = await response.json()
  if (manifest.id !== modelId)
    throw new Error('Model manifest does not match the selected model')
  report(`Loading ${manifest.label} · CPU / WASM…`)
  const { runtime, errors } = await loadNativeRuntime(useGpu ? 'catalog-asr-webgpu' : 'catalog-asr', baseUrl)
  const paths: string[] = []
  let encoderBytes: Uint8Array | undefined
  let downloaded = 0
  for (const file of manifest.files) {
    if (file.path.startsWith('/') || file.path.split('/').includes('..'))
      throw new Error('Invalid model file path')
    report(`Loading ${manifest.label} · ${Math.round(downloaded / 1e6)} / ${Math.round(manifest.modelBytes / 1e6)} MB · ${file.path}`)
    const bytes = new Uint8Array(await (await fetchChecked(new URL(file.path, root))).arrayBuffer())
    if (bytes.byteLength !== file.bytes)
      throw new Error(`Incomplete model file: ${file.path}`)
    if (useGpu && file.path === manifest.weights.encoder)
      encoderBytes = bytes
    const path = `/model/${file.path}`
    runtime.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
    runtime.FS.writeFile(path, bytes)
    paths.push(path)
    downloaded += file.bytes
  }
  function file(role: keyof ModelManifest['weights']) {
    const path = manifest.weights[role]
    if (!manifest.files.some(file => file.path === path))
      throw new Error(`Missing ${role} weights in model manifest`)
    return `/model/${path}`
  }
  const config = {
    webgpuEncoder: useGpu,
    family: manifest.family,
    featureDim: manifest.featureDim,
    encoder: file('encoder'),
    decoder: file('decoder'),
    joiner: file('joiner'),
    tokens: file('tokens'),
  }
  report(`Initializing ${manifest.label} · CPU / WASM…`)
  const success = runtime.ccall('CatalogCreate', 'number', ['string'], [JSON.stringify(config)])
  if (!success)
    throw new Error(`Could not initialize ${manifest.label}: ${errors.join('\n')}`)
  // Sessions own their weights now. Release the MEMFS copies before recording.
  for (const path of paths) runtime.FS.unlink(path)
  const gpu = useGpu
    ? await createOnnxBridge(runtime, { encoder: { bytes: encoderBytes!, provider: 'webgpu' } }, options.diagnostics)
    : undefined
  let decodedChunks = 0
  function snapshot() {
    if (runtime.asrError)
      throw new Error(runtime.asrError)
    const snapshot: { text: string, decodedChunks: number } = JSON.parse(runtime.ccall('CatalogSnapshot', 'string', [], []))
    decodedChunks = snapshot.decodedChunks
    return snapshot.text
  }
  report(`Ready · ${manifest.label} · ${useGpu ? 'WebGPU encoder + CPU decoder/joiner' : 'CPU / WASM'} · streaming`)
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
