import type { KWSModule } from './types'

import init from './prebuilt/kws.js'

export type { Detection, KeywordEntry, KeywordMatch, KeywordSpotter, KeywordSpotterConfig, KWSModel, KWSModule } from './types'

export { createKeywordSpotter } from './spotter'

export async function initKWSModule(): Promise<KWSModule> {
  const wasmUrl = new URL('./prebuilt/kws.wasm', import.meta.url).toString()

  return init({ locateFile: () => wasmUrl })
}
