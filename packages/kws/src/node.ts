import { Worker } from 'node:worker_threads'

import type { WorkerKeywordSpotter, WorkerKeywordSpotterConfig } from './worker-types'

import { createWorkerSpotter } from './worker-client'

export type { Detection, KeywordEntry, KeywordMatch } from './types'
export type { WorkerKeywordSpotter as KeywordSpotter, WorkerKeywordSpotterConfig as KeywordSpotterConfig, KeywordUpdateOptions, KWSModelPack } from './worker-types'

/** Node counterpart of the browser factory; model loading and inference run in a worker thread. */
export async function createKeywordSpotter(config: WorkerKeywordSpotterConfig): Promise<WorkerKeywordSpotter> {
  const worker = new Worker(new URL('./node-worker.js', import.meta.url))

  return createWorkerSpotter({
    postMessage: (command, transfer) => worker.postMessage(command, transfer),
    terminate: () => { void worker.terminate() },
    subscribe(reply, failure) {
      /** Triggering workflow: worker exit -> onExit -> reject operations if the thread stops unexpectedly. */
      function onExit(code: number) {
        failure(new Error(`Keyword Worker exited unexpectedly (${code})`))
      }

      worker.on('message', reply)
      worker.on('error', failure)
      worker.on('messageerror', failure)
      worker.on('exit', onExit)

      return () => {
        worker.off('message', reply)
        worker.off('error', failure)
        worker.off('messageerror', failure)
        worker.off('exit', onExit)
      }
    },
  }, config)
}
