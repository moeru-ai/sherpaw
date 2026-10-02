import type { EventContext } from '@moeru/eventa'
import type { WorkerContextExtensions } from '@moeru/eventa/adapters/webworkers'

import { defineInvoke } from '@moeru/eventa'

import type { Diarizer, DiarizerConfig, ModelPack, SpeakerTracker, SpeakerTrackerConfig } from '../types'

import * as events from './events'

function copyBytes(data: unknown, name: string): Uint8Array {
  if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array))
    throw new TypeError(`${name} model data must be an ArrayBuffer or Uint8Array`)

  // Own the copy, including views backed by shared memory. Caller bytes stay usable.
  return new Uint8Array(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
}

function snapshot(pack: ModelPack, name: string): ModelPack & { data: Uint8Array } {
  return { ...pack, data: copyBytes(pack?.data, name) }
}

/** Ties the Worker to the Eventa context and the caller's signal. Returns the public dispose. */
function bindLifetime<Options>(context: EventContext<WorkerContextExtensions, Options>, signal: AbortSignal | undefined, terminate: () => void, name: string): () => void {
  /** Triggering workflow: Eventa context abort (dispose / Worker failure / config.signal) -> release -> terminate. */
  function release() {
    signal?.removeEventListener('abort', abort)
    terminate()
  }

  /** Triggering workflow: config.signal abort -> abort -> context.abort cancels initialization and queued work. */
  function abort() {
    context.abort(signal?.reason instanceof Error ? signal.reason : new DOMException(`${name} aborted`, 'AbortError'))
  }

  context.signal.addEventListener('abort', release, { once: true })
  signal?.addEventListener('abort', abort, { once: true })

  /** Triggering workflow: public dispose / initialization failure -> dispose -> context.abort rejects pending invokes and releases the Worker. */
  return () => context.abort(new Error(`${name} has been disposed`))
}

/** Copies just this view, not the backing buffer of a larger allocation, so it can be transferred. */
function copySamples(samples: Float32Array): Float32Array {
  if (!(samples instanceof Float32Array))
    throw new TypeError('samples must be a Float32Array')

  return new Float32Array(samples)
}

/** Shares diarizer lifetime across Eventa's browser and Node adapters. */
export async function createWorkerDiarizer<Options>(context: EventContext<WorkerContextExtensions, Options>, config: DiarizerConfig, terminate: () => void): Promise<Diarizer> {
  const initialize = defineInvoke(context, events.initialize)
  const diarize = defineInvoke(context, events.diarize)
  const dispose = bindLifetime(context, config.signal, terminate, 'Speaker diarizer')

  let sampleRate: number

  try {
    config.signal?.throwIfAborted()

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

      const copy = copySamples(samples)

      return diarize({ samples: copy, sampleRate: inputSampleRate, clustering }, { transfer: [copy.buffer] })
    },

    dispose,
  }
}

/** Shares speaker tracker lifetime across Eventa's browser and Node adapters. */
export async function createWorkerSpeakerTracker<Options>(context: EventContext<WorkerContextExtensions, Options>, config: SpeakerTrackerConfig, terminate: () => void): Promise<SpeakerTracker> {
  const initialize = defineInvoke(context, events.initializeTracker)
  const track = defineInvoke(context, events.track)
  const peek = defineInvoke(context, events.peek)
  const reset = defineInvoke(context, events.resetTracker)
  const enroll = defineInvoke(context, events.enroll)
  const inspect = defineInvoke(context, events.inspect)
  const speech = defineInvoke(context, events.speech)
  const dispose = bindLifetime(context, config.signal, terminate, 'Speaker tracker')

  try {
    config.signal?.throwIfAborted()

    const model = snapshot(config.model, 'Embedding')
    const segmentation = config.segmentation && { data: copyBytes(config.segmentation.data, 'Segmentation') }

    await initialize(
      { model, path: config.path, historyLimit: config.historyLimit, segmentation, tuning: config.tuning },
      { transfer: [model.data.buffer, ...(segmentation ? [segmentation.data.buffer] : [])] },
    )
    context.signal.throwIfAborted()
  }
  catch (error) {
    dispose()

    throw error
  }

  return {
    segmentation: !!config.segmentation,

    async track(samples, sampleRate) {
      context.signal.throwIfAborted()

      const copy = copySamples(samples)

      return track({ samples: copy, sampleRate }, { transfer: [copy.buffer] })
    },

    async peek(samples, sampleRate, options) {
      context.signal.throwIfAborted()

      const copy = copySamples(samples)

      return peek({ samples: copy, sampleRate, final: options?.final }, { transfer: [copy.buffer] })
    },

    async enroll(samples, sampleRate) {
      context.signal.throwIfAborted()

      const copy = copySamples(samples)

      return enroll({ samples: copy, sampleRate }, { transfer: [copy.buffer] })
    },

    async inspect() {
      context.signal.throwIfAborted()

      return inspect(undefined)
    },

    async speech(samples, sampleRate) {
      context.signal.throwIfAborted()

      const copy = copySamples(samples)

      return speech({ samples: copy, sampleRate }, { transfer: [copy.buffer] })
    },

    async reset(options) {
      context.signal.throwIfAborted()

      return reset(options)
    },

    dispose,
  }
}
