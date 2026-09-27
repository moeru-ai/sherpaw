import type { StreamingRecognizer } from '@sherpaw/asr'

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

export const operation = defineInvokeEventa<string, RecognizerRequest>('sherpaw:asr:operation')
export const progress = defineEventa<string>('sherpaw:asr:progress')
