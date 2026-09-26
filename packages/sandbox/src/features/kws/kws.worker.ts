import type { KeywordEntry, KeywordSpotter, KWSModel, KWSModule } from '@sherpaw/kws'

import { createKeywordSpotter, initKWSModule } from '@sherpaw/kws'
import { loadVirtualData } from '@sherpaw/preloader'

import type { Reply, Request } from './protocol'

let spotter: KeywordSpotter | undefined
let loaded: { module: KWSModule, model: KWSModel, maxActivePaths: number } | undefined
let keywords: KeywordEntry[] = []
let queue = Promise.resolve()

/** Triggering workflow: client.request -> {@link enqueue} -> {@link handleRequest} -> KWS API and progress replies. */
async function handleRequest(request: Request, progress: (message: string) => void) {
  if (request.type === 'load') {
    progress('正在加载语音引擎…')
    const module = await initKWSModule()
    const paths: KWSModel = { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' }
    try {
      for (const key of Object.keys(paths) as (keyof KWSModel)[]) {
        progress(`正在加载 ${key}…`)
        const response = await fetch(request.urls[key])
        if (!response.ok)
          throw new Error(`无法加载 ${key} (${response.status})，请先准备 KWS 模型。`)
        loadVirtualData({ module, virtualData: { [paths[key]]: await response.arrayBuffer() } })
      }
      progress('正在初始化关键词检测…')
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
    throw new Error('请先加载模型。')
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
