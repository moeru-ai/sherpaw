import type { Extractor, InMemoryDB } from '@sherpaw/speaker-identification'

import { loadVirtualData } from '@sherpaw/preloader'
import { createExtractor, createInMemoryDB, initSpeakerIdentificationModule } from '@sherpaw/speaker-identification'

import type { LoadingProgress, WorkerRequest } from './protocol'

import { createEnrollments } from './enrollments'

let extractor: Extractor | undefined
let db: InMemoryDB | undefined
let enrollments: ReturnType<typeof createEnrollments> | undefined

function disposeSession() {
  db?.dispose()
  extractor?.dispose()
  db = undefined
  extractor = undefined
  enrollments = undefined
}

async function loadModel(url: string, report: (progress: LoadingProgress) => void) {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error('模型加载失败，请检查模型文件是否已下载。')
  const total = Number(response.headers.get('content-length')) || undefined
  const reader = response.body?.getReader()
  if (!reader)
    return new Uint8Array(await response.arrayBuffer())
  const chunks: Uint8Array[] = []
  let completed = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done)
      break
    chunks.push(value)
    completed += value.length
    report({ message: total ? `加载模型 ${Math.round(completed / total * 100)}%` : '正在读取模型…', completed, total })
  }
  const model = new Uint8Array(completed)
  let offset = 0
  for (const chunk of chunks) {
    model.set(chunk, offset)
    offset += chunk.length
  }
  return model
}

/**
 * Triggering workflow: speakerClient -> enqueueRequest -> handleRequest
 * -> model loading / extraction / enrollment / rename or deletion -> row progress and database result.
 */
async function handleRequest(request: WorkerRequest, reportProgress: (progress: LoadingProgress) => void) {
  if (request.type === 'init') {
    disposeSession()
    reportProgress({ message: '正在初始化语音引擎…' })
    const module = await initSpeakerIdentificationModule()
    reportProgress({ message: '正在读取模型…' })
    const model = await loadModel(request.model, reportProgress)
    loadVirtualData({ module, virtualData: { 'speaker.onnx': model } })
    try {
      reportProgress({ message: '正在初始化模型…' })
      extractor = createExtractor(module, { model: 'speaker.onnx' })
      db = createInMemoryDB(module, { dimension: extractor.dimension })
      enrollments = createEnrollments(db)
    }
    catch (error) {
      disposeSession()
      throw error
    }
    return
  }
  if (!extractor || !db || !enrollments)
    throw new Error('请先加载模型。')
  if (request.type === 'dispose') {
    disposeSession()
    return
  }
  if (request.type === 'rename')
    return enrollments.rename(request.name, request.newName)
  if (request.type === 'removeSpeaker')
    return enrollments.removeSpeaker(request.name)
  if (request.type === 'removeSample')
    return enrollments.removeSample(request.name, request.sampleId)
  reportProgress({ message: request.type === 'enroll' ? '正在建立声线…' : '正在识别…' })
  if (request.type === 'enroll') {
    if (!request.audio.length)
      throw new Error('请先录制一段声音。')
    const embeddings = request.audio.map(audio => extractor!.extract(audio.samples, audio.sampleRate))
    return enrollments.append(request.name, embeddings)
  }
  const start = performance.now()
  const embedding = extractor.extract(request.audio.samples, request.audio.sampleRate)
  const scores = db.matches(embedding, -1, Math.max(1, enrollments.size))
  const best = scores[0]
  return {
    match: best && best.score >= 0.6 ? best : null,
    scores,
    milliseconds: performance.now() - start,
  }
}

let pending: Promise<void> = Promise.resolve()
/** Triggering workflow: Worker message -> enqueueRequest -> serialized handleRequest -> progress/result postMessage. */
function enqueueRequest(event: MessageEvent<{ id: number, request: WorkerRequest }>) {
  const { id, request } = event.data
  pending = pending.then(async () => {
    try {
      globalThis.postMessage({ id, result: await handleRequest(request, progress => globalThis.postMessage({ id, progress })) })
    }
    catch (error) {
      globalThis.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
    }
  })
}

globalThis.onmessage = enqueueRequest
