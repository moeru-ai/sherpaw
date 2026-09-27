import type { EventContext } from '@moeru/eventa'
import type { WorkerContextExtensions } from '@moeru/eventa/adapters/webworkers'

import { defineInvokeHandler } from '@moeru/eventa'
import { loadData } from '@sherpaw/preloader'

import type { KeywordEntry, KeywordSpotter, KWSModel, KWSModule } from './types'
import type { KeywordUpdateOptions, WorkerKeywordSpotterConfig } from './worker-types'

import { createKeywordSpotter, initKWSModule } from './core'
import * as events from './events'

/** Owns one runtime and serializes all model, vocabulary and audio operations. */
export function registerWorkerHandlers<Options extends { raw?: unknown }>(context: EventContext<WorkerContextExtensions, Options>): void {
  let spotter: KeywordSpotter | undefined
  let module: KWSModule
  let model: KWSModel
  let maxActivePaths = 4
  let nativeMaxActivePaths = 4
  let queue = Promise.resolve()

  // Vocabulary replacement must finish before the next audio frame is decoded.
  function enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = queue.then(operation)

    queue = result.then(() => {}, () => {})

    return result
  }

  function detector(): KeywordSpotter {
    if (!spotter)
      throw new Error('Keyword Worker is not initialized')

    return spotter
  }

  /** Triggering workflow: events.initialize -> defineInvokeHandler -> enqueue -> initialize loads the model and creates the detector. */
  async function initialize(config: Omit<WorkerKeywordSpotterConfig, 'signal' | 'maxPendingAudio'>) {
    if (spotter)
      throw new Error('Keyword Worker is already initialized')

    module = await initKWSModule()
    model = config.model.paths ?? { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' }
    loadData({ module, data: config.model.data, metadata: config.model.metadata })
    spotter = createKeywordSpotter(module, { model, keywords: config.keywords, maxActivePaths: config.maxActivePaths })
    maxActivePaths = config.maxActivePaths ?? 4
    nativeMaxActivePaths = maxActivePaths
  }

  /** Triggering workflow: events.setKeywords -> defineInvokeHandler -> enqueue -> replace updates the detector atomically. */
  async function replace(keywords: readonly KeywordEntry[], options?: KeywordUpdateOptions) {
    const current = detector()
    const nextMaxActivePaths = options?.maxActivePaths ?? maxActivePaths

    if (!Number.isInteger(nextMaxActivePaths) || nextMaxActivePaths < 1 || nextMaxActivePaths > 2147483647)
      throw new RangeError('maxActivePaths must be a positive int32 integer')

    if (keywords.length && nextMaxActivePaths !== nativeMaxActivePaths) {
      const next = createKeywordSpotter(module, { model, keywords, maxActivePaths: nextMaxActivePaths })

      current.dispose()
      spotter = next
      nativeMaxActivePaths = nextMaxActivePaths
    }
    else {
      await current.setKeywords(keywords)
    }

    maxActivePaths = nextMaxActivePaths
  }

  defineInvokeHandler(context, events.initialize, config => enqueue(() => initialize(config)))
  defineInvokeHandler(context, events.setKeywords, ({ keywords, options }) => enqueue(() => replace(keywords, options)))

  /** Triggering workflow: events.processAudio -> defineInvokeHandler -> enqueue -> detector.processAudio -> detections returned by Eventa. */
  defineInvokeHandler(context, events.processAudio, ({ samples, sampleRate }) => enqueue(() => detector().processAudio(samples, sampleRate)))

  /** Triggering workflow: events.reset -> defineInvokeHandler -> enqueue -> detector.reset starts a fresh audio stream. */
  defineInvokeHandler(context, events.reset, () => enqueue(() => detector().reset()))
}
