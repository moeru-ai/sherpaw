import { errorMessageFrom } from '@moeru/std'

import type {
  EventByType,
  Request,
  TranscriptionEvent,
  TranscriptionResult,
} from './types'

function createEventStreams<TEvent extends { type: string }>() {
  const fullControllers = new Set<ReadableStreamDefaultController<TEvent>>()
  const partialControllers = new Set<ReadableStreamDefaultController<EventByType<TEvent, 'transcription.partial'>>>()
  const wordControllers = new Set<ReadableStreamDefaultController<EventByType<TEvent, 'word'>>>()
  const sentenceControllers = new Set<ReadableStreamDefaultController<EventByType<TEvent, 'sentence.end'>>>()

  const createBranch = <T>(controllers: Set<ReadableStreamDefaultController<T>>) => {
    let currentController: ReadableStreamDefaultController<T> | null = null
    return new ReadableStream<T>({
      start(controller) {
        currentController = controller
        controllers.add(controller)
      },
      cancel() {
        if (currentController) {
          controllers.delete(currentController)
          currentController = null
        }
      },
    })
  }

  const safeEnqueue = <T>(controllers: Set<ReadableStreamDefaultController<T>>, payload: T) => {
    for (const controller of controllers) {
      try {
        controller.enqueue(payload)
      }
      catch {
        controllers.delete(controller)
      }
    }
  }

  const closeAll = () => {
    for (const controllers of [fullControllers, partialControllers, wordControllers, sentenceControllers] as const) {
      for (const controller of controllers) {
        try {
          controller.close()
        }
        catch {
          // ignore already closed streams
        }
      }
      controllers.clear()
    }
  }

  const errorAll = (error: Error) => {
    for (const controllers of [fullControllers, partialControllers, wordControllers, sentenceControllers] as const) {
      for (const controller of controllers) {
        try {
          controller.error(error)
        }
        catch {
          // ignore already closed streams
        }
      }
      controllers.clear()
    }
  }

  return {
    streams: {
      full: createBranch(fullControllers),
      partials: createBranch(partialControllers),
      sentences: createBranch(sentenceControllers),
      words: createBranch(wordControllers),
    },
    emit: (event: TEvent) => {
      safeEnqueue(fullControllers, event)
      if (event.type === 'transcription.partial') {
        safeEnqueue(partialControllers, event as EventByType<TEvent, 'transcription.partial'>)
      }
      else if (event.type === 'word') {
        safeEnqueue(wordControllers, event as EventByType<TEvent, 'word'>)
      }
      else if (event.type === 'sentence.end') {
        safeEnqueue(sentenceControllers, event as EventByType<TEvent, 'sentence.end'>)
      }
    },
    errorAll,
    closeAll,
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(errorMessageFrom(error))
}

export function streamTranscription<
  E extends { type: string } = TranscriptionEvent,
  TFinish = unknown,
>(request: Request<E, TFinish>): TranscriptionResult<E, TFinish> {
  const eventStreams = createEventStreams<E>()
  let disposed = false
  let responsePump: Promise<void> | null = null
  let commandChain = Promise.resolve()

  let resolveDone!: (value: TFinish) => void
  let rejectDone!: (error: Error) => void
  const done = new Promise<TFinish>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })

  if (request.events) {
    responsePump = (async () => {
      const reader = request.events!.getReader()
      try {
        while (true) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) {
            break
          }

          eventStreams.emit(value)
        }
      }
      catch (error) {
        const eventError = normalizeError(error)
        eventStreams.errorAll(eventError)
        rejectDone(eventError)
        throw error
      }
    })()
  }

  const runInCommandOrder = async <TPayload>(fn: () => Promise<TPayload>): Promise<TPayload> => {
    const job = commandChain.then(fn)
    commandChain = job.then(() => undefined, () => undefined)
    return await job
  }

  const runOrFail = async <TPayload>(fn: () => Promise<TPayload>): Promise<TPayload> => {
    try {
      return await runInCommandOrder(fn)
    }
    catch (error) {
      const commandError = normalizeError(error)
      eventStreams.errorAll(commandError)
      rejectDone(commandError)
      throw commandError
    }
  }

  const dispose = async (): Promise<void> => {
    if (disposed) {
      return
    }
    disposed = true

    try {
      await runInCommandOrder(async () => await request.dispose())
    }
    finally {
      if (responsePump) {
        await responsePump
      }
      eventStreams.closeAll()
    }
  }

  const input = new WritableStream<Float32Array>({
    async start() {
      await runOrFail(async () => await request.load())
    },
    async write(chunk) {
      await runOrFail(async () => {
        await request.push({
          sampleRate: request.inputSampleRate,
          samples: Array.from(chunk),
        })
      })
    },
    async close() {
      try {
        const result = await runOrFail(async () => {
          return await request.finish()
        })
        resolveDone(result)
      }
      finally {
        await dispose()
      }
    },
    async abort(reason) {
      const abortError = normalizeError(reason)
      eventStreams.errorAll(abortError)
      rejectDone(abortError)
      await dispose()
    },
  })

  return {
    dispose,
    done,
    input,
    streams: eventStreams.streams,
  }
}
