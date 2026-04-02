import type { WebAssemblyModule } from '@sherpaw/shared'

import { createContext } from '@moeru/eventa'

import type { CreateVadAsrOptions, RecognitionSegment, VadAsr, VadAsrEventMap } from './types'

import { OfflineRecognizer } from './asr'
import { vadAsrClosedEvent, vadAsrErrorEvent, vadAsrEvents, vadAsrSegmentEvent } from './events'
import { getDefaultModule } from './module'
import { createModelMountResolver, resolveAllModels, unlinkMountedFiles } from './resolve'
import { CircularBuffer, createVad } from './vad'

let sessionCounter = 0

function nextSessionId(): string {
  sessionCounter += 1
  return `vadasr${Date.now().toString(36)}${sessionCounter.toString(36)}`
}

interface SessionContext {
  module: WebAssemblyModule
  recognizer: OfflineRecognizer
  vad: ReturnType<typeof createVad>
  circularBuffer: CircularBuffer
  sampleRate: number
  windowSize: number
  mountedFiles: string[]
}

function createSession(context: SessionContext): VadAsr {
  const {
    module,
    recognizer,
    vad,
    circularBuffer,
    sampleRate,
    windowSize,
    mountedFiles,
  } = context

  const eventContext = createContext()

  const drainedQueue: RecognitionSegment[] = []
  const iteratorQueue: RecognitionSegment[] = []
  const iteratorWaiters: Array<(value: IteratorResult<RecognitionSegment>) => void> = []

  let closed = false
  let _writable: WritableStream<Float32Array> | null = null
  let _readable: ReadableStream<RecognitionSegment> | null = null
  let _readableController: ReadableStreamDefaultController<RecognitionSegment> | null = null

  function ensureOpen(): void {
    if (closed) {
      throw new Error('VadAsrSession is closed')
    }
  }

  function ensureSampleRate(inputSampleRate?: number): void {
    if (inputSampleRate != null && inputSampleRate !== sampleRate) {
      throw new Error(`Unsupported sample rate ${inputSampleRate}. Expected ${sampleRate}.`)
    }
  }

  function emitSegment(segment: RecognitionSegment): void {
    drainedQueue.push(segment)

    if (iteratorWaiters.length > 0) {
      const waiter = iteratorWaiters.shift()
      waiter?.({ done: false, value: segment })
    }
    else {
      iteratorQueue.push(segment)
    }

    eventContext.emit(vadAsrSegmentEvent, segment)
    _readableController?.enqueue(segment)
  }

  function emitError(error: unknown): void {
    eventContext.emit(vadAsrErrorEvent, error)
  }

  function decodeDetectedSegments(): void {
    while (!vad.isEmpty()) {
      const segment = vad.front()
      vad.pop()

      const stream = recognizer.createStream()
      try {
        stream.acceptWaveform(sampleRate, segment.samples)
        recognizer.decode(stream)
        const result = recognizer.getResult(stream)
        const text = String(result?.text ?? '').trim()

        if (text.length > 0) {
          const start = segment.start
          const end = segment.start + segment.samples.length
          emitSegment({
            text,
            start,
            end,
            startSec: start / sampleRate,
            endSec: end / sampleRate,
            durationSec: segment.samples.length / sampleRate,
            sampleRate,
            samples: segment.samples,
            result,
          })
        }
      }
      catch (error) {
        emitError(error)
        throw error
      }
      finally {
        stream.free()
      }
    }
  }

  function consumeBufferWindows(): void {
    while (circularBuffer.size() > windowSize) {
      const chunk = circularBuffer.get(circularBuffer.head(), windowSize)
      vad.acceptWaveform(chunk)
      circularBuffer.pop(windowSize)
      decodeDetectedSegments()
    }
  }

  function push(samples: Float32Array, inputSampleRate?: number): void {
    ensureOpen()
    ensureSampleRate(inputSampleRate)
    circularBuffer.push(samples)
    consumeBufferWindows()
  }

  function flush(): void {
    ensureOpen()
    vad.flush()
    decodeDetectedSegments()
  }

  function drain(): RecognitionSegment[] {
    const items = [...drainedQueue]
    drainedQueue.length = 0
    return items
  }

  async function transcribe(samples: Float32Array, inputSampleRate?: number): Promise<RecognitionSegment[]> {
    ensureOpen()
    const baseLength = drainedQueue.length
    push(samples, inputSampleRate)
    flush()
    return drainedQueue.slice(baseLength)
  }

  function close(): void {
    if (closed) {
      return
    }

    try {
      flush()
    }
    catch (error) {
      emitError(error)
    }

    closed = true

    try {
      circularBuffer.free()
    }
    catch {}
    try {
      vad.free()
    }
    catch {}
    try {
      recognizer.free()
    }
    catch {}

    unlinkMountedFiles(module, mountedFiles)

    eventContext.emit(vadAsrClosedEvent, undefined as never)

    while (iteratorWaiters.length > 0) {
      const waiter = iteratorWaiters.shift()
      waiter?.({ done: true, value: undefined as never })
    }

    try {
      _readableController?.close()
    }
    catch {}
  }

  function on<K extends keyof VadAsrEventMap>(
    event: K,
    handler: (data: VadAsrEventMap[K]) => void,
  ): () => void {
    return eventContext.on(vadAsrEvents[event], ({ body }) => {
      handler(body as VadAsrEventMap[K])
    })
  }

  function createAsyncIterator(): AsyncIterator<RecognitionSegment> {
    return {
      next: (): Promise<IteratorResult<RecognitionSegment>> => {
        if (iteratorQueue.length > 0) {
          const value = iteratorQueue.shift() as RecognitionSegment
          return Promise.resolve({ done: false, value })
        }

        if (closed) {
          return Promise.resolve({ done: true, value: undefined as never })
        }

        return new Promise((resolve) => {
          iteratorWaiters.push(resolve)
        })
      },
    }
  }

  return {
    push,
    flush,
    drain,
    transcribe,
    close,
    on,
    [Symbol.asyncIterator]: createAsyncIterator,

    get writable(): WritableStream<Float32Array> {
      if (!_writable) {
        _writable = new WritableStream<Float32Array>({
          write: (chunk) => { push(chunk) },
          close: () => { close() },
          abort: () => { close() },
        })
      }
      return _writable
    },

    get readable(): ReadableStream<RecognitionSegment> {
      if (!_readable) {
        _readable = new ReadableStream<RecognitionSegment>({
          start: (controller) => { _readableController = controller },
          cancel: () => { close() },
        })
      }
      return _readable
    },
  }
}

export async function createVadAsr(options: CreateVadAsrOptions): Promise<VadAsr> {
  const module = options.module ?? await getDefaultModule()
  const sessionId = nextSessionId()

  const sampleRate = options.runtime?.sampleRate ?? 16000
  const bufferSizeInSeconds = options.runtime?.bufferSizeInSeconds ?? 30
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`Invalid sampleRate: ${sampleRate}`)
  }
  if (!Number.isFinite(bufferSizeInSeconds) || bufferSizeInSeconds <= 0) {
    throw new Error(`Invalid bufferSizeInSeconds: ${bufferSizeInSeconds}`)
  }

  const mountResolver = createModelMountResolver(module, sessionId)
  const { vadConfig, recognizerConfig } = await resolveAllModels(options.models, mountResolver)
  mountResolver.commit()

  let recognizer: OfflineRecognizer | null = null
  let vadInstance: ReturnType<typeof createVad> | null = null
  let circularBuffer: CircularBuffer | null = null

  try {
    recognizer = new OfflineRecognizer(recognizerConfig, module)
    vadInstance = createVad(module, vadConfig)
    circularBuffer = new CircularBuffer(Math.ceil(bufferSizeInSeconds * sampleRate), module)

    const windowSize = vadInstance.config?.sileroVad?.windowSize ?? 512
    if (windowSize <= 0) {
      throw new Error('Invalid VAD window size')
    }

    return createSession({
      module,
      recognizer,
      vad: vadInstance,
      circularBuffer,
      sampleRate,
      windowSize,
      mountedFiles: mountResolver.mountedFiles,
    })
  }
  catch (error) {
    try {
      circularBuffer?.free()
    }
    catch {}
    try {
      vadInstance?.free()
    }
    catch {}
    try {
      recognizer?.free()
    }
    catch {}
    unlinkMountedFiles(module, mountResolver.mountedFiles)
    throw error
  }
}
