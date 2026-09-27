import type { Detection } from './types'
import type { Command, Reply, Request } from './worker-protocol'
import type { WorkerKeywordSpotter, WorkerKeywordSpotterConfig } from './worker-types'

/** Internal transport shared by browser Workers and Node worker threads. */
export interface WorkerTransport {
  postMessage: (command: Command, transfer?: ArrayBuffer[]) => void
  subscribe: (reply: (reply: Reply) => void, failure: (error: Error) => void) => () => void
  terminate: () => void
}

export async function createWorkerSpotter(transport: WorkerTransport, config: WorkerKeywordSpotterConfig): Promise<WorkerKeywordSpotter> {
  let sequence = 0
  let closed: Error | undefined
  let audioPending = 0
  const pending = new Map<number, { resolve: (detections: Detection[]) => void, reject: (error: Error) => void }>()
  const { signal, maxPendingAudio = 4 } = config

  /** Triggering workflow: worker message -> transport.subscribe -> complete -> settle the matching public operation. */
  function complete(reply: Reply) {
    const callback = pending.get(reply.id)

    if (!callback)
      return

    pending.delete(reply.id)

    if (reply.error)
      callback.reject(Object.assign(new Error(reply.error.message), { name: reply.error.name }))
    else
      callback.resolve(reply.detections ?? [])
  }

  const unsubscribe = transport.subscribe(complete, dispose)

  /** Triggering workflow: public dispose / transport failure / abort -> dispose -> reject requests and terminate the Worker. */
  function dispose(error = new Error('Keyword spotter has been disposed')) {
    if (closed)
      return

    closed = error
    signal?.removeEventListener('abort', abort)
    unsubscribe()
    transport.terminate()

    for (const callback of pending.values())
      callback.reject(error)

    pending.clear()
  }

  /** Triggering workflow: config.signal abort -> abort -> dispose cancels initialization and queued work. */
  function abort() {
    dispose(signal?.reason instanceof Error ? signal.reason : new DOMException('Keyword spotter aborted', 'AbortError'))
  }

  async function request(request: Request): Promise<Detection[]> {
    if (closed)
      throw closed

    const audio = request.type === 'audio'

    if (audio && !(request.samples instanceof Float32Array))
      throw new TypeError('samples must be a Float32Array')

    if (audio && audioPending >= maxPendingAudio)
      throw new Error('Keyword spotter audio queue is full')

    if (audio)
      audioPending++

    try {
      return await new Promise<Detection[]>((resolve, reject) => {
        const id = ++sequence

        pending.set(id, { resolve, reject })

        try {
          if (request.type === 'audio') {
            // Copy only this view, then transfer the owned copy. A short view of
            // a long recording must not clone its entire backing buffer per frame.
            const samples = new Float32Array(request.samples)

            transport.postMessage({ id, request: { ...request, samples } }, [samples.buffer])
          }
          else if (request.type === 'initialize') {
            const source = request.model.data

            if (!(source instanceof ArrayBuffer) && !(source instanceof Uint8Array))
              throw new TypeError('Model data must be an ArrayBuffer or Uint8Array')

            // Own the model snapshot too, including views backed by shared memory.
            const data = new Uint8Array(source instanceof ArrayBuffer ? new Uint8Array(source) : source)

            transport.postMessage({ id, request: { ...request, model: { ...request.model, data } } }, [data.buffer])
          }
          else {
            transport.postMessage({ id, request })
          }
        }
        catch (error) {
          pending.delete(id)
          reject(error)
        }
      })
    }
    finally {
      if (audio)
        audioPending--
    }
  }

  signal?.addEventListener('abort', abort, { once: true })

  try {
    signal?.throwIfAborted()

    if (!Number.isSafeInteger(maxPendingAudio) || maxPendingAudio < 1)
      throw new RangeError('maxPendingAudio must be a positive safe integer')

    await request({ type: 'initialize', model: config.model, keywords: config.keywords, maxActivePaths: config.maxActivePaths })

    if (closed)
      throw closed
  }
  catch (error) {
    dispose()

    throw error
  }

  return {
    async setKeywords(keywords, options) {
      await request({ type: 'keywords', keywords, options })
    },

    processAudio(samples, sampleRate) {
      return request({ type: 'audio', samples, sampleRate })
    },

    async reset() {
      await request({ type: 'reset' })
    },

    dispose,
  }
}
