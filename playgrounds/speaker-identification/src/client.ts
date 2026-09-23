import type { AudioClip, LoadingProgress, WorkerRequest, WorkerResponses } from './protocol'

const worker = new Worker(new URL('./speaker.worker.ts', import.meta.url), { type: 'module' })
let sequence = 0
const pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void, onProgress?: (progress: LoadingProgress) => void }>()

function callWorker<T extends WorkerRequest>(request: T, onProgress?: (progress: LoadingProgress) => void): Promise<WorkerResponses[T['type']]> {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: value => resolve(value as WorkerResponses[T['type']]), reject, onProgress })
    const transfer = request.type === 'identify'
      ? [request.audio.samples.buffer]
      : request.type === 'enroll' ? request.audio.map(audio => audio.samples.buffer) : []
    try {
      worker.postMessage({ id, request }, transfer)
    }
    catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
}

/** Triggering workflow: Worker message -> completeRequest -> request progress callback or promise completion. */
function completeRequest(event: MessageEvent) {
  const callback = pending.get(event.data.id)
  if (event.data.progress) {
    callback?.onProgress?.(event.data.progress)
    return
  }
  pending.delete(event.data.id)
  if (event.data.error)
    callback?.reject(new Error(event.data.error))
  else
    callback?.resolve(event.data.result)
}
worker.onmessage = completeRequest

/** Triggering workflow: Worker error -> rejectWorkerRequests -> reject outstanding UI rows. */
function rejectWorkerRequests(event: ErrorEvent) {
  for (const callback of pending.values())
    callback.reject(new Error(event.message))
  pending.clear()
}
worker.onerror = rejectWorkerRequests

export const speakerClient = {
  init(model: string, onProgress?: (progress: LoadingProgress) => void) {
    return callWorker({ type: 'init', model }, onProgress)
  },
  enroll(name: string, audio: AudioClip[], onProgress?: (progress: LoadingProgress) => void) {
    return callWorker({ type: 'enroll', name, audio }, onProgress)
  },
  identify(audio: AudioClip, onProgress?: (progress: LoadingProgress) => void) {
    return callWorker({ type: 'identify', audio }, onProgress)
  },
  async dispose() {
    try {
      await callWorker({ type: 'dispose' })
    }
    finally {
      worker.terminate()
    }
  },
  rename(name: string, newName: string) {
    return callWorker({ type: 'rename', name, newName })
  },
  removeSpeaker(name: string) {
    return callWorker({ type: 'removeSpeaker', name })
  },
  removeSample(name: string, sampleId: string) {
    return callWorker({ type: 'removeSample', name, sampleId })
  },
}
