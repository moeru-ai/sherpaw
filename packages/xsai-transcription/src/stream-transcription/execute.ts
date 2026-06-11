import { errorMessageFrom } from '@moeru/std'

import type {
  Request,
  RuntimeTranscriptionEvent,
  StreamTranscriptionDelta,
  TranscriptionResult,
} from './types'

function createEventStreams<TEvent extends { type: string }>() {
  const xsaiFullControllers = new Set<ReadableStreamDefaultController<StreamTranscriptionDelta>>()
  const xsaiTextControllers = new Set<ReadableStreamDefaultController<string>>()
  const lastPartialByIndex = new Map<number, string>()
  let text = ''

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
    for (const controllers of [xsaiFullControllers, xsaiTextControllers] as const) {
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
    for (const controllers of [xsaiFullControllers, xsaiTextControllers] as const) {
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

  const emitXsaiDelta = (delta: string) => {
    if (delta.length === 0) {
      return
    }

    text += delta
    safeEnqueue(xsaiTextControllers, delta)
    safeEnqueue(xsaiFullControllers, { type: 'transcript.text.delta', delta })
  }

  const emitXsaiDone = () => {
    safeEnqueue(xsaiFullControllers, { type: 'transcript.text.done', delta: '' })
  }

  const emitXsaiFromPartial = (event: TEvent) => {
    const partial = event as { index?: unknown, text?: unknown }
    if (typeof partial.index !== 'number' || typeof partial.text !== 'string') {
      return
    }

    const previous = lastPartialByIndex.get(partial.index) ?? ''
    const delta = partial.text.startsWith(previous)
      ? partial.text.slice(previous.length)
      : partial.text

    lastPartialByIndex.set(partial.index, partial.text)
    emitXsaiDelta(delta)
  }

  return {
    xsai: {
      fullStream: createBranch(xsaiFullControllers),
      getText: () => text,
      textStream: createBranch(xsaiTextControllers),
    },
    emit: (event: TEvent) => {
      if (event.type === 'transcription.partial') {
        emitXsaiFromPartial(event)
      }
      else if (event.type === 'transcription.completed') {
        emitXsaiDone()
      }
    },
    errorAll,
    closeAll,
  }
}

function getFinishText(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return ''
  }

  const text = (result as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

export function streamTranscription<
  E extends { type: string } = RuntimeTranscriptionEvent,
  TFinish = unknown,
>(request: Request<E, TFinish>): TranscriptionResult<TFinish> {
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

  let resolveText!: (value: string) => void
  let rejectText!: (error: Error) => void
  const text = new Promise<string>((resolve, reject) => {
    resolveText = resolve
    rejectText = reject
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
        const eventError = new Error(errorMessageFrom(error))
        eventStreams.errorAll(eventError)
        rejectDone(eventError)
        rejectText(eventError)
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
      const commandError = new Error(errorMessageFrom(error))
      eventStreams.errorAll(commandError)
      rejectDone(commandError)
      rejectText(commandError)
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
        resolveText(eventStreams.xsai.getText() || getFinishText(result))
        resolveDone(result)
      }
      finally {
        await dispose()
      }
    },
    async abort(reason) {
      const abortError = new Error(errorMessageFrom(reason))
      eventStreams.errorAll(abortError)
      rejectDone(abortError)
      rejectText(abortError)
      await dispose()
    },
  })

  return {
    dispose,
    done,
    fullStream: eventStreams.xsai.fullStream,
    input,
    text,
    textStream: eventStreams.xsai.textStream,
  }
}
