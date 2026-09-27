import { createContext } from '@moeru/eventa/adapters/worker-threads'
import { Worker } from 'node:worker_threads'

import type { WorkerKeywordSpotter, WorkerKeywordSpotterConfig } from './worker-types'

import { createWorkerSpotter } from './worker-client'

export type { Detection, KeywordEntry, KeywordMatch } from './types'
export type { WorkerKeywordSpotter as KeywordSpotter, WorkerKeywordSpotterConfig as KeywordSpotterConfig, KeywordUpdateOptions, KWSModelPack } from './worker-types'

/** Node counterpart of the browser factory; model loading and inference run in a worker thread. */
export async function createKeywordSpotter(config: WorkerKeywordSpotterConfig): Promise<WorkerKeywordSpotter> {
  const worker = new Worker(new URL('./node-worker.js', import.meta.url))
  const { context } = createContext(worker)

  /** Triggering workflow: worker exit -> onExit -> context.abort rejects operations if the thread stops unexpectedly. */
  function onExit(code: number) {
    context.abort(new Error(`Keyword Worker exited unexpectedly (${code})`))
  }

  worker.once('exit', onExit)

  return createWorkerSpotter(context, config, () => {
    worker.off('exit', onExit)
    void worker.terminate()
  })
}
