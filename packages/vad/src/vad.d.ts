import type { WebAssemblyModule } from '@sherpaw/shared'

export interface SileroVadModelConfig {
  model?: string
  threshold?: number
  minSilenceDuration?: number
  minSpeechDuration?: number
  windowSize?: number
  maxSpeechDuration?: number
}

export interface TenVadModelConfig {
  model?: string
  threshold?: number
  minSilenceDuration?: number
  minSpeechDuration?: number
  windowSize?: number
  maxSpeechDuration?: number
}

export interface VadConfig {
  sileroVad?: SileroVadModelConfig
  tenVad?: TenVadModelConfig
  sampleRate?: number
  numThreads?: number
  provider?: string
  debug?: number
  bufferSizeInSeconds?: number
}

export interface VadSpeechSegment {
  samples: Float32Array
  start: number
}

export interface VadInstance {
  handle: number
  config: VadConfig
  Module: WebAssemblyModule

  free: () => void
  acceptWaveform: (samples: Float32Array) => void
  isEmpty: () => boolean
  isDetected: () => boolean
  pop: () => void
  clear: () => void
  front: () => VadSpeechSegment
  reset: () => void
  flush: () => void
}

export class CircularBuffer {
  handle: number
  Module: WebAssemblyModule

  constructor(capacity: number, Module: WebAssemblyModule)
  free(): void
  push(samples: Float32Array): void
  get(startIndex: number, n: number): Float32Array
  pop(n: number): void
  size(): number
  head(): number
  reset(): void
}

export function createVad(
  Module: WebAssemblyModule,
  myConfig?: VadConfig,
): VadInstance
