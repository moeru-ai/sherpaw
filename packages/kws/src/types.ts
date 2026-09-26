import type { WebAssemblyModule } from '@sherpaw/shared'

/** Exports of the standalone KWS runtime. Compatible with @sherpaw/preloader. */
export interface KWSModule extends WebAssemblyModule {
  FS: typeof FS
  _SherpawCreateKeywordSpotter: (encoder: number, decoder: number, joiner: number, tokens: number, keywords: number, maxActivePaths: number) => number
  _SherpaOnnxCreateKeywordStream: (spotter: number) => number
  _SherpaOnnxIsKeywordStreamReady: (spotter: number, stream: number) => number
  _SherpaOnnxDecodeKeywordStream: (spotter: number, stream: number) => void
  _SherpaOnnxResetKeywordStream: (spotter: number, stream: number) => void
  _SherpaOnnxGetKeywordResult: (spotter: number, stream: number) => number
  _SherpaOnnxDestroyKeywordResult: (result: number) => void
  _SherpawKeywordResultKeyword: (result: number) => number
  _SherpawKeywordResultCount: (result: number) => number
  _SherpawKeywordResultToken: (result: number, index: number) => number
  _SherpawKeywordResultTimestamp: (result: number, index: number) => number
  _SherpawKeywordResultStartTime: (result: number) => number
}

export interface KeywordEntry {
  /** Already encoded model tokens; no text, pinyin, phoneme or BPE conversion. */
  tokens: string[]
  label: string
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

export interface KeywordSpotterConfig {
  model: KWSModel
  /** Positive int32 search beam size. Default: 4. Larger values cost more CPU. */
  maxActivePaths?: number
  /** Must contain at least one entry at creation. */
  keywords: readonly KeywordEntry[]
}

export interface Detection {
  label: string
  /** Upstream segment start time in seconds, passed through unchanged. */
  startTime: number
  /** Upstream segment-relative token times in seconds; may restart after a hit. */
  timestamps: number[]
  tokens: string[]
}

export interface KeywordSpotter {
  /**
   * Replace the entire vocabulary in call order. [] pauses and discards audio.
   * Successful replacement resets the audio state and timestamp origin.
   * Rejection preserves the previous vocabulary. Input is copied at call time.
   */
  setKeywords: (entries: readonly KeywordEntry[]) => Promise<void>
  /**
   * Consume mono PCM in [-1, 1] at a fixed sample rate until the next update,
   * decode ready frames, and reset after each hit.
   * Synchronous; use a Worker to keep inference and model reloads off the UI.
   */
  processAudio: (samples: Float32Array, sampleRate: number) => Detection[]
  /** Idempotent. Pending updates reject; further processing throws. */
  dispose: () => void
}
