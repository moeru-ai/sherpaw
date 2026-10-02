import type { TimedToken } from '@sherpaw/asr'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { Recognizer, RecognizerOptions, RecognizerRequest } from './protocol'

import { operation, progress } from './protocol'
import RuntimeWorker from './runtime.worker?worker'

/** Triggering workflow: ASR Load/Start -> Eventa Worker context -> Recognizer PCM interface. */
export async function createRecognizer(options: RecognizerOptions, report: (status: string) => void): Promise<Recognizer> {
  const worker = new RuntimeWorker()
  const { context } = createContext(worker)
  const invoke = defineInvoke(context, operation)

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

  /** The tokens so far, updated from each reply. */
  const tokens: TimedToken[] = []
  let received = 0
  async function send(request: RecognizerRequest, transfer: Transferable[] = []) {
    const timer = setTimeout(() => context.abort(new Error('Model operation exceeded five minutes')), 300000)
    try {
      const reply = await invoke(request, { transfer })
      tokens.length = reply.from
      for (const token of reply.tokens)
        tokens.push(token)
      received = reply.received
      return reply.text
    }
    catch (error) {
      context.abort(error)
      throw error
    }
    finally { clearTimeout(timer) }
  }

  await send({ kind: 'load', options })
  return {
    /** Triggering workflow: microphone pump -> transferred PCM -> adapter.accept -> partial/final text. */
    accept(samples) {
      // Keep caller-owned buffers intact (test fixtures can be reused).
      const copy = samples.slice()
      return send({ kind: 'accept', samples: copy }, [copy.buffer])
    },
    /** Triggering workflow: Stop -> adapter.finish -> trailing context and final text. */
    finish: () => send({ kind: 'finish' }),
    tokens: () => tokens,
    received: () => received,
    /** Triggering workflow: Stop/model change -> native/ORT cleanup -> abort context and terminate Worker. */
    async dispose() {
      if (context.signal.aborted)
        return
      try {
        await send({ kind: 'dispose' })
      }
      finally { context.abort(new Error('Model worker released')) }
    },
  }
}
