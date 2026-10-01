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

export interface SpeakerTrackerConfig {
  /** Speaker embedding model pack: the same pack as `DiarizationModelPacks.embedding`. */
  model: ModelPack
  /** Path of the model in the pack. Default: speaker-embedding.onnx. */
  path?: string
  /** Re-cluster at most this many recent embeddings after each utterance, to bound the cost. Default: 300. */
  historyLimit?: number
  /** Aborting cancels initialization or disposes the initialized tracker. */
  signal?: AbortSignal
}

/** `high`: estimated probability at least 0.9; `medium`: at least 0.7; `low`: below. */
export type SpeakerConfidence = 'high' | 'medium' | 'low'

export interface SpeakerRevision {
  /** `index` of an earlier utterance. */
  index: number
  speaker: number | null
}

export interface SpeakerTurn {
  /** Zero-based position of the utterance in the session. */
  index: number
  /** Speaker number in order of first appearance, or null before any speaker is known. */
  speaker: number | null
  /** Estimated probability that `speaker` is right, from a model fitted on meeting audio (AMI). Recalibrate it for other audio. */
  score: number
  confidence: SpeakerConfidence
  /** The speaker has less than 4 s of speech so far. Its number may never appear again. */
  pending: boolean
  /** Another speaker holds at least 20% of the utterance. */
  mixed: boolean
  /** Earlier utterances whose speaker changed after re-clustering. */
  revisions: SpeakerRevision[]
}

/** A read-only guess for an utterance that is still in progress. */
export interface SpeakerGuess {
  /** The nearest established speaker that `track` has already reported, or null when none is close. */
  speaker: number | null
  /** Estimated probability that `speaker` is right. Rougher than for `track`: the model was fitted on whole utterances. */
  score: number
  confidence: SpeakerConfidence
  /**
   * Seconds from the start of the samples where the speaker seems to change: set when the samples
   * last at least 3 s and their last 1.5 s sound unlike the 1.5 s before. The guess then covers only
   * the last 1.5 s.
   */
  change?: number
}

/** All operations execute in call order on the tracker's dedicated Worker. */
export interface SpeakerTracker {
  /** Labels one utterance of mono PCM, for example a VAD segment. Call in time order. Copies the samples. */
  track: (samples: Float32Array, sampleRate: number) => Promise<SpeakerTurn>
  /**
   * Guesses who is speaking from part of an unfinished utterance, for example its last few seconds.
   * Changes nothing: a speaker with less than 4 s of tracked speech cannot be recognized yet. Copies the samples.
   */
  peek: (samples: Float32Array, sampleRate: number) => Promise<SpeakerGuess>
  /** Forgets every speaker and starts a new session. */
  reset: () => Promise<void>
  /** Terminates the Worker and rejects pending operations. Safe to repeat. */
  dispose: () => void
}
