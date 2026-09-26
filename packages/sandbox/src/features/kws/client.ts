import type { Detection } from '@sherpaw/kws'

import type { Reply, Request } from './protocol'

/** One Worker per mounted page. Audio buffers are transferred, not retained. */
export function createKWSClient(onProgress: (message: string) => void) {
  const worker = new Worker(new URL('./kws.worker.ts', import.meta.url), { type: 'module' })
  let sequence = 0
  let closed = false
  let audioPending = 0
  const pending = new Map<number, { resolve: (detections: Detection[]) => void, reject: (error: Error) => void }>()

  /** Triggering workflow: {@link worker} `message` -> {@link complete} -> pending request promise / {@link onProgress}. */
  function complete(event: MessageEvent<Reply>) {
    const reply = event.data
    if (reply.progress) {
      onProgress(reply.progress)
      return
    }
    const callback = pending.get(reply.id)
    pending.delete(reply.id)
    if (reply.error)
      callback?.reject(new Error(reply.error))
    else
      callback?.resolve(reply.detections ?? [])
  }

  /** Triggering workflow: {@link worker} `error` -> {@link fail} -> {@link dispose} rejects pending requests. */
  function fail(event: ErrorEvent) {
    dispose(new Error(event.message || '关键词检测引擎意外停止，请刷新页面重试。'))
  }

  /** Triggering workflow: page unmount / {@link fail} -> {@link dispose} -> Worker.terminate and pending promise rejection. */
  function dispose(error = new Error('关键词检测会话已关闭。')) {
    closed = true
    worker.terminate()
    for (const callback of pending.values())
      callback.reject(error)
    pending.clear()
  }

  worker.onmessage = complete
  worker.onerror = fail

  async function request(request: Request): Promise<Detection[]> {
    if (closed)
      throw new Error('关键词检测会话已关闭，请刷新页面重试。')
    const audio = request.type === 'audio'
    // Bound live input to ~400 ms instead of accumulating stale microphone audio.
    if (audio && audioPending >= 4)
      throw new Error('检测速度跟不上麦克风输入，已停止监听。请关闭其他繁忙任务后重试。')
    if (audio)
      audioPending++
    try {
      return await new Promise<Detection[]>((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve, reject })
        try {
          worker.postMessage({ id, request }, request.type === 'audio' ? [request.samples.buffer] : [])
        }
        catch (error) {
          pending.delete(id)
          reject(error)
        }
      })
    }
    finally {
      if (audio)
        audioPending--
    }
  }

  return { request, dispose }
}
