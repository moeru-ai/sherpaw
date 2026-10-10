// cspell:ignore Nemotron nemotron
import type { ProfileName, ProfileSpeed } from '@sherpaw/speaker-diarization/sortformer'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { NemotronRequest } from './protocol'

import { operation } from './protocol'
import RuntimeWorker from './runtime.worker?worker'

export interface NemotronClient {
  benchmark: () => Promise<ProfileSpeed[]>
  start: (profile: ProfileName) => Promise<void>
  push: (samples: Float32Array) => Promise<Float32Array>
  flush: () => Promise<Float32Array>
  reset: () => Promise<void>
  readonly computeMs: number
  dispose: () => Promise<void>
}

/** Creates a worker-owned Nemotron model. With `profiling`, the worker logs a summary of its step times to the console. */
export async function createNemotronClient({ profiling = false }: { profiling?: boolean } = {}): Promise<NemotronClient> {
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
      return reply
    }
    catch (error) {
      context.abort(error)
      throw error
    }
    finally { clearTimeout(timer) }
  }

  await send({ kind: 'load', profiling })

  return {
    async benchmark() {
      return (await send({ kind: 'benchmark' })).speeds ?? []
    },
    async start(profile) {
      await send({ kind: 'start', profile })
    },
    push(samples) {
      const copy = samples.slice()

      return send({ kind: 'push', samples: copy }, [copy.buffer]).then(reply => reply.probabilities)
    },
    flush: () => send({ kind: 'flush' }).then(reply => reply.probabilities),
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
