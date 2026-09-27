import type { Reply } from './worker-protocol'
import type { WorkerKeywordSpotter, WorkerKeywordSpotterConfig } from './worker-types'

import { createWorkerSpotter } from './worker-client'

export type { Detection, KeywordEntry, KeywordMatch } from './types'
export type { WorkerKeywordSpotter as KeywordSpotter, WorkerKeywordSpotterConfig as KeywordSpotterConfig, KeywordUpdateOptions, KWSModelPack } from './worker-types'

/**
 * Creates an isolated detector. A supplied Worker entry may import @sherpaw/kws/worker.
 * Ownership of that Worker transfers to this detector, including termination on failure/disposal.
 */
export async function createKeywordSpotter(config: WorkerKeywordSpotterConfig, options: { worker?: Worker } = {}): Promise<WorkerKeywordSpotter> {
  const worker = options.worker ?? new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })

  return createWorkerSpotter({
    postMessage: (command, transfer = []) => worker.postMessage(command, transfer),
    terminate: () => worker.terminate(),
    subscribe(reply, failure) {
      /** Triggering workflow: worker message -> onMessage -> RPC completion. */
      function onMessage(event: MessageEvent<Reply>) {
        reply(event.data)
      }

      /** Triggering workflow: worker error -> onError -> reject operations and terminate. */
      function onError(event: ErrorEvent) {
        event.preventDefault()
        failure(new Error(event.message || 'Keyword Worker failed'))
      }

      /** Triggering workflow: worker messageerror -> onMessageError -> reject operations and terminate. */
      function onMessageError() {
        failure(new Error('Could not deserialize a keyword Worker response'))
      }

      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.addEventListener('messageerror', onMessageError)

      return () => {
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
        worker.removeEventListener('messageerror', onMessageError)
      }
    },
  }, config)
}
