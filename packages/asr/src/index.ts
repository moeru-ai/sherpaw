import type { WebAssemblyModule } from '@sherpaw/shared'

export * from './asr'
export type { WebAssemblyModule as ASRModule } from '@sherpaw/shared'

export async function initASRModule(): Promise<WebAssemblyModule> {
  // @ts-expect-error Missing types
  const prebuiltASRModule = await import('./prebuilt/asr.js')
  const init = (prebuiltASRModule as any).default ?? prebuiltASRModule
  const wasmUrl = new URL('./prebuilt/asr.wasm', import.meta.url).toString()
  return await init({ locateFile: () => wasmUrl })
}
