// Type declarations for the JS implementation in `sherpa-onnx-speaker-diarization.js`
// Generated from the implementation in the repository.

/** Config for the pyannote segmentation model. */
export interface OfflineSpeakerSegmentationPyannoteModelConfig {
  /** Path or URL to the ONNX model. */
  model?: string
}

/** Config for the offline speaker segmentation model. */
export interface OfflineSpeakerSegmentationModelConfig {
  pyannote?: OfflineSpeakerSegmentationPyannoteModelConfig
  /** Number of threads used by the inference backend. */
  numThreads?: number
  /** Enable debug logs (non‑zero) or disable (0). */
  debug?: number
  /** Execution provider (e.g. "cpu"). */
  provider?: string
}

/** Config for the speaker embedding extractor. */
export interface SpeakerEmbeddingExtractorConfig {
  /** Path or URL to the ONNX model. */
  model?: string
  /** Number of threads used by the inference backend. */
  numThreads?: number
  /** Enable debug logs (non‑zero) or disable (0). */
  debug?: number
  /** Execution provider (e.g. "cpu"). */
  provider?: string
}

/** Config for the fast clustering backend. */
export interface FastClusteringConfig {
  /** Number of clusters; -1 to auto‑determine. */
  numClusters?: number
  /** Similarity/affinity threshold. */
  threshold?: number
}

/** Top‑level diarization configuration. */
export interface OfflineSpeakerDiarizationConfig {
  segmentation?: OfflineSpeakerSegmentationModelConfig
  embedding?: SpeakerEmbeddingExtractorConfig
  clustering?: FastClusteringConfig
  /** Minimum duration in seconds for an active speaker segment. */
  minDurationOn?: number
  /** Minimum duration in seconds between segments (silence). */
  minDurationOff?: number
}

/** One diarized speaker segment. */
export interface SpeakerSegment {
  /** Start time in seconds. */
  start: number
  /** End time in seconds. */
  end: number
  /** Speaker index (0‑based). */
  speaker: number
}

/** Minimal subset of the Emscripten module used here. */
export interface SherpaOnnxModule {
  _malloc: (size: number) => number
  _free: (ptr: number) => void

  HEAPF32: Float32Array & { [key: string]: any }
  HEAP32: Int32Array & { [key: string]: any }

  _SherpaOnnxCreateOfflineSpeakerDiarization: (configPtr: number) => number
  _SherpaOnnxDestroyOfflineSpeakerDiarization: (handle: number) => void

  _SherpaOnnxOfflineSpeakerDiarizationGetSampleRate: (handle: number) => number
  _SherpaOnnxOfflineSpeakerDiarizationSetConfig: (
    handle: number,
    configPtr: number,
  ) => void

  _SherpaOnnxOfflineSpeakerDiarizationProcess: (
    handle: number,
    samplesPtr: number,
    numSamples: number,
  ) => number

  _SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments: (resultPtr: number) => number

  _SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime: (
    resultPtr: number,
  ) => number

  _SherpaOnnxOfflineSpeakerDiarizationDestroySegment: (segmentsPtr: number) => void
  _SherpaOnnxOfflineSpeakerDiarizationDestroyResult: (resultPtr: number) => void
}

/**
 * High‑level wrapper around the sherpa‑onnx offline speaker diarization
 * functionality.
 */
export class OfflineSpeakerDiarization {
  /** Underlying native handle. */
  handle: number
  /** Expected sample rate of input audio (Hz). */
  sampleRate: number
  /** Original configuration object. */
  config: OfflineSpeakerDiarizationConfig
  /** Underlying Emscripten module instance. */
  Module: SherpaOnnxModule

  /**
   * Create a new offline speaker diarization instance.
   *
   * @param configObj High‑level configuration object.
   * @param Module Emscripten module exposing sherpa‑onnx C API.
   */
  constructor(configObj: OfflineSpeakerDiarizationConfig, Module: SherpaOnnxModule)

  /**
   * Free native resources associated with this instance.
   * After calling this, the instance should no longer be used.
   */
  free(): void

  /**
   * Update part of the configuration at runtime.
   * Currently only `clustering` is honored by the implementation.
   */
  setConfig(configObj: OfflineSpeakerDiarizationConfig): void

  /**
   * Run diarization on the given audio samples.
   *
   * @param samples PCM samples as a Float32Array at `sampleRate` Hz.
   * @returns Array of speaker segments.
   */
  process(samples: Float32Array): SpeakerSegment[]
}

/**
 * Convenience factory to create an `OfflineSpeakerDiarization` instance.
 *
 * If `myConfig` is omitted, default model paths and parameters are used.
 */
export function createOfflineSpeakerDiarization(
  Module: SherpaOnnxModule,
  myConfig?: OfflineSpeakerDiarizationConfig,
): OfflineSpeakerDiarization
