import type { KWSModule } from './types'

export type { Detection, KeywordEntry, KeywordSpotter, KeywordSpotterConfig, KWSModel, KWSModule } from './types'

export { createKeywordSpotter } from './spotter'

export async function initKWSModule(): Promise<KWSModule> {
  const { default: init } = await import('./prebuilt/kws.js')
  const wasmUrl = new URL('./prebuilt/kws.wasm', import.meta.url).toString()
  return init({ locateFile: () => wasmUrl })
}
