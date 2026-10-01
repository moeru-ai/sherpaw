import { createContext } from '@moeru/eventa/adapters/webworkers'

import type { Diarizer, DiarizerConfig, SpeakerTracker, SpeakerTrackerConfig } from '../types'

import { createWorkerDiarizer, createWorkerSpeakerTracker } from '../worker/client'

function spawn(worker?: Worker) {
  const owned = worker ?? new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module' })

  return {
    ...createContext(owned),
    terminate() {
      owned.onmessage = null
      owned.onerror = null
      owned.onmessageerror = null
      owned.terminate()
    },
  }
}

/**
 * Creates an isolated diarizer. A supplied Worker entry may import @sherpaw/speaker-diarization/worker.
 * Ownership of that Worker transfers to this diarizer, including termination on failure/disposal.
 */
export async function createDiarizer(config: DiarizerConfig, options: { worker?: Worker } = {}): Promise<Diarizer> {
  const { context, terminate } = spawn(options.worker)

  return createWorkerDiarizer(context, config, terminate)
}

/**
 * Creates an isolated streaming speaker tracker on its own Worker, with the same
 * Worker ownership rules as {@link createDiarizer}.
 */
export async function createSpeakerTracker(config: SpeakerTrackerConfig, options: { worker?: Worker } = {}): Promise<SpeakerTracker> {
  const { context, terminate } = spawn(options.worker)

  return createWorkerSpeakerTracker(context, config, terminate)
}
