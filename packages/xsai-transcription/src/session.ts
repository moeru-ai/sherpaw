import type { ASRModule, OnlineRecognizer, OnlineRecognizerConfig, OnlineRecognizerType, OnlineStream } from '@sherpaw/asr'

import { createContext } from '@moeru/eventa'
import { createOnlineRecognizer } from '@sherpaw/asr'

import type {
  FinishResult,
  PushAudioOptions,
  PushAudioResult,
  TranscriptionEvent,
  WordBoundary,
} from './stream-transcription/types'

import { streamTranscriptionEvent } from './events'
import { extractText, extractWordsAndTime } from './stream-transcription/result'

const DEFAULT_SAMPLE_RATE = 16000

export class StreamingTranscriptionSession {
  readonly eventContext = createContext()

  private recognizer: OnlineRecognizer
  private stream: OnlineStream
  private sampleRate: number

  private sentenceIndex = 1
  private currentText = ''
  private started = false
  private sentenceStarted = false
  private lastWordCount = 0

  constructor(module: ASRModule, options?: { recognizerConfig?: OnlineRecognizerConfig & { type?: OnlineRecognizerType }, sampleRate?: number }) {
    // TODO(@nekomeowww): ok so the type: 0 handling in packages/asr/src/asr.js
    // and the pass of second parameter of createOnlineRecognizer will result in undefined
    // property in required parameters of modelConfig and many other properties...
    //
    // we need to handle and replace the switch (0) in asr.js with proper implementation.

    // const recognizerConfig = {
    //   type: OnlineRecognizerType.Transducer,
    //   ...options?.recognizerConfig,
    // } satisfies OnlineRecognizerConfig & { type: OnlineRecognizerType }

    // this.recognizer = createOnlineRecognizer(module, recognizerConfig)
    this.recognizer = createOnlineRecognizer(module)
    this.stream = this.recognizer.createStream()
    this.sampleRate = options?.sampleRate ?? DEFAULT_SAMPLE_RATE
  }

  on<T extends TranscriptionEvent['type']>(
    type: T,
    handler: (event: Extract<TranscriptionEvent, { type: T }>) => void,
  ): () => void {
    return this.eventContext.on(streamTranscriptionEvent, ({ body }) => {
      if (body.type === type) {
        handler(body as Extract<TranscriptionEvent, { type: T }>)
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
      this.emitSentenceEnd(text, result)
      this.recognizer.reset(this.stream)
      this.currentText = ''
      this.sentenceStarted = false
      this.lastWordCount = 0
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

    if (text.length > 0) {
      this.emitSentenceEnd(text, result)
    }

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
    this.sentenceStarted = false
    this.lastWordCount = 0
    this.sentenceIndex = 1
    this.started = false
  }

  dispose(): void {
    this.stream.free()
    this.recognizer.free()
    this.eventContext.off(streamTranscriptionEvent)
  }

  private emitProgress(text: string, rawResult: unknown): void {
    if (!this.started) {
      this.started = true
      this.eventContext.emit(streamTranscriptionEvent, { type: 'transcription.started' })
    }

    if (text.length > 0 && !this.sentenceStarted) {
      this.sentenceStarted = true
      const { timeMs } = extractWordsAndTime(rawResult, text)
      this.eventContext.emit(streamTranscriptionEvent, { type: 'sentence.begin', index: this.sentenceIndex, timeMs })
    }

    if (text.length === 0 || text === this.currentText) {
      return
    }

    const { words, timeMs } = extractWordsAndTime(rawResult, text)
    this.eventContext.emit(streamTranscriptionEvent, { type: 'transcription.partial', index: this.sentenceIndex, text, timeMs, words })
    this.emitWordDelta(words)
    this.currentText = text
  }

  private emitWordDelta(words?: WordBoundary[]): void {
    if (!words || words.length === 0) {
      return
    }

    const nextWordCount = words.length
    if (nextWordCount <= this.lastWordCount) {
      return
    }

    for (let i = this.lastWordCount; i < nextWordCount; i++) {
      this.eventContext.emit(streamTranscriptionEvent, {
        type: 'word',
        index: this.sentenceIndex,
        word: words[i]!,
      })
    }

    this.lastWordCount = nextWordCount
  }

  private emitSentenceEnd(text: string, rawResult: unknown): void {
    if (!this.sentenceStarted || text.length === 0) {
      return
    }

    const { words, timeMs } = extractWordsAndTime(rawResult, text)
    this.eventContext.emit(streamTranscriptionEvent, {
      type: 'sentence.end',
      index: this.sentenceIndex,
      text,
      timeMs,
      words,
    })
  }
}
