import type { Detection, KeywordEntry, KWSModel } from '@sherpaw/kws'

export type Request
  = | { type: 'load', urls: KWSModel, keywords: KeywordEntry[] }
    | { type: 'keywords', keywords: KeywordEntry[] }
    | { type: 'reset' }
    | { type: 'audio', samples: Float32Array, sampleRate: number }

export interface Reply {
  id: number
  detections?: Detection[]
  error?: string
  progress?: string
}
