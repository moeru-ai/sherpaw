// Inferred types from JavaScript. Verify before use.

import type { WebAssemblyModule } from '@sherpaw/shared'

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

export interface OfflineParaformerModelConfig {
  model?: string
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
  blankPenalty?: number
  hotwordsBuf?: string
  hotwordsBufSize?: number
  hr?: HomophoneReplacerConfig
}

export interface OfflineLMConfig {
  model?: string
  scale?: number
}

export interface WhisperModelConfig {
  encoder?: string
  decoder?: string
  language?: string
  task?: string
  tailPaddings?: number
  enableTokenTimestamps?: number
  enableSegmentTimestamps?: number
}

export interface CanaryModelConfig {
  encoder?: string
  decoder?: string
  srcLang?: string
  tgtLang?: string
  usePnc?: number
}

export interface MoonshineModelConfig {
  preprocessor?: string
  encoder?: string
  uncachedDecoder?: string
  cachedDecoder?: string
  mergedDecoder?: string
}

export interface SenseVoiceModelConfig {
  model?: string
  language?: string
  useInverseTextNormalization?: number
}

export interface FireRedAsrModelConfig {
  encoder?: string
  decoder?: string
}

export interface DolphinModelConfig {
  model?: string
}

export interface ZipformerCtcModelConfig {
  model?: string
}

export interface WenetCtcModelConfig {
  model?: string
}

export interface OfflineOmnilingualAsrCtcModelConfig {
  model?: string
}

export interface OfflineMedAsrCtcModelConfig {
  model?: string
}

export interface OfflineFireRedAsrCtcModelConfig {
  model?: string
}

export interface OfflineFunAsrNanoModelConfig {
  encoderAdaptor?: string
  llm?: string
  embedding?: string
  tokenizer?: string
  systemPrompt?: string
  userPrompt?: string
  maxNewTokens?: number
  temperature?: number
  topP?: number
  seed?: number
  language?: string
  itn?: number
  hotwords?: string
}

export interface OfflineQwen3AsrModelConfig {
  convFrontend?: string
  encoder?: string
  decoder?: string
  tokenizer?: string
  maxTotalLen?: number
  maxNewTokens?: number
  temperature?: number
  topP?: number
  seed?: number
  hotwords?: string
}

export interface OfflineCohereTranscribeModelConfig {
  encoder?: string
  decoder?: string
  language?: string
  usePunct?: number
  useItn?: number
}

export interface TdnnModelConfig {
  model?: string
}

export interface OfflineModelConfig extends OnlineModelConfig {
  paraformer?: OfflineParaformerModelConfig
  // offline-specific optional models
  whisper?: WhisperModelConfig
  canary?: CanaryModelConfig
  moonshine?: MoonshineModelConfig
  senseVoice?: SenseVoiceModelConfig
  fireRedAsr?: FireRedAsrModelConfig
  dolphin?: DolphinModelConfig
  zipformerCtc?: ZipformerCtcModelConfig
  wenetCtc?: WenetCtcModelConfig
  omnilingual?: OfflineOmnilingualAsrCtcModelConfig
  medasr?: OfflineMedAsrCtcModelConfig
  fireRedAsrCtc?: OfflineFireRedAsrCtcModelConfig
  funasrNano?: OfflineFunAsrNanoModelConfig
  qwen3Asr?: OfflineQwen3AsrModelConfig
  cohereTranscribe?: OfflineCohereTranscribeModelConfig
  tdnn?: TdnnModelConfig
  teleSpeechCtc?: string
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
  setOption(key: string, value: string): void
  getOption(key: string): string
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
  setOption(key: string, value: string): void
  getOption(key: string): string
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

export interface InitResult {
  buffer?: number
  ptr: number
  len: number
  [key: string]: any
}

export type Config = OnlineModelConfig | OnlineRecognizerConfig | OfflineModelConfig | OfflineRecognizerConfig

export function freeConfig(config: Config, Module: any): void

export function initSherpaOnnxOnlineTransducerModelConfig(config: TransducerModelConfig, Module: any): InitResult
export function initSherpaOnnxOnlineParaformerModelConfig(config: ParaformerModelConfig, Module: any): InitResult
export function initSherpaOnnxOnlineZipformer2CtcModelConfig(config: SimpleModelConfig, Module: any): InitResult
export function initSherpaOnnxOnlineNemoCtcModelConfig(config: SimpleModelConfig, Module: any): InitResult
export function initSherpaOnnxOnlineToneCtcModelConfig(config: SimpleModelConfig, Module: any): InitResult
export function initSherpaOnnxOnlineModelConfig(config: OnlineModelConfig, Module: any): InitResult
export function initSherpaOnnxFeatureConfig(config: FeatureConfig, Module: any): InitResult
export function initSherpaOnnxHomophoneReplacerConfig(config: HomophoneReplacerConfig, Module: any): InitResult
export function initSherpaOnnxOnlineCtcFstDecoderConfig(config: CtcFstDecoderConfig, Module: any): InitResult
export function initSherpaOnnxOnlineRecognizerConfig(config: OnlineRecognizerConfig, Module: any): InitResult

export function initSherpaOnnxOfflineTransducerModelConfig(config: TransducerModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineParaformerModelConfig(config: OfflineParaformerModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineNemoEncDecCtcModelConfig(config: SimpleModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineDolphinModelConfig(config: SimpleModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineZipformerCtcModelConfig(config: SimpleModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineWenetCtcModelConfig(config: SimpleModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineOmnilingualAsrCtcModelConfig(config: OfflineOmnilingualAsrCtcModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineMedAsrCtcModelConfig(config: OfflineMedAsrCtcModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineFireRedAsrCtcModelConfig(config: OfflineFireRedAsrCtcModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineFunAsrNanoModelConfig(config: OfflineFunAsrNanoModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineQwen3AsrModelConfig(config: OfflineQwen3AsrModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineCohereTranscribeModelConfig(config: OfflineCohereTranscribeModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineWhisperModelConfig(config: WhisperModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineCanaryModelConfig(config: CanaryModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineMoonshineModelConfig(config: MoonshineModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineFireRedAsrModelConfig(config: FireRedAsrModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineTdnnModelConfig(config: TdnnModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineSenseVoiceModelConfig(config: SenseVoiceModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineLMConfig(config: OfflineLMConfig, Module: any): InitResult
export function initSherpaOnnxOfflineModelConfig(config: OfflineModelConfig, Module: any): InitResult
export function initSherpaOnnxOfflineRecognizerConfig(config: OfflineRecognizerConfig, Module: any): InitResult

export enum OnlineRecognizerType {
  Transducer = 0,
  Paraformer = 1,
  Zipformer2CTC = 2,
  NemoCTC = 3,
  ToneCTC = 4,
}

export function createOnlineRecognizer(Module: WebAssemblyModule, myConfig?: OnlineRecognizerConfig & { type: OnlineRecognizerType }): OnlineRecognizer
