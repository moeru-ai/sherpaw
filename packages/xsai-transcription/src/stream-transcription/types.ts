export interface WordBoundary {
  text: string
  startMs?: number
  endMs?: number
  estimated?: boolean
}

export interface TranscriptionStartedEvent {
  type: 'transcription.started'
}

export interface SentenceBeginEvent {
  type: 'sentence.begin'
  index: number
  timeMs?: number
}

export interface PartialEvent {
  type: 'transcription.partial'
  index: number
  text: string
  timeMs?: number
  words?: WordBoundary[]
}

export interface WordEvent {
  type: 'word'
  index: number
  word: WordBoundary
}

export interface SentenceEndEvent {
  type: 'sentence.end'
  index: number
  text: string
  timeMs?: number
  words?: WordBoundary[]
}

export interface CompletedEvent {
  type: 'transcription.completed'
}

export type TranscriptionEvent
  = | CompletedEvent
    | PartialEvent
    | SentenceBeginEvent
    | SentenceEndEvent
    | TranscriptionStartedEvent
    | WordEvent

export interface PushAudioOptions {
  sampleRate?: number
}

export interface PushAudioResult {
  text: string
  isEndpoint: boolean
}

export interface FinishResult {
  text: string
  sentenceCount: number
}

export interface WordExtractionResult {
  words?: WordBoundary[]
  timeMs?: number
}

export interface PushAudioInvokeRequest {
  samples: number[]
  sampleRate?: number
}

export interface Request<E extends { type: string } = TranscriptionEvent, TFinish = FinishResult> {
  inputSampleRate?: number
  events?: ReadableStream<E>
  load: () => Promise<void>
  push: (payload: PushAudioInvokeRequest) => Promise<unknown>
  finish: () => Promise<TFinish>
  reset?: () => Promise<void>
  dispose: () => Promise<void>
}

export type EventByType<TEvent extends { type: string }, TType extends string> = Extract<TEvent, { type: TType }>

export interface TranscriptionResult<
  TEvent extends { type: string } = TranscriptionEvent,
  TFinish = FinishResult,
> {
  input: WritableStream<Float32Array>
  done: Promise<TFinish>
  dispose: () => Promise<void>
  streams: {
    full: ReadableStream<TEvent>
    partials: ReadableStream<EventByType<TEvent, 'transcription.partial'>>
    words: ReadableStream<EventByType<TEvent, 'word'>>
    sentences: ReadableStream<EventByType<TEvent, 'sentence.end'>>
  }
}
