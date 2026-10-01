import type { EventContext } from '@moeru/eventa'
import type { WorkerContextExtensions } from '@moeru/eventa/adapters/webworkers'

import { defineInvokeHandler } from '@moeru/eventa'
import { loadData } from '@sherpaw/preloader'
import { createExtractor, initSpeakerIdentificationModule } from '@sherpaw/speaker-identification'

import type { NativeDiarizer } from '../diarizer'
import type { NativeSpeakerTracker } from '../tracker'
import type { DiarizerConfig, SpeakerTrackerConfig } from '../types'

import { createDiarizer } from '../diarizer'
import { createSpeakerTracker } from '../tracker'
import { initSpeakerDiarizationModule } from '../wasm'
import * as events from './events'

/** Loads one diarizer or one speaker tracker and preserves invocation order across Eventa handlers. */
export function registerWorkerHandlers<Options extends { raw?: unknown }>(context: EventContext<WorkerContextExtensions, Options>): void {
  let diarizer: NativeDiarizer
  let tracker: NativeSpeakerTracker
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

  /** Triggering workflow: events.initializeTracker -> defineInvokeHandler -> enqueue -> initializeTracker mounts the embedding model in the speaker-identification runtime. */
  async function initializeTracker(config: Omit<SpeakerTrackerConfig, 'signal'>) {
    // The diarization runtime does not export the embedding extractor.
    const module = await initSpeakerIdentificationModule()

    loadData({ module, data: config.model.data, metadata: config.model.metadata })
    // Utterances of 0.25-1 s are embedded to pick the nearest speaker; shorter ones keep the previous label.
    tracker = createSpeakerTracker(createExtractor(module, { model: config.path ?? 'speaker-embedding.onnx', minDurationSeconds: 0.25 }), { historyLimit: config.historyLimit })
  }

  defineInvokeHandler(context, events.initializeTracker, config => enqueue(() => initializeTracker(config)))

  /** Triggering workflow: events.track -> defineInvokeHandler -> enqueue -> tracker.track -> speaker turn returned by Eventa. */
  defineInvokeHandler(context, events.track, ({ samples, sampleRate }) => enqueue(() => tracker.track(samples, sampleRate)))
  defineInvokeHandler(context, events.peek, ({ samples, sampleRate }) => enqueue(() => tracker.peek(samples, sampleRate)))
  defineInvokeHandler(context, events.resetTracker, () => enqueue(() => tracker.reset()))
}
