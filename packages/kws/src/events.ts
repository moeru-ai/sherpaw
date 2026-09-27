import { defineInvokeEventa } from '@moeru/eventa'

import type { Detection, KeywordEntry } from './types'
import type { KeywordUpdateOptions, WorkerKeywordSpotterConfig } from './worker-types'

export const initialize = defineInvokeEventa<void, Omit<WorkerKeywordSpotterConfig, 'signal' | 'maxPendingAudio'>>('sherpaw:kws:initialize')
export const setKeywords = defineInvokeEventa<void, { keywords: readonly KeywordEntry[], options?: KeywordUpdateOptions }>('sherpaw:kws:keywords')
export const processAudio = defineInvokeEventa<Detection[], { samples: Float32Array, sampleRate: number }>('sherpaw:kws:audio')
export const reset = defineInvokeEventa<void>('sherpaw:kws:reset')
