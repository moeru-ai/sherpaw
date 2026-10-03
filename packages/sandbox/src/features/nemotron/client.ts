// cspell:ignore Nemotron nemotron
import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { NemotronProfile, NemotronRequest } from './protocol'

import { operation } from './protocol'
import RuntimeWorker from './runtime.worker?worker'

export interface NemotronClient {
  push: (samples: Float32Array) => Promise<Float32Array>
  flush: () => Promise<Float32Array>
  reset: () => Promise<void>
  readonly computeMs: number
  dispose: () => Promise<void>
}

/** Creates a worker-owned Nemotron stream. With `profiling`, the worker logs a summary of its step times to the console. */
export async function createNemotronClient(profile: NemotronProfile, { profiling = false }: { profiling?: boolean } = {}): Promise<NemotronClient> {
  const worker = new RuntimeWorker()
  const { context } = createContext(worker)
  const invoke = defineInvoke(context, operation)
  let computeMs = 0

  context.signal.addEventListener('abort', () => {
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  }, { once: true })

  async function send(request: NemotronRequest, transfer: Transferable[] = []) {
    const timer = setTimeout(() => context.abort(new Error('Model operation exceeded five minutes')), 300000)

    try {
      const reply = await invoke(request, { transfer })

      computeMs = reply.computeMs
      return reply.probabilities
    }
    catch (error) {
      context.abort(error)
      throw error
    }
    finally { clearTimeout(timer) }
  }

  await send({ kind: 'load', profile, profiling })

  return {
    push(samples) {
      const copy = samples.slice()

      return send({ kind: 'push', samples: copy }, [copy.buffer])
    },
    flush: () => send({ kind: 'flush' }),
    async reset() {
      await send({ kind: 'reset' })
    },
    get computeMs() { return computeMs },
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
