import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { WorkerKeywordSpotter, WorkerKeywordSpotterConfig } from './worker-types'

import { createWorkerSpotter } from './worker-client'

/**
 * Creates an isolated detector. A supplied Worker entry may import @sherpaw/kws/worker.
 * Ownership of that Worker transfers to this detector, including termination on failure/disposal.
 */
export async function createKeywordSpotter(config: WorkerKeywordSpotterConfig, options: { worker?: Worker } = {}): Promise<WorkerKeywordSpotter> {
  const worker = options.worker ?? new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module' })
  const { context } = createContext(worker)

  return createWorkerSpotter(context, config, () => {
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  })
}
