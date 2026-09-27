import type { EventContext } from '@moeru/eventa'
import type { WorkerContextExtensions } from '@moeru/eventa/adapters/webworkers'

import { defineInvoke } from '@moeru/eventa'

import type { WorkerKeywordSpotter, WorkerKeywordSpotterConfig } from './worker-types'

import * as events from './events'

/** Shares detector lifetime and audio backpressure across Eventa's browser and Node adapters. */
export async function createWorkerSpotter<Options>(context: EventContext<WorkerContextExtensions, Options>, config: WorkerKeywordSpotterConfig, terminate: () => void): Promise<WorkerKeywordSpotter> {
  const { signal, maxPendingAudio = 4 } = config
  const initialize = defineInvoke(context, events.initialize)
  const setKeywords = defineInvoke(context, events.setKeywords)
  const processAudio = defineInvoke(context, events.processAudio)
  const reset = defineInvoke(context, events.reset)
  let audioPending = 0

  /** Triggering workflow: Eventa context abort (dispose / Worker failure / config.signal) -> release -> terminate. */
  function release() {
    signal?.removeEventListener('abort', abort)
    terminate()
  }

  /** Triggering workflow: config.signal abort -> abort -> context.abort cancels initialization and queued work. */
  function abort() {
    context.abort(signal?.reason instanceof Error ? signal.reason : new DOMException('Keyword spotter aborted', 'AbortError'))
  }

  /** Triggering workflow: public dispose / initialization failure -> dispose -> context.abort rejects pending invokes and releases the Worker. */
  function dispose() {
    context.abort(new Error('Keyword spotter has been disposed'))
  }

  context.signal.addEventListener('abort', release, { once: true })
  signal?.addEventListener('abort', abort, { once: true })

  try {
    signal?.throwIfAborted()

    if (!Number.isSafeInteger(maxPendingAudio) || maxPendingAudio < 1)
      throw new RangeError('maxPendingAudio must be a positive safe integer')

    const source = config.model.data

    if (!(source instanceof ArrayBuffer) && !(source instanceof Uint8Array))
      throw new TypeError('Model data must be an ArrayBuffer or Uint8Array')

    // Own the snapshot, including views backed by shared memory. Caller bytes stay usable.
    const data = new Uint8Array(source instanceof ArrayBuffer ? new Uint8Array(source) : source)

    await initialize({ model: { ...config.model, data }, keywords: config.keywords, maxActivePaths: config.maxActivePaths }, { transfer: [data.buffer] })
    context.signal.throwIfAborted()
  }
  catch (error) {
    dispose()

    throw error
  }

  return {
    setKeywords: (keywords, options) => setKeywords({ keywords, options }),

    async processAudio(samples, sampleRate) {
      context.signal.throwIfAborted()

      if (!(samples instanceof Float32Array))
        throw new TypeError('samples must be a Float32Array')

      if (audioPending >= maxPendingAudio)
        throw new Error('Keyword spotter audio queue is full')

      audioPending++

      try {
        // Copy just this view, not the backing buffer of an entire recording.
        const copy = new Float32Array(samples)

        return await processAudio({ samples: copy, sampleRate }, { transfer: [copy.buffer] })
      }
      finally {
        audioPending--
      }
    },

    reset,
    dispose,
  }
}
