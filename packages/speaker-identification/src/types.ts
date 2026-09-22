import type { WebAssemblyModule } from '@sherpaw/shared'

/** WASM32 exports from sherpa-onnx/speaker-embedding/CMakeLists.txt. */
export interface SpeakerIdentificationModule extends WebAssemblyModule {
  _SherpaOnnxCreateSpeakerEmbeddingExtractor: (config: number) => number
  _SherpaOnnxDestroySpeakerEmbeddingExtractor: (extractor: number) => void
  _SherpaOnnxSpeakerEmbeddingExtractorDim: (extractor: number) => number
  _SherpaOnnxSpeakerEmbeddingExtractorCreateStream: (extractor: number) => number
  _SherpaOnnxSpeakerEmbeddingExtractorIsReady: (extractor: number, stream: number) => number
  _SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding: (extractor: number, stream: number) => number
  _SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding: (embedding: number) => void
  _SherpaOnnxCreateSpeakerEmbeddingManager: (dim: number) => number
  _SherpaOnnxDestroySpeakerEmbeddingManager: (manager: number) => void
  _SherpaOnnxSpeakerEmbeddingManagerAddListFlattened: (manager: number, name: number, vectors: number, count: number) => number
  _SherpaOnnxSpeakerEmbeddingManagerRemove: (manager: number, name: number) => number
  _SherpaOnnxSpeakerEmbeddingManagerContains: (manager: number, name: number) => number
  _SherpaOnnxSpeakerEmbeddingManagerGetAllSpeakers: (manager: number) => number
  _SherpaOnnxSpeakerEmbeddingManagerFreeAllSpeakers: (names: number) => void
  _SherpaOnnxSpeakerEmbeddingManagerGetBestMatches: (manager: number, vector: number, threshold: number, count: number) => number
  _SherpaOnnxSpeakerEmbeddingManagerFreeBestMatches: (result: number) => void
  _SherpaOnnxSpeakerEmbeddingManagerVerify: (manager: number, name: number, vector: number, threshold: number) => number
}

export interface ExtractorConfig {
  /** Path in the module's virtual filesystem. Load the model before creating an extractor. */
  model: string
  debug?: boolean
  /** Reject shorter clips before inference. This is a duration gate, not a VAD. Default: 1 second. */
  minDurationSeconds?: number
}

export interface SpeakerMatch {
  name: string
  /** Cosine similarity, not a probability. */
  score: number
}

export interface Extractor {
  readonly dimension: number
  /** Single-speaker, mono PCM in [-1, 1]. Call from a Worker to avoid blocking the UI. */
  extract: (samples: Float32Array, sampleRate: number) => Float32Array
  /** Idempotent. Extract throws after disposal. Returned embeddings remain usable. */
  dispose: () => void
}

export interface InMemoryDBConfig {
  /** Dimensions of this model's embeddings. Equal dimensions do not imply model compatibility. */
  dimension: number
}

export interface InMemoryDB {
  readonly dimension: number
  readonly speakers: string[]
  /** Register one or more embeddings from this model. Duplicate names return false. */
  enroll: (name: string, embeddings: readonly Float32Array[]) => boolean
  /** Returns null when every score is below the caller's calibrated threshold. */
  identify: (embedding: Float32Array, threshold: number) => SpeakerMatch | null
  matches: (embedding: Float32Array, threshold: number, count: number) => SpeakerMatch[]
  verify: (name: string, embedding: Float32Array, threshold: number) => boolean
  contains: (name: string) => boolean
  remove: (name: string) => boolean
  /** Idempotent. Database operations throw after disposal. Extractors remain usable. */
  dispose: () => void
}
