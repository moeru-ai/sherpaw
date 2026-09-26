import type { Recognizer, RecognizerOptions, RecognizerReply, RecognizerRequest, RecognizerSnapshot } from './types'

import RuntimeWorker from './runtime.worker?worker'

/** Triggering workflow: ASR Load/Start -> selected model -> dedicated worker -> Recognizer PCM interface. */
export async function createRecognizer(options: RecognizerOptions, report: (status: string) => void): Promise<Recognizer> {
  const worker = new RuntimeWorker()
  let nextId = 0
  let closed = false
  let snapshot: RecognizerSnapshot = { text: '', decodedChunks: 0, gpuDispatches: 0 }
  const pending = new Map<number, { resolve: (value: RecognizerSnapshot) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()

  function close(error = new Error('Model worker released')) {
    if (closed)
      return
    closed = true
    worker.terminate()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }

  /** Triggering workflow: native worker reply -> progress/error/transcript -> waiting load or audio request. */
  worker.onmessage = (event: MessageEvent<RecognizerReply>) => {
    const message = event.data
    if (message.status) {
      report(message.status)
      return
    }
    const request = pending.get(message.id)
    if (!request)
      return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) {
      const error = new Error(message.error)
      request.reject(error)
      close(error)
    }
    else if (message.snapshot) {
      snapshot = message.snapshot
      request.resolve(snapshot)
    }
  }
  /** Triggering workflow: WASM/worker crash -> reject pending requests -> terminate and release model memory. */
  worker.onerror = event => close(new Error(event.message || 'ASR worker crashed'))

  function send(request: RecognizerRequest, transfer: Transferable[] = []) {
    return new Promise<RecognizerSnapshot>((resolve, reject) => {
      if (closed) {
        reject(new Error('Model worker released'))
        return
      }
      const timer = setTimeout(() => close(new Error('Model operation exceeded five minutes')), 300000)
      pending.set(request.id, { resolve, reject, timer })
      worker.postMessage(request, transfer)
    })
  }

  try {
    await send({ id: nextId++, kind: 'load', options, baseUrl: new URL(import.meta.env.BASE_URL, location.href).href })
    return {
      /** Triggering workflow: microphone pump -> transferred PCM -> adapter.accept -> partial/final text. */
      async accept(samples) {
        // Keep caller-owned buffers intact (test fixtures can be reused).
        const copy = samples.slice()
        return (await send({ id: nextId++, kind: 'accept', samples: copy }, [copy.buffer])).text
      },
      /** Triggering workflow: Stop -> adapter.finish -> drain trailing streaming context -> final text. */
      async finish() { return (await send({ id: nextId++, kind: 'finish' })).text },
      /** Triggering workflow: Stop/model change -> adapter cleanup -> terminate the owning Worker. */
      async dispose() {
        if (closed)
          return
        try {
          await send({ id: nextId++, kind: 'dispose' })
        }
        finally { close() }
      },
      stats: () => ({ decodedChunks: snapshot.decodedChunks, gpuDispatches: snapshot.gpuDispatches ?? 0 }),
    }
  }
  catch (error) {
    close()
    throw error
  }
}
