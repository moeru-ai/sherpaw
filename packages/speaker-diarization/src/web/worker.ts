import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { Diarizer, DiarizerConfig } from '../types'

import { createWorkerDiarizer } from '../worker/client'

/**
 * Creates an isolated diarizer. A supplied Worker entry may import @sherpaw/speaker-diarization/worker.
 * Ownership of that Worker transfers to this diarizer, including termination on failure/disposal.
 */
export async function createDiarizer(config: DiarizerConfig, options: { worker?: Worker } = {}): Promise<Diarizer> {
  const worker = options.worker ?? new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module' })
  const { context } = createContext(worker)

  return createWorkerDiarizer(context, config, () => {
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
  })
}
