import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { KeywordSpotter, KeywordSpotterConfig } from '../types'

import { createWorkerSpotter } from '../worker/client'

/**
 * Creates an isolated detector. A supplied Worker entry may import @sherpaw/kws/worker.
 * Ownership of that Worker transfers to this detector, including termination on failure/disposal.
 */
export async function createKeywordSpotter(config: KeywordSpotterConfig, options: { worker?: Worker } = {}): Promise<KeywordSpotter> {
  const worker = options.worker ?? new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module' })
  const { context } = createContext(worker)

  return createWorkerSpotter(context, config, () => {
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  })
}
