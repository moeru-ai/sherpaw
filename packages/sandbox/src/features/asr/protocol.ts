import type { StreamingRecognizer } from '@sherpaw/asr'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export type AsrBackend = 'cpu' | 'webgpu' | 'webgpu-decoder' | 'webgpu-fp32' | 'webgpu-encoder'

export interface RecognizerOptions {
  modelId: string
  backend: AsrBackend
  /** Collect GPU dispatch counts for sandbox diagnostics; disabled by default. */
  diagnostics?: boolean
}

export interface RecognizerStats {
  decodedChunks: number
  gpuDispatches: number
}

/** A single recording session, accepting mono 16 kHz PCM in order. */
export interface Recognizer extends Omit<StreamingRecognizer, 'stats'> {
  stats?: () => { decodedChunks: number, gpuDispatches?: number }
}

export interface RecognizerSnapshot extends RecognizerStats { text: string }
export type RecognizerRequest
  = | { kind: 'load', options: RecognizerOptions }
    | { kind: 'accept', samples: Float32Array }
    | { kind: 'finish' | 'dispose' }

export const operation = defineInvokeEventa<RecognizerSnapshot, RecognizerRequest>('sherpaw:asr:operation')
export const progress = defineEventa<string>('sherpaw:asr:progress')
