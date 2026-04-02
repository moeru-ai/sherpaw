import type { WebAssemblyModule } from '@sherpaw/shared'

let defaultModulePromise: Promise<WebAssemblyModule> | null = null

export async function initVadAsrModule(): Promise<WebAssemblyModule> {
  // @ts-expect-error Missing types from generated prebuilt module
  const prebuiltModule = await import('./prebuilt/vad-asr.js')
  const init = (prebuiltModule as any).default ?? prebuiltModule
  const wasmUrl = new URL('./prebuilt/vad-asr.wasm', import.meta.url).toString()
  return await init({ locateFile: () => wasmUrl })
}

export function getDefaultModule(): Promise<WebAssemblyModule> {
  if (!defaultModulePromise) {
    defaultModulePromise = initVadAsrModule().catch((error) => {
      defaultModulePromise = null
      throw error
    })
  }
  return defaultModulePromise
}
