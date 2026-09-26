import * as ort from 'onnxruntime-web/webgpu'

import type { TensorBridge } from '../webgpu-experiment/asr-runtime'
import type { ModelManifest, ModelReply, ModelRequest, ModelSnapshot } from './catalog'

import { configureAsrOrt, installAsrRunner } from '../webgpu-experiment/asr-runtime'

interface Runtime extends TensorBridge {
  FS: {
    mkdirTree: (path: string) => void
    writeFile: (path: string, data: Uint8Array) => void
    unlink: (path: string) => void
  }
  HEAPF32: Float32Array
  _malloc: (bytes: number) => number
  _free: (ptr: number) => void
  ccall: (name: string, result: string | null, types: string[], args: unknown[], options?: { async: true }) => any
}

let runtime: Runtime | undefined
let loaded = false
let gpuDispatches = 0
let encoderSession: ort.InferenceSession | undefined

function reply(message: ModelReply) {
  globalThis.postMessage(message)
}

async function fetchBytes(url: string, expectedBytes?: number) {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Model download failed (${response.status}): ${url}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)
    throw new Error(`Incomplete model file: ${url}`)
  return bytes
}

/** Triggering workflow: createModelRecognizer -> load request -> local model manifest/files -> CatalogCreate. */
async function load(request: Extract<ModelRequest, { kind: 'load' }>) {
  const useGpu = request.backend === 'webgpu-encoder'
  if (useGpu && request.modelId !== 'x-asr-fp32')
    throw new Error('WebGPU encoder requires X-ASR FP32')
  if (useGpu) {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter || adapter.info.isFallbackAdapter)
      throw new Error('Hardware WebGPU is unavailable in this browser')
    configureAsrOrt()
  }
  const root = new URL(`asr-models/${request.modelId}/`, request.baseUrl)
  const response = await fetch(new URL('manifest.json', root))
  if (!response.ok || !response.headers.get('content-type')?.includes('json'))
    throw new Error('Model files are missing. Run python3 scripts/prepare-asr-models.py in the worktree.')
  const manifest: ModelManifest = await response.json()
  if (manifest.id !== request.modelId)
    throw new Error('Model manifest does not match the selected model')
  const status = (message: string) => reply({ id: request.id, status: message })
  status(`Loading ${manifest.label} · CPU / WASM…`)
  const runtimeName = useGpu ? 'catalog-asr-webgpu' : 'catalog-asr'
  const runtimeUrl = new URL(`asr-runtime/${runtimeName}.js`, request.baseUrl).href
  const { default: init } = await import(/* @vite-ignore */ runtimeUrl)
  const errors: string[] = []
  runtime = await init({
    locateFile: (name: string) => new URL(`asr-runtime/${name}`, request.baseUrl).href,
    printErr: (message: string) => {
      errors.push(message)
      if (errors.length > 8)
        errors.shift()
    },
  })
  const paths: string[] = []
  let encoderBytes: Uint8Array | undefined
  let downloaded = 0
  for (const file of manifest.files) {
    if (file.path.startsWith('/') || file.path.split('/').includes('..'))
      throw new Error('Invalid model file path')
    status(`Loading ${manifest.label} · ${Math.round(downloaded / 1e6)} / ${Math.round(manifest.modelBytes / 1e6)} MB · ${file.path}`)
    const bytes = await fetchBytes(new URL(file.path, root).href, file.bytes)
    if (useGpu && file.path === manifest.weights.encoder)
      encoderBytes = bytes
    const path = `/model/${file.path}`
    runtime!.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
    runtime!.FS.writeFile(path, bytes)
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
  status(`Initializing ${manifest.label} · CPU / WASM…`)
  const success = runtime!.ccall('CatalogCreate', 'number', ['string'], [JSON.stringify(config)])
  if (!success)
    throw new Error(`Could not initialize ${manifest.label}: ${errors.join('\n')}`)
  // Sessions own their weights now. Release the MEMFS copies before recording.
  for (const path of paths) runtime!.FS.unlink(path)
  if (useGpu) {
    status(`Initializing ${manifest.label} · WebGPU encoder…`)
    encoderSession = await ort.InferenceSession.create(encoderBytes!, { executionProviders: ['webgpu'] })
    const info = (await ort.env.webgpu.device).adapterInfo
    if (info.isFallbackAdapter)
      throw new Error('ONNX Runtime selected a software GPU adapter')
    const originalDispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups
    /** Triggering workflow: encoderSession.run -> WebGPU dispatch -> worker snapshot GPU activity evidence. */
    GPUComputePassEncoder.prototype.dispatchWorkgroups = function (...args) {
      gpuDispatches++
      return originalDispatch.apply(this, args)
    }
    installAsrRunner(runtime!, { encoder: encoderSession })
  }
  loaded = true
  status(`Ready · ${manifest.label} · ${useGpu ? 'WebGPU encoder + CPU decoder/joiner' : 'CPU / WASM'} · streaming`)
}

/** Triggering workflow: model client RPC -> load/PCM/final flush -> native runtime -> transcript reply. */
globalThis.onmessage = async (event: MessageEvent<ModelRequest>) => {
  const request = event.data
  try {
    if (request.kind === 'load') {
      await load(request)
    }
    else {
      if (!runtime || !loaded)
        throw new Error('Model is not loaded')
      if (request.kind === 'accept') {
        const ptr = runtime._malloc(request.samples.byteLength) >>> 0
        if (!ptr)
          throw new Error('Not enough WASM memory for the audio batch')
        try {
          runtime.HEAPF32.set(request.samples, ptr / 4)
          await runtime.ccall('CatalogAccept', null, ['number', 'number'], [ptr, request.samples.length], { async: true })
        }
        finally { runtime._free(ptr) }
      }
      else {
        await runtime.ccall('CatalogFinish', null, [], [], { async: true })
      }
    }
    if (runtime?.asrError)
      throw new Error(runtime.asrError)
    const snapshot: ModelSnapshot = JSON.parse(runtime!.ccall('CatalogSnapshot', 'string', [], []))
    snapshot.gpuDispatches = gpuDispatches
    reply({ id: request.id, snapshot })
  }
  catch (error) {
    reply({ id: request.id, error: String(error) })
  }
}
