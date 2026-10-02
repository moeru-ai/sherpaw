import type { StreamingRecognizer, TimedToken } from '@sherpaw/asr'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export type AsrBackend = 'cpu' | 'webgpu' | 'webgpu-decoder' | 'webgpu-fp32' | 'webgpu-encoder'

export interface RecognizerOptions {
  modelId: string
  backend: AsrBackend
}

export type Recognizer = StreamingRecognizer

export type RecognizerRequest
  = | { kind: 'load', options: RecognizerOptions }
    | { kind: 'accept', samples: Float32Array }
    | { kind: 'finish' | 'dispose' }

/**
 * The text after a request, and the tokens from index `from` on. Tokens before `from` did not change
 * since the previous reply, so the reply leaves them out.
 */
export interface RecognizerReply {
  text: string
  from: number
  tokens: TimedToken[]
  /** Samples that the recognizer has taken so far. */
  received: number
}

export const operation = defineInvokeEventa<RecognizerReply, RecognizerRequest>('sherpaw:asr:operation')
export const progress = defineEventa<string>('sherpaw:asr:progress')
