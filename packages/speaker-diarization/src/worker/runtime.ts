import type { EventContext } from '@moeru/eventa'
import type { WorkerContextExtensions } from '@moeru/eventa/adapters/webworkers'

import { defineInvokeHandler } from '@moeru/eventa'
import { loadData } from '@sherpaw/preloader'

import type { NativeDiarizer } from '../diarizer'
import type { DiarizerConfig } from '../types'

import { createDiarizer } from '../diarizer'
import { initSpeakerDiarizationModule } from '../wasm'
import * as events from './events'

/** Loads one diarizer and preserves invocation order across Eventa handlers. */
export function registerWorkerHandlers<Options extends { raw?: unknown }>(context: EventContext<WorkerContextExtensions, Options>): void {
  let diarizer: NativeDiarizer
  let queue = Promise.resolve()

  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = queue.then(operation)

    queue = result.then(() => {}, () => {})

    return result
  }

  /** Triggering workflow: events.initialize -> defineInvokeHandler -> enqueue -> initialize mounts both models and creates the SDK diarizer. */
  async function initialize(config: Omit<DiarizerConfig, 'signal'>) {
    const module = await initSpeakerDiarizationModule()
    const model = config.model.paths ?? { segmentation: 'speaker-segmentation.onnx', embedding: 'speaker-embedding.onnx' }

    loadData({ module, data: config.model.segmentation.data, metadata: config.model.segmentation.metadata })
    loadData({ module, data: config.model.embedding.data, metadata: config.model.embedding.metadata })
    diarizer = createDiarizer(module, {
      model,
      clustering: config.clustering,
      windowShiftRatio: config.windowShiftRatio,
      minDurationOn: config.minDurationOn,
      minDurationOff: config.minDurationOff,
    })

    return diarizer.sampleRate
  }

  defineInvokeHandler(context, events.initialize, config => enqueue(() => initialize(config)))

  /** Triggering workflow: events.diarize -> defineInvokeHandler -> enqueue -> diarizer.diarize -> segments returned by Eventa. */
  defineInvokeHandler(context, events.diarize, ({ samples, sampleRate, clustering }) => enqueue(() => diarizer.diarize(samples, sampleRate, clustering)))
}
