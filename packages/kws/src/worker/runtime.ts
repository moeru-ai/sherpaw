import type { EventContext } from '@moeru/eventa'
import type { WorkerContextExtensions } from '@moeru/eventa/adapters/webworkers'

import { defineInvokeHandler } from '@moeru/eventa'
import { loadData } from '@sherpaw/preloader'

import type { NativeKeywordSpotter } from '../spotter'
import type { KeywordSpotterConfig } from '../types'

import { createKeywordSpotter } from '../spotter'
import { initKWSModule } from '../wasm'
import * as events from './events'

/** Loads one detector and preserves invocation order across Eventa handlers. */
export function registerWorkerHandlers<Options extends { raw?: unknown }>(context: EventContext<WorkerContextExtensions, Options>): void {
  let spotter: NativeKeywordSpotter
  let queue = Promise.resolve()

  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = queue.then(operation)

    queue = result.then(() => {}, () => {})

    return result
  }

  /** Triggering workflow: events.initialize -> defineInvokeHandler -> enqueue -> initialize mounts the model and creates the SDK detector. */
  async function initialize(config: Omit<KeywordSpotterConfig, 'signal' | 'maxPendingAudio'>) {
    const module = await initKWSModule()
    const model = config.model.paths ?? { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' }

    loadData({ module, data: config.model.data, metadata: config.model.metadata })
    spotter = createKeywordSpotter(module, { model, keywords: config.keywords, maxActivePaths: config.maxActivePaths })
  }

  defineInvokeHandler(context, events.initialize, config => enqueue(() => initialize(config)))

  /** Triggering workflow: events.setKeywords -> defineInvokeHandler -> enqueue -> spotter.setKeywords replaces the vocabulary and search settings. */
  defineInvokeHandler(context, events.setKeywords, ({ keywords, options }) => enqueue(() => spotter.setKeywords(keywords, options)))

  /** Triggering workflow: events.processAudio -> defineInvokeHandler -> enqueue -> spotter.processAudio -> detections returned by Eventa. */
  defineInvokeHandler(context, events.processAudio, ({ samples, sampleRate }) => enqueue(() => spotter.processAudio(samples, sampleRate)))

  /** Triggering workflow: events.reset -> defineInvokeHandler -> enqueue -> spotter.reset starts a fresh audio stream. */
  defineInvokeHandler(context, events.reset, () => enqueue(() => spotter.reset()))
}
