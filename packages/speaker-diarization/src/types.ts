import type { DataMetadata } from '@sherpaw/preloader'

/**
 * How to group speaker embeddings into speakers. `numSpeakers` fixes the count.
 * `distanceThreshold` is the cosine distance at which clusters stop merging; a
 * larger value gives fewer speakers. Calibrate it for your model and audio.
 */
export type Clustering
  = | { numSpeakers: number, distanceThreshold?: never }
    | { distanceThreshold: number, numSpeakers?: never }

export interface DiarizationModel {
  /** Paths in this module's virtual filesystem, populated by the preloader. */
  segmentation: string
  embedding: string
}

/** A downloaded Emscripten preload pack. The caller retains ownership of its bytes. */
export interface ModelPack {
  data: ArrayBuffer | Uint8Array
  metadata: DataMetadata
}

export interface DiarizationModelPacks {
  /** pyannote-segmentation-3.0 or a model with the same interface. */
  segmentation: ModelPack
  /** Any speaker embedding model that @sherpaw/speaker-identification supports. */
  embedding: ModelPack
  /** Defaults to speaker-segmentation.onnx and speaker-embedding.onnx. */
  paths?: DiarizationModel
}

export interface SegmentationOptions {
  /** Window shift as a fraction of the 10 s segmentation window, in (0, 1]. Default: 0.1. */
  windowShiftRatio?: number
  /** Discard segments that are not longer than this many seconds. Default: 0.2. */
  minDurationOn?: number
  /** Merge segments of one speaker across gaps that are not longer than this many seconds. Default: 0.5. */
  minDurationOff?: number
}

export interface SpeakerSegment {
  /** Seconds from the start of the recording. */
  start: number
  end: number
  /** Zero-based label in order of first appearance, local to one `diarize` call. */
  speaker: number
}

export interface DiarizerConfig extends SegmentationOptions {
  model: DiarizationModelPacks
  /** Default clustering; each `diarize` call may override it. */
  clustering: Clustering
  /** Aborting cancels initialization or disposes the initialized diarizer. */
  signal?: AbortSignal
}

/** All operations execute in call order on the diarizer's dedicated Worker. */
export interface Diarizer {
  /** Sample rate that `diarize` requires, reported by the segmentation model. */
  readonly sampleRate: number
  /** Processes one complete recording of mono PCM. Copies the samples without detaching the caller's buffer. */
  diarize: (samples: Float32Array, sampleRate: number, clustering?: Clustering) => Promise<SpeakerSegment[]>
  /** Terminates the Worker and rejects pending operations. Safe to repeat. */
  dispose: () => void
}
