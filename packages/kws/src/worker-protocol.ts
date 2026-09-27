import type { Detection, KeywordEntry } from './types'
import type { KeywordUpdateOptions, KWSModelPack } from './worker-types'

export type Request
  = | { type: 'initialize', model: KWSModelPack, keywords: readonly KeywordEntry[], maxActivePaths?: number }
    | { type: 'keywords', keywords: readonly KeywordEntry[], options?: KeywordUpdateOptions }
    | { type: 'reset' }
    | { type: 'audio', samples: Float32Array, sampleRate: number }

export interface Command {
  id: number
  request: Request
}

export interface Reply {
  id: number
  detections?: Detection[]
  error?: { name: string, message: string }
}
