import { createContext } from '@moeru/eventa/adapters/worker-threads'
import { Worker } from 'node:worker_threads'

import type { Diarizer, DiarizerConfig } from '../types'

import { createWorkerDiarizer } from '../worker/client'

export type { Clustering, DiarizationModel, DiarizationModelPacks, Diarizer, DiarizerConfig, ModelPack, SegmentationOptions, SpeakerSegment } from '../types'

/** Node counterpart of the browser factory; model loading and inference run in a worker thread. */
export async function createDiarizer(config: DiarizerConfig): Promise<Diarizer> {
  const worker = new Worker(new URL('./node-worker.js', import.meta.url))
  const { context } = createContext(worker)

  /** Triggering workflow: worker exit -> onExit -> context.abort rejects operations if the thread stops unexpectedly. */
  function onExit(code: number) {
    context.abort(new Error(`Speaker diarization Worker exited unexpectedly (${code})`))
  }

  worker.once('exit', onExit)

  return createWorkerDiarizer(context, config, () => {
    worker.off('exit', onExit)
    void worker.terminate()
  })
}
