import type { Eventa } from '@moeru/eventa'
import type { FlexibleModelInput, WebAssemblyModule } from '@sherpaw/shared'

import type { vadAsrEvents } from './events'

export interface RecognitionSegment {
  text: string
  start: number
  end: number
  startSec: number
  endSec: number
  durationSec: number
  sampleRate: number
  samples: Float32Array
  result: Record<string, unknown>
}

export type VadAsrEventMap = {
  [K in keyof typeof vadAsrEvents]: typeof vadAsrEvents[K] extends Eventa<infer T> ? T : never
}

// Model input types

export interface MoonshineModelInput {
  preprocessor?: FlexibleModelInput
  encoder: FlexibleModelInput
  uncachedDecoder?: FlexibleModelInput
  cachedDecoder?: FlexibleModelInput
  mergedDecoder?: FlexibleModelInput
}

export interface WhisperModelInput {
  encoder: FlexibleModelInput
  decoder: FlexibleModelInput
  language?: string
  task?: string
  tailPaddings?: number
}

export interface TransducerModelInput {
  encoder: FlexibleModelInput
  decoder: FlexibleModelInput
  joiner: FlexibleModelInput
}

export interface ParaformerModelInput {
  model: FlexibleModelInput
}

export interface SimpleModelInput {
  model: FlexibleModelInput
}

// Config types

export interface ASRModelSpec {
  tokens: FlexibleModelInput
  moonshine?: MoonshineModelInput
  whisper?: WhisperModelInput
  paraformer?: ParaformerModelInput
  transducer?: TransducerModelInput
  zipformerCtc?: SimpleModelInput
  zipformer2Ctc?: SimpleModelInput
  numThreads?: number
  provider?: string
  debug?: number
  modelType?: string
}

export type ASRModelConfig = ASRModelSpec | { modelConfig: ASRModelSpec }

export interface VADModelConfig {
  silero: FlexibleModelInput
  threshold?: number
  minSilenceDuration?: number
  minSpeechDuration?: number
  windowSize?: number
  maxSpeechDuration?: number
}

export interface ModelsConfig {
  vad: VADModelConfig
  asr: ASRModelConfig
}

export interface RuntimeOptions {
  sampleRate?: number
  bufferSizeInSeconds?: number
}

export interface CreateVadAsrOptions {
  models: ModelsConfig
  module?: WebAssemblyModule
  runtime?: RuntimeOptions
}

// Session interface

export interface VadAsr extends AsyncIterable<RecognitionSegment> {
  push: (samples: Float32Array, sampleRate?: number) => void
  flush: () => void
  drain: () => RecognitionSegment[]
  transcribe: (samples: Float32Array, sampleRate?: number) => Promise<RecognitionSegment[]>
  close: () => void

  on: <K extends keyof VadAsrEventMap>(event: K, handler: (data: VadAsrEventMap[K]) => void) => () => void

  readonly writable: WritableStream<Float32Array>
  readonly readable: ReadableStream<RecognitionSegment>
}

export type VadAsrSession = VadAsr
