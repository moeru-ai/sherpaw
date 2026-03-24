import type { ASRModule, OnlineRecognizerConfig, OnlineRecognizerType } from '@sherpaw/asr'
import type { DataMetadata } from '@sherpaw/preloader'

import type { FinishResult, Request, TranscriptionEvent } from './stream-transcription/types'

export interface RemoteUrlSource {
  kind: 'remote-url'
  init?: RequestInit
  url: string | URL
}

export type BinarySource = ArrayBuffer | Blob | File | RemoteUrlSource | Uint8Array
export type MetadataSource = BinarySource | DataMetadata | string

export interface LoadSources {
  metadata: MetadataSource
  data: BinarySource
}

export interface InitTranscriptionOptions extends LoadSources {
  module?: ASRModule
  recognizerConfig?: OnlineRecognizerConfig & { type?: OnlineRecognizerType }
  sampleRate?: number
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface SherpawSpeechModel extends LoadSources {
  module?: ASRModule
  recognizerConfig?: OnlineRecognizerConfig & { type?: OnlineRecognizerType }
  sampleRate?: number
}

export interface SherpawProviderOptions {
  baseURL?: string
  fetch?: FetchLike
  worker?: Worker
  workerURL?: string | URL
}

export interface ResolvedSherpawSpeechModel {
  data: ArrayBuffer
  metadata: DataMetadata
  module?: ASRModule
  recognizerConfig?: OnlineRecognizerConfig & { type?: OnlineRecognizerType }
  sampleRate?: number
}

export interface SherpawSpeechTransport extends Request<TranscriptionEvent, FinishResult> {
  baseURL?: string
  fetch?: FetchLike
  loadSpeech: () => Promise<void>
  terminateSpeech: () => void
}

export type TransportResponse<TEvent extends { type: string } = TranscriptionEvent>
  = | {
    ok: true
    payload?: unknown
    events?: TEvent[]
  }
  | {
    ok: false
    error: string
  }
