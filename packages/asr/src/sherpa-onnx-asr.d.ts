// Type declarations for the JS implementation in `sherpa-onnx-asr.js`
// Generated from the implementation in the repository.

export interface FeatureConfig {
  sampleRate?: number
  featureDim?: number
}

export interface TransducerModelConfig {
  encoder?: string
  decoder?: string
  joiner?: string
}

export interface ParaformerModelConfig {
  encoder?: string
  decoder?: string
}

export interface SimpleModelConfig {
  model?: string
}

export interface OnlineModelConfig {
  transducer?: TransducerModelConfig
  paraformer?: ParaformerModelConfig
  zipformer2Ctc?: SimpleModelConfig
  nemoCtc?: SimpleModelConfig
  toneCtc?: SimpleModelConfig
  tokens?: string
  numThreads?: number
  provider?: string
  debug?: number
  modelType?: string
  modelingUnit?: string
  bpeVocab?: string
  tokensBuf?: string
  tokensBufSize?: number
}

export interface CtcFstDecoderConfig {
  graph?: string
  maxActive?: number
}

export interface HomophoneReplacerConfig {
  lexicon?: string
  ruleFsts?: string
}

export interface OnlineRecognizerConfig {
  featConfig?: FeatureConfig
  modelConfig?: OnlineModelConfig
  decodingMethod?: string
  maxActivePaths?: number
  enableEndpoint?: number
  rule1MinTrailingSilence?: number
  rule2MinTrailingSilence?: number
  rule3MinUtteranceLength?: number
  hotwordsFile?: string
  hotwordsScore?: number
  ctcFstDecoderConfig?: CtcFstDecoderConfig
  ruleFsts?: string
  ruleFars?: string
  hotwordsBuf?: string
  hotwordsBufSize?: number
  hr?: HomophoneReplacerConfig
}

export interface OfflineLMConfig {
  model?: string
  scale?: number
}

export interface OfflineModelConfig extends OnlineModelConfig {
  // offline-specific optional models
  whisper?: {
    encoder?: string
    decoder?: string
    language?: string
    task?: string
    tailPaddings?: number
  }
  // other optional offline-specific entries are represented by SimpleModelConfig above
}

export interface OfflineRecognizerConfig {
  featConfig?: FeatureConfig
  modelConfig?: OfflineModelConfig
  lmConfig?: OfflineLMConfig
  decodingMethod?: string
  maxActivePaths?: number
  hotwordsFile?: string
  hotwordsScore?: number
  ruleFsts?: string
  ruleFars?: string
  blankPenalty?: number
  hr?: HomophoneReplacerConfig
}

/** Represents a stream used by the offline recognizer. */
export class OfflineStream {
  handle: number | null
  Module: any
  constructor(handle: number, Module: any)
  free(): void
  /** Append audio samples (Float32Array, range [-1, 1]) */
  acceptWaveform(sampleRate: number, samples: Float32Array): void
}

/** Offline recognizer class. */
export class OfflineRecognizer {
  config: OfflineRecognizerConfig
  handle: number
  Module: any
  constructor(configObj: OfflineRecognizerConfig, Module: any)
  setConfig(configObj: OfflineRecognizerConfig): void
  free(): void
  createStream(): OfflineStream
  decode(stream: OfflineStream): void
  /** Returns the parsed JSON result for the given stream. */
  getResult(stream: OfflineStream): any
}

/** Represents a stream used by the online recognizer. */
export class OnlineStream {
  handle: number | null
  pointer: number | null
  n: number
  Module: any
  constructor(handle: number, Module: any)
  free(): void
  acceptWaveform(sampleRate: number, samples: Float32Array): void
  inputFinished(): void
}

/** Online recognizer class (not exported from the JS module directly, but used/returned). */
export class OnlineRecognizer {
  config: OnlineRecognizerConfig
  handle: number
  Module: any
  constructor(configObj: OnlineRecognizerConfig, Module: any)
  free(): void
  createStream(): OnlineStream
  isReady(stream: OnlineStream): boolean
  decode(stream: OnlineStream): void
  isEndpoint(stream: OnlineStream): boolean
  reset(stream: OnlineStream): void
  getResult(stream: OnlineStream): any
}

/**
 * Convenience factory. Creates an OnlineRecognizer using the provided Emscripten Module
 * and optional config. Returns an OnlineRecognizer instance.
 */
export function createOnlineRecognizer(Module: any, myConfig?: OnlineRecognizerConfig): OnlineRecognizer
