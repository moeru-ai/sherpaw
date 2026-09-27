import { loadData } from '@sherpaw/preloader'

import type { KeywordSpotter, KWSModel, KWSModule } from './types'
import type { Command, Reply, Request } from './worker-protocol'

import { createKeywordSpotter, initKWSModule } from './core'

/** Owns one runtime and serializes all model, vocabulary and audio operations. */
export function createWorkerHandler(reply: (reply: Reply) => void): (command: Command) => void {
  let spotter: KeywordSpotter | undefined
  let module: KWSModule
  let model: KWSModel
  let maxActivePaths = 4
  let nativeMaxActivePaths = 4
  let queue = Promise.resolve()

  async function handle(request: Request): Promise<Reply['detections']> {
    if (request.type === 'initialize') {
      if (spotter)
        throw new Error('Keyword Worker is already initialized')

      module = await initKWSModule()
      model = request.model.paths ?? { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' }
      loadData({ module, data: request.model.data, metadata: request.model.metadata })
      spotter = createKeywordSpotter(module, { model, keywords: request.keywords, maxActivePaths: request.maxActivePaths })
      maxActivePaths = request.maxActivePaths ?? 4
      nativeMaxActivePaths = maxActivePaths

      return
    }

    if (!spotter)
      throw new Error('Keyword Worker is not initialized')

    if (request.type === 'audio')
      return spotter.processAudio(request.samples, request.sampleRate)

    if (request.type === 'reset') {
      spotter.reset()

      return
    }

    const nextMaxActivePaths = request.options?.maxActivePaths ?? maxActivePaths

    if (!Number.isInteger(nextMaxActivePaths) || nextMaxActivePaths < 1 || nextMaxActivePaths > 2147483647)
      throw new RangeError('maxActivePaths must be a positive int32 integer')

    if (request.keywords.length && nextMaxActivePaths !== nativeMaxActivePaths) {
      const next = createKeywordSpotter(module, { model, keywords: request.keywords, maxActivePaths: nextMaxActivePaths })

      spotter.dispose()
      spotter = next
      nativeMaxActivePaths = nextMaxActivePaths
    }
    else {
      await spotter.setKeywords(request.keywords)
    }

    maxActivePaths = nextMaxActivePaths
  }

  /** Triggering workflow: browser onMessage / parentPort message -> enqueue -> handle -> reply settles the public operation. */
  function enqueue({ id, request }: Command) {
    queue = queue.then(async () => {
      try {
        reply({ id, detections: await handle(request) })
      }
      catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause))

        reply({ id, error: { name: error.name, message: error.message } })
      }
    })
  }

  return enqueue
}
