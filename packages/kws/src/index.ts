export type { Detection, KeywordEntry, KeywordMatch } from './types'
export type { WorkerKeywordSpotter as KeywordSpotter, WorkerKeywordSpotterConfig as KeywordSpotterConfig, KeywordUpdateOptions, KWSModelPack } from './worker-types'

export { createKeywordSpotter } from './worker'
