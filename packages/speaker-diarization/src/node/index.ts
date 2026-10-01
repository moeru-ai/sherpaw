import { createContext } from '@moeru/eventa/adapters/worker-threads'
import { Worker } from 'node:worker_threads'

import type { Diarizer, DiarizerConfig, SpeakerTracker, SpeakerTrackerConfig } from '../types'

import { createWorkerDiarizer, createWorkerSpeakerTracker } from '../worker/client'

export type { Clustering, DiarizationModel, DiarizationModelPacks, Diarizer, DiarizerConfig, ModelPack, SegmentationOptions, SpeakerConfidence, SpeakerGuess, SpeakerRevision, SpeakerSegment, SpeakerTracker, SpeakerTrackerConfig, SpeakerTurn } from '../types'

function spawn() {
  const worker = new Worker(new URL('./node-worker.js', import.meta.url))
  const { context } = createContext(worker)

  /** Triggering workflow: worker exit -> onExit -> context.abort rejects operations if the thread stops unexpectedly. */
  function onExit(code: number) {
    context.abort(new Error(`Speaker diarization Worker exited unexpectedly (${code})`))
  }

  worker.once('exit', onExit)

  return {
    context,
    terminate() {
      worker.off('exit', onExit)
      void worker.terminate()
    },
  }
}

/** Node counterpart of the browser factory; model loading and inference run in a worker thread. */
export async function createDiarizer(config: DiarizerConfig): Promise<Diarizer> {
  const { context, terminate } = spawn()

  return createWorkerDiarizer(context, config, terminate)
}

/** Node counterpart of the browser speaker tracker factory. */
export async function createSpeakerTracker(config: SpeakerTrackerConfig): Promise<SpeakerTracker> {
  const { context, terminate } = spawn()

  return createWorkerSpeakerTracker(context, config, terminate)
}
