import type { TensorBridge } from './onnx'

export interface NativeRuntime extends TensorBridge {
  HEAPF32: Float32Array
  FS: {
    mkdirTree: (path: string) => void
    writeFile: (path: string, bytes: Uint8Array) => void
    unlink: (path: string) => void
  }
  ccall: (name: string, result: string | null, types: string[], args: unknown[], options?: { async: true }) => any
}

export async function fetchChecked(url: string | URL) {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${url}`)
  return response
}

/** Load one model adapter's native runtime and retain its latest initialization errors. */
export async function loadNativeRuntime(name: string, baseUrl: string) {
  const root = new URL('asr-runtime/', baseUrl)
  const { default: init } = await import(/* @vite-ignore */ new URL(`${name}.js`, root).href)
  const errors: string[] = []
  const runtime: NativeRuntime = await init({
    locateFile: (file: string) => new URL(file, root).href,
    /** Triggering workflow: Emscripten stderr -> printErr -> adapter initialization error details. */
    printErr: (message: string) => {
      errors.push(message)
      if (errors.length > 8)
        errors.shift()
    },
  })
  return { runtime, errors }
}

/** Triggering workflow: model adapter accept -> temporary PCM allocation -> native streaming input -> release. */
export async function acceptAudio(runtime: NativeRuntime, entry: string, samples: Float32Array) {
  const ptr = runtime._malloc(samples.byteLength) >>> 0
  if (!ptr)
    throw new Error('Not enough WASM memory for the audio batch')
  try {
    runtime.HEAPF32.set(samples, ptr / 4)
    await runtime.ccall(entry, null, ['number', 'number'], [ptr, samples.length], { async: true })
  }
  finally { runtime._free(ptr) }
}
