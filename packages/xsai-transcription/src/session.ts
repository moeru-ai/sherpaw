import type { ASRModule, OnlineRecognizer, OnlineRecognizerConfig, OnlineRecognizerType, OnlineStream } from '@sherpaw/asr'

import { createContext } from '@moeru/eventa'
import { createOnlineRecognizer } from '@sherpaw/asr'

import type {
  FinishResult,
  PushAudioOptions,
  PushAudioResult,
  RuntimeTranscriptionEvent,
} from './stream-transcription/types'

import { streamTranscriptionEvent } from './events'

const DEFAULT_SAMPLE_RATE = 16000

function extractText(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return ''
  }

  const text = (result as Record<string, unknown>).text
  return typeof text === 'string' ? text : ''
}

export class StreamingTranscriptionSession {
  readonly eventContext = createContext()

  private recognizer: OnlineRecognizer
  private stream: OnlineStream
  private sampleRate: number

  private sentenceIndex = 1
  private currentText = ''
  private started = false

  constructor(module: ASRModule, options?: { recognizerConfig?: OnlineRecognizerConfig & { type?: OnlineRecognizerType }, sampleRate?: number }) {
    this.recognizer = createOnlineRecognizer(module, options?.recognizerConfig)
    this.stream = this.recognizer.createStream()
    this.sampleRate = options?.sampleRate ?? DEFAULT_SAMPLE_RATE
  }

  on<T extends RuntimeTranscriptionEvent['type']>(
    type: T,
    handler: (event: Extract<RuntimeTranscriptionEvent, { type: T }>) => void,
  ): () => void {
    return this.eventContext.on(streamTranscriptionEvent, ({ body }) => {
      if (body.type === type) {
        handler(body as Extract<RuntimeTranscriptionEvent, { type: T }>)
      }
    })
  }

  pushAudio(samples: Float32Array, options?: PushAudioOptions): PushAudioResult {
    const sampleRate = options?.sampleRate ?? this.sampleRate

    this.stream.acceptWaveform(sampleRate, samples)

    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream)
    }

    const result = this.recognizer.getResult(this.stream)
    const text = extractText(result)
    const isEndpoint = this.recognizer.isEndpoint(this.stream)

    this.emitProgress(text, result)

    if (isEndpoint) {
      this.recognizer.reset(this.stream)
      this.currentText = ''
      this.sentenceIndex++
    }

    return { text, isEndpoint }
  }

  finish(): FinishResult {
    this.stream.inputFinished()

    while (this.recognizer.isReady(this.stream)) {
      this.recognizer.decode(this.stream)
    }

    const result = this.recognizer.getResult(this.stream)
    const text = extractText(result)

    this.emitProgress(text, result)

    if (this.started) {
      this.eventContext.emit(streamTranscriptionEvent, { type: 'transcription.completed' })
    }

    const sentenceCount = text.length > 0 ? this.sentenceIndex : Math.max(0, this.sentenceIndex - 1)

    this.reset()

    return {
      text,
      sentenceCount,
    }
  }

  reset(): void {
    this.recognizer.reset(this.stream)
    this.currentText = ''
    this.sentenceIndex = 1
    this.started = false
  }

  dispose(): void {
    this.stream.free()
    this.recognizer.free()
    this.eventContext.off(streamTranscriptionEvent)
  }

  private emitProgress(text: string, _rawResult: unknown): void {
    if (!this.started) {
      this.started = true
      this.eventContext.emit(streamTranscriptionEvent, { type: 'transcription.started' })
    }

    if (text.length === 0 || text === this.currentText) {
      return
    }

    this.eventContext.emit(streamTranscriptionEvent, { type: 'transcription.partial', index: this.sentenceIndex, text })
    this.currentText = text
  }
}
