import type { WebAssemblyModule } from '@sherpaw/shared'

import type { OnlineRecognizer, OnlineRecognizerConfig, OnlineRecognizerType, OnlineStream } from './asr'
import type { TimedToken } from './tokens'

import { createOnlineRecognizer, OnlineRecognizerTypes } from './asr'

/** Optional execution backend. Ownership transfers to createStreamingRecognizer, including on initialization failure. */
export interface StreamingBackend {
  decode: (recognizer: OnlineRecognizer, stream: OnlineStream) => Promise<void>
  dispose: () => Promise<void>
}

export interface StreamingRecognizer {
  /** Mono PCM at the configured sample rate. Keep samples unchanged until this promise resolves. */
  accept: (samples: Float32Array) => Promise<string>
  finish: () => Promise<string>
  /**
   * The tokens of the text after the last `accept` or `finish`, in order. Empty for models without
   * timestamps, such as Paraformer.
   */
  tokens: () => readonly TimedToken[]
  /**
   * Samples taken so far at the configured sample rate, including the silence that `finish` adds.
   * Token times count from the first of them.
   */
  received: () => number
  dispose: () => Promise<void>
}

/** Tokens of one result with times from the first accepted sample. Results without timestamps give none. */
function timedTokens(result: { tokens?: string[], timestamps?: number[], start_time?: number }): TimedToken[] {
  const { tokens = [], timestamps = [], start_time: start = 0 } = result
  return timestamps.length === tokens.length ? tokens.map((text, i) => ({ text, time: start + timestamps[i]! })) : []
}

/**
 * One recording, using the existing Sherpa recognizer/stream bindings.
 * Calls are serialized so asynchronous inference cannot overlap finish or disposal.
 * The caller owns the module and model files; use a dedicated module for WebGPU.
 */
export async function createStreamingRecognizer(
  module: WebAssemblyModule,
  config?: OnlineRecognizerConfig & { type?: OnlineRecognizerType },
  backend?: StreamingBackend,
): Promise<StreamingRecognizer> {
  let recognizer: OnlineRecognizer | undefined
  let stream: OnlineStream
  try {
    recognizer = createOnlineRecognizer(module, config)
    stream = recognizer.createStream()
    if (!stream.handle)
      throw new Error('Failed to create the online stream')
  }
  catch (error) {
    recognizer?.free()
    await backend?.dispose()
    throw error
  }
  const native = recognizer
  const sampleRate = native.config.featConfig?.sampleRate ?? 16000
  const completed: string[] = []
  const completedTokens: TimedToken[] = []
  let partialTokens: TimedToken[] = []
  let received = 0
  let text = ''
  let finished = false
  let failure: unknown
  let pending = Promise.resolve()
  let disposal: Promise<void> | undefined

  function enqueue(action: () => Promise<string>) {
    if (disposal)
      return Promise.reject(new Error('Recognizer is disposed'))
    const result = pending.then(() => {
      if (failure)
        throw failure
      return action()
    })
    pending = result.then(() => {}, (error) => {
      failure = error
    })
    return result
  }

  async function drain() {
    while (native.isReady(stream)) {
      if (backend)
        await backend.decode(native, stream)
      else
        native.decode(stream)
    }
    const result = native.getResult(stream)
    const partial = result.text as string
    partialTokens = timedTokens(result)
    text = [...completed, partial].filter(Boolean).join(' ')
    if (!finished && native.isEndpoint(stream)) {
      if (partial) {
        completed.push(partial)
        completedTokens.push(...partialTokens)
      }
      partialTokens = []
      native.reset(stream)
    }
    return text
  }

  return {
    /** Triggering workflow: audio input -> OnlineStream.acceptWaveform -> decode and endpoint accumulation. */
    accept: samples => enqueue(async () => {
      if (finished)
        throw new Error('Input is already finished')
      stream.acceptWaveform(sampleRate, samples)
      received += samples.length
      return drain()
    }),
    /** Triggering workflow: recording Stop -> family-specific final context -> final transcript. */
    finish: () => enqueue(async () => {
      if (finished)
        return text
      finished = true
      if (config?.type === OnlineRecognizerTypes.Paraformer) {
        stream.setOption('is_final', '1')
      }
      else {
        stream.acceptWaveform(sampleRate, new Float32Array(sampleRate))
        received += sampleRate
      }
      stream.inputFinished()
      return drain()
    }),
    tokens: () => [...completedTokens, ...partialTokens],
    received: () => received,
    /** Triggering workflow: recording release -> pending inference completes -> native and backend cleanup. */
    dispose() {
      disposal ??= pending.then(async () => {
        try {
          stream.free()
          native.free()
        }
        finally {
          await backend?.dispose()
        }
      })
      return disposal
    },
  }
}
