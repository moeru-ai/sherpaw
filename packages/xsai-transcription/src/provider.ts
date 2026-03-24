import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers'
import { errorMessageFrom } from '@moeru/std'

import type {
  FinishResult,
  PushAudioInvokeRequest,
  PushAudioResult,
  TranscriptionEvent,
} from './stream-transcription/types'
import type {
  ResolvedSherpawSpeechModel,
  SherpawProviderOptions,
  SherpawSpeechModel,
  SherpawSpeechTransport,
  TransportResponse,
} from './types'

import {
  streamTranscriptionDisposeInvoke,
  streamTranscriptionEvent,
  streamTranscriptionFinishInvoke,
  streamTranscriptionInitInvoke,
  streamTranscriptionPushInvoke,
  streamTranscriptionResetInvoke,
} from './events'
import { resolveBinary, resolveMetadata } from './stream-transcription/resolve'

interface InvokeTransportRequest {
  invoke: string
  payload?: unknown
}

interface WorkerInvokes {
  dispose: () => Promise<void>
  finish: () => Promise<FinishResult>
  init: (payload: ResolvedSherpawSpeechModel, options?: { transfer?: Transferable[] } & { signal?: AbortSignal }) => Promise<void>
  push: (payload: PushAudioInvokeRequest, options?: { transfer?: Transferable[] } & { signal?: AbortSignal }) => Promise<PushAudioResult>
  reset: () => Promise<void>
}

function createTransportResponse(payload: TransportResponse): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
    },
  })
}

function createEventChannel<T>() {
  const controllers = new Set<ReadableStreamDefaultController<T>>()

  const stream = new ReadableStream<T>({
    start(controller) {
      controllers.add(controller)
    },
    cancel() {
      const controller = controllers.values().next().value as ReadableStreamDefaultController<T> | undefined
      if (controller) {
        controllers.delete(controller)
      }
    },
  })

  const emit = (event: T) => {
    for (const controller of controllers) {
      try {
        controller.enqueue(event)
      }
      catch {
        controllers.delete(controller)
      }
    }
  }

  const close = () => {
    for (const controller of controllers) {
      try {
        controller.close()
      }
      catch {
        // ignore already closed controllers
      }
    }
    controllers.clear()
  }

  return { stream, emit, close }
}

function isPushAudioInvokeRequest(value: unknown): value is PushAudioInvokeRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as { samples?: unknown, sampleRate?: unknown }
  if (!Array.isArray(payload.samples) || !payload.samples.every(sample => typeof sample === 'number')) {
    return false
  }

  return payload.sampleRate === undefined || typeof payload.sampleRate === 'number'
}

async function parseInvokeRequest(init: RequestInit | undefined): Promise<InvokeTransportRequest> {
  const raw = init?.body
  if (!raw || typeof raw !== 'string') {
    throw new TypeError('Request body must be a JSON string.')
  }

  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || !('invoke' in parsed)) {
    throw new TypeError('Invalid stream transcription invoke request.')
  }

  if (typeof (parsed as { invoke: unknown }).invoke !== 'string') {
    throw new TypeError('Invalid stream transcription invoke request.')
  }

  return parsed as InvokeTransportRequest
}

function resolveWorkerURL(options: SherpawProviderOptions): string {
  if (options.workerURL instanceof URL) {
    return options.workerURL.toString()
  }
  if (typeof options.workerURL === 'string' && options.workerURL.length > 0) {
    return options.workerURL
  }

  if (typeof options.baseURL === 'string' && options.baseURL.length > 0) {
    const workerURL = new URL(options.baseURL).searchParams.get('worker-url')
    if (workerURL) {
      return workerURL
    }
  }

  throw new TypeError('worker or workerURL is required')
}

export interface SherpawProvider {
  speech: (model: SherpawSpeechModel) => SherpawSpeechTransport
}

export function createSherpawProvider(options: SherpawProviderOptions = {}): SherpawProvider {
  return {
    speech(model) {
      let resolvedModelPromise: Promise<ResolvedSherpawSpeechModel> | null = null
      let workerRef: Worker | null = options.worker ?? null
      let workerInvokes: WorkerInvokes | null = null
      let stopEventListener: (() => void) | null = null
      let disposed = false
      const eventQueue: TranscriptionEvent[] = []
      const eventChannel = createEventChannel<TranscriptionEvent>()
      let invokeChain = Promise.resolve()

      function runInInvokeOrder<T>(fn: () => Promise<T>): Promise<T> {
        const job = invokeChain.then(fn)
        invokeChain = job.then(() => undefined, () => undefined)
        return job
      }

      function takeEvents(): TranscriptionEvent[] {
        return eventQueue.splice(0)
      }

      function teardownWorker() {
        eventQueue.length = 0
        stopEventListener?.()
        stopEventListener = null
        workerInvokes = null

        if (workerRef && options.worker !== workerRef) {
          workerRef.terminate()
        }
        workerRef = options.worker ?? null
      }

      function ensureWorkerInvokes(): WorkerInvokes {
        if (workerInvokes) {
          return workerInvokes
        }

        const worker = workerRef ?? new Worker(resolveWorkerURL(options), { type: 'module' })
        workerRef = worker

        const workerContext = createContext(worker).context
        stopEventListener = workerContext.on(streamTranscriptionEvent, ({ body }) => {
          eventQueue.push(body)
          eventChannel.emit(body)
        })

        workerInvokes = {
          dispose: defineInvoke(workerContext, streamTranscriptionDisposeInvoke),
          finish: defineInvoke(workerContext, streamTranscriptionFinishInvoke),
          init: defineInvoke(workerContext, streamTranscriptionInitInvoke),
          push: defineInvoke(workerContext, streamTranscriptionPushInvoke),
          reset: defineInvoke(workerContext, streamTranscriptionResetInvoke),
        }

        return workerInvokes
      }

      function getFetcher() {
        return options.fetch ?? globalThis.fetch
      }

      async function resolveModel(): Promise<ResolvedSherpawSpeechModel> {
        if (!resolvedModelPromise) {
          resolvedModelPromise = Promise.all([
            resolveMetadata(model.metadata, getFetcher()),
            resolveBinary(model.data, getFetcher()),
          ]).then(([metadata, data]) => ({
            data,
            metadata,
            module: model.module,
            recognizerConfig: model.recognizerConfig,
            sampleRate: model.sampleRate,
          }))
        }

        return await resolvedModelPromise
      }

      async function createInitPayload(): Promise<ResolvedSherpawSpeechModel> {
        const resolvedModel = await resolveModel()
        return {
          ...resolvedModel,
          data: resolvedModel.data.slice(0),
        }
      }

      async function runInvoke(invoke: InvokeTransportRequest): Promise<unknown> {
        const invokes = ensureWorkerInvokes()

        switch (invoke.invoke) {
          case streamTranscriptionInitInvoke.sendEvent.id: {
            const resolvedModel = await createInitPayload()
            return await invokes.init(resolvedModel, { transfer: [resolvedModel.data] })
          }

          case streamTranscriptionPushInvoke.sendEvent.id: {
            if (!isPushAudioInvokeRequest(invoke.payload))
              throw new TypeError('Invalid push invoke payload.')
            return await invokes.push(invoke.payload)
          }

          case streamTranscriptionFinishInvoke.sendEvent.id:
            return await invokes.finish()

          case streamTranscriptionResetInvoke.sendEvent.id:
            return await invokes.reset()

          case streamTranscriptionDisposeInvoke.sendEvent.id:
            return await invokes.dispose()

          default:
            throw new TypeError('Invalid stream transcription invoke ID.')
        }
      }

      const transportFetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        try {
          const invoke = await parseInvokeRequest(init)
          const payload = await runInvoke(invoke)
          return createTransportResponse({ ok: true, payload, events: takeEvents() })
        }
        catch (error) {
          const message = errorMessageFrom(error)
          return createTransportResponse({ ok: false, error: message })
        }
      }

      const transport: SherpawSpeechTransport = {
        baseURL: options.baseURL ?? 'sherpaw://xsai-transcription/stream-transcription',
        fetch: transportFetch,
        inputSampleRate: model.sampleRate,
        events: eventChannel.stream,
        load: async () => {
          await runInInvokeOrder(async () => {
            const invokes = ensureWorkerInvokes()
            const resolvedModel = await createInitPayload()
            await invokes.init(resolvedModel, { transfer: [resolvedModel.data] })
          })
        },
        push: async (payload) => {
          return await runInInvokeOrder(async () => {
            const invokes = ensureWorkerInvokes()
            return await invokes.push(payload)
          })
        },
        finish: async () => {
          return await runInInvokeOrder(async () => {
            const invokes = ensureWorkerInvokes()
            return await invokes.finish()
          })
        },
        reset: async () => {
          await runInInvokeOrder(async () => {
            const invokes = ensureWorkerInvokes()
            await invokes.reset()
          })
        },
        dispose: async () => {
          if (disposed) {
            return
          }
          disposed = true

          try {
            await runInInvokeOrder(async () => {
              if (!workerInvokes) {
                return
              }

              await workerInvokes.dispose()
            })
          }
          finally {
            eventChannel.close()
            teardownWorker()
          }
        },
        loadSpeech: async () => {
          await transport.load()
        },
        terminateSpeech: () => {
          disposed = true
          eventChannel.close()
          teardownWorker()
        },
      }

      return transport
    },
  }
}
