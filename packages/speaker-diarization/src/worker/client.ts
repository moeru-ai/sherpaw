import type { EventContext } from '@moeru/eventa'
import type { WorkerContextExtensions } from '@moeru/eventa/adapters/webworkers'

import { defineInvoke } from '@moeru/eventa'

import type { Diarizer, DiarizerConfig, ModelPack } from '../types'

import * as events from './events'

function snapshot(pack: ModelPack, name: string): ModelPack & { data: Uint8Array } {
  if (!(pack?.data instanceof ArrayBuffer) && !(pack?.data instanceof Uint8Array))
    throw new TypeError(`${name} model data must be an ArrayBuffer or Uint8Array`)

  // Own the snapshot, including views backed by shared memory. Caller bytes stay usable.
  return { ...pack, data: new Uint8Array(pack.data instanceof ArrayBuffer ? new Uint8Array(pack.data) : pack.data) }
}

/** Shares diarizer lifetime across Eventa's browser and Node adapters. */
export async function createWorkerDiarizer<Options>(context: EventContext<WorkerContextExtensions, Options>, config: DiarizerConfig, terminate: () => void): Promise<Diarizer> {
  const { signal } = config
  const initialize = defineInvoke(context, events.initialize)
  const diarize = defineInvoke(context, events.diarize)

  /** Triggering workflow: Eventa context abort (dispose / Worker failure / config.signal) -> release -> terminate. */
  function release() {
    signal?.removeEventListener('abort', abort)
    terminate()
  }

  /** Triggering workflow: config.signal abort -> abort -> context.abort cancels initialization and queued work. */
  function abort() {
    context.abort(signal?.reason instanceof Error ? signal.reason : new DOMException('Speaker diarizer aborted', 'AbortError'))
  }

  /** Triggering workflow: public dispose / initialization failure -> dispose -> context.abort rejects pending invokes and releases the Worker. */
  function dispose() {
    context.abort(new Error('Speaker diarizer has been disposed'))
  }

  context.signal.addEventListener('abort', release, { once: true })
  signal?.addEventListener('abort', abort, { once: true })

  let sampleRate: number

  try {
    signal?.throwIfAborted()

    const segmentation = snapshot(config.model.segmentation, 'Segmentation')
    const embedding = snapshot(config.model.embedding, 'Embedding')

    sampleRate = await initialize({
      model: { segmentation, embedding, paths: config.model.paths },
      clustering: config.clustering,
      windowShiftRatio: config.windowShiftRatio,
      minDurationOn: config.minDurationOn,
      minDurationOff: config.minDurationOff,
    }, { transfer: [segmentation.data.buffer, embedding.data.buffer] })
    context.signal.throwIfAborted()
  }
  catch (error) {
    dispose()

    throw error
  }

  return {
    sampleRate,

    async diarize(samples, inputSampleRate, clustering) {
      context.signal.throwIfAborted()

      if (!(samples instanceof Float32Array))
        throw new TypeError('samples must be a Float32Array')

      // Copy just this view, not the backing buffer of a larger allocation.
      const copy = new Float32Array(samples)

      return diarize({ samples: copy, sampleRate: inputSampleRate, clustering }, { transfer: [copy.buffer] })
    },

    dispose,
  }
}
