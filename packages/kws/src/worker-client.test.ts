import { expect, it, vi } from 'vitest'

import type { Command, Reply } from './worker-protocol'
import type { WorkerKeywordSpotterConfig } from './worker-types'

import { createWorkerSpotter } from './worker-client'

const config: WorkerKeywordSpotterConfig = {
  model: { data: new ArrayBuffer(0), metadata: { files: [], remote_package_size: 0 } },
  keywords: [{ label: 'test', matches: [{ tokens: ['a'] }] }],
  maxPendingAudio: 1,
}

function transport() {
  let reply: (message: Reply) => void
  let failure: (error: Error) => void
  const commands: Command[] = []
  const unsubscribe = vi.fn()
  const terminate = vi.fn()
  const postMessage = vi.fn((command: Command) => {
    commands.push(command)
  })

  return {
    commands,
    unsubscribe,
    terminate,
    postMessage,
    subscribe(onReply: typeof reply, onFailure: typeof failure) {
      reply = onReply
      failure = onFailure

      return unsubscribe
    },

    respond(message: Omit<Reply, 'id'> = {}) {
      reply({ id: commands.at(-1)!.id, ...message })
    },

    fail(error: Error) {
      failure(error)
    },
  }
}

it('terminates and rejects initialization when the Worker fails before its first reply', async () => {
  const worker = transport()
  const pending = createWorkerSpotter(worker, config)

  worker.fail(new Error('Worker could not load'))

  await expect(pending).rejects.toThrow('Worker could not load')
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.unsubscribe).toHaveBeenCalledTimes(1)
})

it('rejects every pending operation when the Worker crashes and makes disposal idempotent', async () => {
  const worker = transport()
  const initializing = createWorkerSpotter(worker, config)

  worker.respond()

  const spotter = await initializing
  const audio = spotter.processAudio(new Float32Array(4), 16000)
  const reset = spotter.reset()
  const settled = Promise.allSettled([audio, reset])
  const failure = new Error('Worker stopped')

  worker.fail(failure)
  spotter.dispose()

  expect(await settled).toEqual([
    { status: 'rejected', reason: failure },
    { status: 'rejected', reason: failure },
  ])
  await expect(spotter.setKeywords([])).rejects.toThrow('Worker stopped')
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  expect(worker.unsubscribe).toHaveBeenCalledTimes(1)
})

it('recovers after a cloning failure without leaving the audio queue occupied', async () => {
  const worker = transport()
  const initializing = createWorkerSpotter(worker, config)

  worker.respond()

  const spotter = await initializing

  worker.postMessage.mockImplementationOnce(() => {
    throw new DOMException('Uncloneable request', 'DataCloneError')
  })

  await expect(spotter.processAudio(new Float32Array(4), 16000)).rejects.toThrow('Uncloneable request')

  const next = spotter.processAudio(new Float32Array(4), 16000)

  worker.respond({ detections: [] })

  await expect(next).resolves.toEqual([])
  expect(worker.terminate).not.toHaveBeenCalled()

  spotter.dispose()
})
