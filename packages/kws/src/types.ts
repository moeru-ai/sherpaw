import type { DataMetadata } from '@sherpaw/preloader'

export interface KeywordMatch {
  /** Already encoded model tokens; no text, pinyin, phoneme or BPE conversion. */
  tokens: string[]
  /** Override the keyword's boost for this pronunciation. */
  score?: number
  /** Override the keyword's threshold for this pronunciation. */
  threshold?: number
}

export interface KeywordEntry {
  /** Returned unchanged when any match is detected. */
  label: string
  /** At least one complete pronunciation; token sequences must be unique. */
  matches: KeywordMatch[]
  /** Positive, finite normal float32 boost. Default: 1. */
  score?: number
  /** Probability in (0, 1]. Default: 0.25. */
  threshold?: number
}

export interface KWSModel {
  /** Paths in this module's virtual filesystem, populated by the preloader. */
  encoder: string
  decoder: string
  joiner: string
  tokens: string
}

export interface Detection {
  label: string
  /** Upstream segment start time in seconds, passed through unchanged. */
  startTime: number
  /** Upstream segment-relative token times in seconds; may restart after a hit. */
  timestamps: number[]
  tokens: string[]
}

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

export interface KeywordSpotterConfig extends KeywordUpdateOptions {
  model: KWSModelPack
  keywords: readonly KeywordEntry[]
  /** Aborting cancels initialization or disposes the initialized detector. */
  signal?: AbortSignal
  /** Maximum outstanding audio requests, including the executing request. Default: 4. */
  maxPendingAudio?: number
}

/** All operations execute in call order on the detector's dedicated Worker. */
export interface KeywordSpotter {
  /** Replaces keywords and search settings atomically; [] pauses. Rejection preserves both. Input is copied at call time. */
  setKeywords: (entries: readonly KeywordEntry[], options?: KeywordUpdateOptions) => Promise<void>
  /** Copies mono PCM without detaching the caller's buffer. Rejects when the audio queue is full. */
  processAudio: (samples: Float32Array, sampleRate: number) => Promise<Detection[]>
  /** Starts a fresh audio stream without reloading models or changing keywords. */
  reset: () => Promise<void>
  /** Terminates the Worker and rejects pending operations. Safe to repeat. */
  dispose: () => void
}
