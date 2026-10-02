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
  /**
   * pyannote segmentation-3.0 as a plain ONNX file, for example the sherpa-onnx
   * `speaker-segmentation.onnx`. For 16 kHz audio, `peek` then finds speaker changes frame by frame,
   * including short interjections, and `track` flags overlapping speech. Requires the optional peer
   * dependency `onnxruntime-web`.
   */
  segmentation?: SegmentationModel
  /** Parameters to change. The others keep their values from `defaultSpeakerTrackerTuning`. Unknown names throw. */
  tuning?: Partial<SpeakerTrackerTuning>
  /** Aborting cancels initialization or disposes the initialized tracker. */
  signal?: AbortSignal
}

/**
 * Parameters of the streaming speaker tracker. Each cosine compares two speaker embeddings. The
 * defaults come from tuning with CAM++. With ERes2NetV2 on Chinese phone conversations, a
 * `clusterThreshold` of 0.5 labeled 2 percentage points more speech correctly than 0.4.
 */
export interface SpeakerTrackerTuning {
  /** While there are fewer than 40 embeddings, average-linkage clustering stops merging below this cosine. Default: 0.4. */
  clusterThreshold: number
  /** The tracker merges clusters whose centroids reach this cosine. Default: 0.8. */
  mergeThreshold: number
  /** A cluster keeps a speaker number when its centroid reaches this cosine to that speaker's centroid. Default: 0.6. */
  matchThreshold: number
  /**
   * A cluster takes an enrolled speaker's number when its centroid reaches this cosine to the
   * enrolled embedding. Default: 0.4. On meeting and conversation audio, 0.4 recognized the enrolled
   * speaker in 78%-93% of their utterances, against 72%-83% at 0.6.
   */
  enrollThreshold: number
  /** A speaker with less speech is pending. Default: 4 seconds. */
  establishedSeconds: number
  /**
   * A pending cluster this close to an established speaker shows that speaker instead of a new
   * number. It never shows an enrolled speaker. Default: 0.3. On AMI utterances cut at speaker
   * changes, this value reduced the extra speaker numbers per recording from 4.6 to 2.7. On
   * AliMeeting, it reduced them from 3.8 to 0.9.
   */
  borrowThreshold: number
  /** Utterances shorter than 1 second and `peek` guesses take the nearest speaker at this cosine. Default: 0.3. */
  nearestThreshold: number
  /**
   * Two 1.5-second windows below this cosine are different speakers (`windowChange`). Default: 0.3.
   * On two-speaker AliMeeting sessions, this value found 95% of changes with 87% precision.
   */
  changeThreshold: number
  /** At most this many speakers in one clustering run. Default: 15. */
  maxSpeakers: number
  /** Segmentation: a local speaker must talk alone this long for a change. Default: 0.3 seconds. */
  segmentationRunSeconds: number
  /** Segmentation: without `final`, changes in the last seconds wait for a later `peek`. Default: 0.5 seconds. */
  segmentationMarginSeconds: number
  /** Segmentation: `overlap` needs this long of two people talking at once. Default: 0.5 seconds. */
  overlapSeconds: number
}

export interface SpeakerTrackerResetOptions {
  /** Also forget enrolled speakers. Default: false. The new session numbers enrolled speakers 0, 1, ... in enrollment order. */
  forgetEnrolled?: boolean
}

export interface SegmentationModel {
  data: ArrayBuffer | Uint8Array
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
  /** The speaker has less speech than `establishedSeconds` (4 s by default) so far. Its number may never appear again. */
  pending: boolean
  /** Another speaker holds at least 20% of the utterance. */
  mixed: boolean
  /** Two people talk at once for at least `overlapSeconds` (0.5 s by default). Needs `segmentation`. Without it, always false. */
  overlap: boolean
  /** Earlier utterances whose speaker changed after re-clustering. */
  revisions: SpeakerRevision[]
}

/** A read-only guess for an utterance that is still in progress. */
export interface SpeakerGuess {
  /**
   * The nearest established speaker to the audio after the last change (at most its last 3 s), or
   * null when none is close. The guess includes only speakers that `track` reported before.
   */
  speaker: number | null
  /** Estimated probability that `speaker` is right. Rougher than for `track`: the model was fitted on whole utterances. */
  score: number
  confidence: SpeakerConfidence
  /**
   * Speaker changes that the segmentation model finds frame by frame, in seconds from the start of
   * the samples, in order. Each change is at least 0.3 s from the start. Without `final`, each change
   * is also at least `segmentationMarginSeconds` (0.5 s by default) before the end. Empty without
   * `segmentation` or at sample rates other than 16 kHz. Near the end of the samples, the changes vary
   * from call to call. So cut only when two consecutive calls report a change.
   */
  changes: number[]
  /**
   * The start of the last 1.5 s, in seconds from the start of the samples, when that audio sounds
   * unlike the 1.5 s before it. It needs at least 3 s of samples. It finds changes between turns of
   * at least 1.5 s, also where the segmentation model misses them.
   */
  windowChange?: number
}

/** The embeddings that the tracker clusters and compares, for visualization and debugging. */
export interface SpeakerMap {
  /**
   * The units of the recent utterances that the last clustering run used, at most `historyLimit`. A
   * unit is one embedding per consistent utterance, or per run of similar 1.5 s windows. Utterances
   * shorter than 1 s have no unit.
   */
  units: SpeakerMapUnit[]
  /** Each numbered speaker's reference: the centroid of their units, or the enrolled embedding. */
  speakers: SpeakerMapSpeaker[]
}

export interface SpeakerMapUnit {
  /** The utterance (`SpeakerTurn.index`) that the unit belongs to. */
  index: number
  seconds: number
  /** The speaker of the unit's cluster in the last clustering run, or null for a cluster without a number. */
  speaker: number | null
  /** Unit-length speaker embedding: the cosine of two embeddings is their dot product. */
  embedding: Float32Array
}

export interface SpeakerMapSpeaker {
  speaker: number
  /** The reference is the enrolled embedding, which never moves. */
  enrolled: boolean
  /** Unit-length speaker embedding. Clusters take this speaker's number at a cosine of at least `matchThreshold` (`enrollThreshold` when enrolled). */
  embedding: Float32Array
}

export interface SimilarityOptions {
  /** Length of the compared windows. Shorter windows place a voice more precisely but compare less reliably. Default: 1 second. */
  windowSeconds?: number
  /** Time between the starts of two windows. Default: 0.25 seconds. */
  stepSeconds?: number
}

export interface PeekOptions {
  /** The samples end the utterance: changes up to 0.3 s before the end count. Needs `segmentation`. */
  final?: boolean
}

/** All operations execute in call order on the tracker's dedicated Worker. */
export interface SpeakerTracker {
  /** The tracker runs the segmentation model: `peek` finds speaker changes frame by frame in 16 kHz audio. */
  readonly segmentation: boolean
  /** Labels one utterance of mono PCM, for example a VAD segment. Call in time order. Copies the samples. */
  track: (samples: Float32Array, sampleRate: number) => Promise<SpeakerTurn>
  /**
   * Guesses who speaks in an unfinished utterance and finds speaker changes in it. Pass the audio
   * since the last change. With `segmentation`, the tracker segments up to the last 10 s of it;
   * otherwise it compares only the last 3 s. Changes nothing. The tracker cannot recognize a speaker
   * with less than `establishedSeconds` of tracked speech yet. Copies the samples.
   */
  peek: (samples: Float32Array, sampleRate: number, options?: PeekOptions) => Promise<SpeakerGuess>
  /**
   * Adds a known speaker from at least 5 seconds of their speech, for example the owner of a
   * device, and resolves to their speaker number. Utterances that sound like the enrolled
   * embedding get this number from the start, before the speaker has `establishedSeconds` of tracked speech.
   * Enroll before tracking: a speaker who is already tracked keeps their tracked number until the
   * next `reset`. Pass speech only. Long silence weakens the embedding. Copies the samples.
   */
  enroll: (samples: Float32Array, sampleRate: number) => Promise<number>
  /** Copies of the embeddings that the tracker clusters and compares, for example to plot them. Changes nothing. */
  inspect: () => Promise<SpeakerMap>
  /**
   * The probability that anyone speaks, per frame of the segmentation model, for at most 10 s of
   * 16 kHz audio. The center of frame `i` is sample `i * 270 + 495`, and frames are 16.875 ms apart.
   * Needs `segmentation`. `createSpeechDetector` turns these into utterances. Changes nothing. Copies
   * the samples.
   */
  speech: (samples: Float32Array, sampleRate: number) => Promise<Float32Array>
  /**
   * The cosine between a speaker's voice and each window of the samples, for example to find the
   * frames of an enrolled owner. Value `i` covers seconds `i * stepSeconds` to `i * stepSeconds +
   * windowSeconds`. It is NaN for a window without an embedding, such as digital silence. Rejects a
   * speaker without a voice yet. Changes nothing. Copies the samples.
   */
  similarity: (samples: Float32Array, sampleRate: number, speaker: number, options?: SimilarityOptions) => Promise<Float32Array>
  /** Forgets tracked speakers and starts a new session. Enrolled speakers stay, numbered 0, 1, ... in enrollment order, unless `forgetEnrolled`. */
  reset: (options?: SpeakerTrackerResetOptions) => Promise<void>
  /** Terminates the Worker and rejects pending operations. Safe to repeat. */
  dispose: () => void
}
