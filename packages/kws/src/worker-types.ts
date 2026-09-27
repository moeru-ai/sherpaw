import type { DataMetadata } from '@sherpaw/preloader'

import type { Detection, KeywordEntry, KWSModel } from './types'

/** A downloaded Emscripten preload pack. The caller retains ownership of its bytes. */
export interface KWSModelPack {
  data: ArrayBuffer | Uint8Array
  metadata: DataMetadata
  /** Defaults to encoder.onnx, decoder.onnx, joiner.onnx and tokens.txt. */
  paths?: KWSModel
}

export interface KeywordUpdateOptions {
  /** Positive int32 search beam. Omission preserves the current setting. */
  maxActivePaths?: number
}

export interface WorkerKeywordSpotterConfig extends KeywordUpdateOptions {
  model: KWSModelPack
  keywords: readonly KeywordEntry[]
  /** Aborting cancels initialization or disposes the initialized detector. */
  signal?: AbortSignal
  /** Maximum outstanding audio requests, including the executing request. Default: 4. */
  maxPendingAudio?: number
}

/** All operations execute in call order on the detector's dedicated Worker. */
export interface WorkerKeywordSpotter {
  /** Replaces all keywords atomically; [] pauses detection. Input is copied at call time. */
  setKeywords: (entries: readonly KeywordEntry[], options?: KeywordUpdateOptions) => Promise<void>
  /** Copies mono PCM without detaching the caller's buffer. Rejects when the audio queue is full. */
  processAudio: (samples: Float32Array, sampleRate: number) => Promise<Detection[]>
  /** Starts a fresh audio stream without reloading models or changing keywords. */
  reset: () => Promise<void>
  /** Terminates the Worker and rejects pending operations. Safe to repeat. */
  dispose: () => void
}
