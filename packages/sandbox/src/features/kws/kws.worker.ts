import type { KeywordEntry, KeywordSpotter, KWSModel, KWSModule } from '@sherpaw/kws'

import { createKeywordSpotter, initKWSModule } from '@sherpaw/kws'
import { loadData } from '@sherpaw/preloader'

import type { Reply, Request } from './protocol'

import { loadKWSModel } from './models'

let spotter: KeywordSpotter | undefined
let loaded: { module: KWSModule, model: KWSModel, maxActivePaths: number } | undefined
let keywords: KeywordEntry[] = []
let queue = Promise.resolve()

/** Triggering workflow: client.request -> {@link enqueue} -> {@link handleRequest} -> KWS API and progress replies. */
async function handleRequest(request: Request, progress: (message: string) => void) {
  if (request.type === 'load') {
    progress('Loading speech engine…')

    const module = await initKWSModule()
    const paths: KWSModel = { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' }

    try {
      progress('Loading model…')

      const { data, metadata } = await loadKWSModel()

      loadData({ module, data, metadata })
      progress('Initializing keyword detection…')

      const next = createKeywordSpotter(module, { model: paths, keywords: request.keywords, maxActivePaths: request.maxActivePaths })

      spotter?.dispose()
      spotter = next
      loaded = { module, model: paths, maxActivePaths: request.maxActivePaths }
      keywords = request.keywords
    }
    catch (error) {
      for (const path of Object.values(paths)) {
        if (module.FS.analyzePath(path).exists)
          module.FS.unlink(path)
      }

      throw error
    }

    return []
  }

  if (!spotter || !loaded)
    throw new Error('Load a model first.')

  if (request.type === 'audio')
    return spotter.processAudio(request.samples, request.sampleRate)

  const next = request.type === 'keywords' ? request.keywords : keywords

  if (request.type === 'keywords' && next.length && request.maxActivePaths !== loaded.maxActivePaths) {
    // Candidate count is fixed at construction. Reuse the loaded model files,
    // and commit the replacement only after the new detector is ready.
    const replacement = createKeywordSpotter(loaded.module, { model: loaded.model, keywords: next, maxActivePaths: request.maxActivePaths })

    spotter.dispose()
    spotter = replacement
    loaded.maxActivePaths = request.maxActivePaths
  }
  else {
    await spotter.setKeywords(next)
  }

  keywords = next

  return []
}

/** Triggering workflow: client.request -> Worker `message` -> {@link enqueue} -> serialized {@link handleRequest} -> Reply. */
function enqueue(event: MessageEvent<{ id: number, request: Request }>) {
  const { id, request } = event.data
  const reply = (message: Omit<Reply, 'id'>) => globalThis.postMessage({ id, ...message })

  queue = queue.then(async () => {
    try {
      reply({ detections: await handleRequest(request, progress => reply({ progress })) })
    }
    catch (error) {
      reply({ error: error instanceof Error ? error.message : String(error) })
    }
  })
}

globalThis.onmessage = enqueue
