import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

import type {
  FinishResult,
  PushAudioInvokeRequest,
  PushAudioResult,
  TranscriptionEvent,
} from './stream-transcription/types'
import type { SherpawSpeechModel } from './types'

export const streamTranscriptionEvent = defineEventa<TranscriptionEvent>('sherpaw:stream-transcription:event')

export const streamTranscriptionInitInvoke = defineInvokeEventa<void, SherpawSpeechModel>('sherpaw:stream-transcription:init')
export const streamTranscriptionPushInvoke = defineInvokeEventa<PushAudioResult, PushAudioInvokeRequest>('sherpaw:stream-transcription:push')
export const streamTranscriptionFinishInvoke = defineInvokeEventa<FinishResult, void>('sherpaw:stream-transcription:finish')
export const streamTranscriptionResetInvoke = defineInvokeEventa<void, void>('sherpaw:stream-transcription:reset')
export const streamTranscriptionDisposeInvoke = defineInvokeEventa<void, void>('sherpaw:stream-transcription:dispose')
