import type { WebAssemblyModule } from '@sherpaw/shared'

export type { WebAssemblyModule as VADModule } from '@sherpaw/shared'

export * from './vad'

export async function initVADModule(): Promise<WebAssemblyModule> {
  // @ts-expect-error Missing types from generated prebuilt module
  const prebuiltVADModule = await import('./prebuilt/vad.js')
  const init = (prebuiltVADModule as any).default ?? prebuiltVADModule
  const wasmUrl = new URL('./prebuilt/vad.wasm', import.meta.url).toString()
  return await init({ locateFile: () => wasmUrl })
}
