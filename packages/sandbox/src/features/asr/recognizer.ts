import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { Recognizer, RecognizerOptions, RecognizerRequest, RecognizerSnapshot } from './protocol'

import { operation, progress } from './protocol'
import RuntimeWorker from './runtime.worker?worker'

/** Triggering workflow: ASR Load/Start -> Eventa Worker context -> Recognizer PCM interface. */
export async function createRecognizer(options: RecognizerOptions, report: (status: string) => void): Promise<Recognizer> {
  const worker = new RuntimeWorker()
  const { context } = createContext(worker)
  const invoke = defineInvoke(context, operation)
  let snapshot: RecognizerSnapshot = { text: '', decodedChunks: 0, gpuDispatches: 0 }

  /** Triggering workflow: dispose / invoke failure / Worker crash -> context abort -> release Worker listeners and resources. */
  context.signal.addEventListener('abort', () => {
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  }, { once: true })
  /** Triggering workflow: adapter initialization -> progress event -> sandbox loading status. */
  context.on(progress, (event) => {
    if (event.body)
      report(event.body)
  })

  async function send(request: RecognizerRequest, transfer: Transferable[] = []) {
    const timer = setTimeout(() => context.abort(new Error('Model operation exceeded five minutes')), 300000)
    try {
      snapshot = await invoke(request, { transfer })
      return snapshot.text
    }
    catch (error) {
      context.abort(error)
      throw error
    }
    finally { clearTimeout(timer) }
  }

  await send({ kind: 'load', options, baseUrl: new URL(import.meta.env.BASE_URL, location.href).href })
  return {
    /** Triggering workflow: microphone pump -> transferred PCM -> adapter.accept -> partial/final text. */
    accept(samples) {
      // Keep caller-owned buffers intact (test fixtures can be reused).
      const copy = samples.slice()
      return send({ kind: 'accept', samples: copy }, [copy.buffer])
    },
    /** Triggering workflow: Stop -> adapter.finish -> trailing context and final text. */
    finish: () => send({ kind: 'finish' }),
    /** Triggering workflow: Stop/model change -> native/ORT cleanup -> abort context and terminate Worker. */
    async dispose() {
      if (context.signal.aborted)
        return
      try {
        await send({ kind: 'dispose' })
      }
      finally { context.abort(new Error('Model worker released')) }
    },
    stats: () => ({ decodedChunks: snapshot.decodedChunks, gpuDispatches: snapshot.gpuDispatches }),
  }
}
