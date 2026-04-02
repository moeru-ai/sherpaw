import { defineEventa } from '@moeru/eventa'

import type { RecognitionSegment, VadAsrEventMap } from './types'

export const vadAsrSegmentEvent = defineEventa<RecognitionSegment>('sherpaw:vad-asr:segment')
export const vadAsrErrorEvent = defineEventa<unknown>('sherpaw:vad-asr:error')
export const vadAsrClosedEvent = defineEventa<void>('sherpaw:vad-asr:closed')

export const vadAsrEvents = {
  segment: vadAsrSegmentEvent,
  error: vadAsrErrorEvent,
  closed: vadAsrClosedEvent,
} as const
