export type { NativeKeywordSpotter as KeywordSpotter, NativeKeywordSpotterConfig as KeywordSpotterConfig } from './spotter'
export type { Detection, KeywordEntry, KeywordMatch, KeywordUpdateOptions, KWSModel } from './types'
export type { KWSModule } from './wasm'

export { createKeywordSpotter } from './spotter'
export { initKWSModule } from './wasm'
