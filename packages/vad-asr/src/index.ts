import type { WebAssemblyModule } from '@sherpaw/shared'

export type { OfflineRecognizerConfig } from './asr'
export type { WebAssemblyModule as VADASRModule } from '@sherpaw/shared'

export { OfflineRecognizer } from './asr'
export * from './vad'

export async function initVADASRModule(): Promise<WebAssemblyModule> {
  // @ts-expect-error Missing types from generated prebuilt module
  const prebuiltVADASRModule = await import('./prebuilt/vad-asr.js')
  const init = (prebuiltVADASRModule as any).default ?? prebuiltVADASRModule
  const wasmUrl = new URL('./prebuilt/vad-asr.wasm', import.meta.url).toString()
  return await init({ locateFile: () => wasmUrl })
}
