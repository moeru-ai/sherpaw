import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/worker-threads/worker'
import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'

import type { KeywordSpotterConfig } from '../types'

import { createWorkerSpotter } from './client'
import * as events from './events'

const config: KeywordSpotterConfig = {
  model: { data: new ArrayBuffer(0), metadata: { files: [], remote_package_size: 0 } },
  keywords: [{ label: 'test', matches: [{ tokens: ['a'] }] }],
  maxPendingAudio: 1,
}

function connection() {
  const { port1, port2 } = new MessageChannel()
  const { context } = createContext({ messagePort: port1 })
  const { context: remote } = createContext({ messagePort: port2 })
  const terminate = vi.fn(() => {
    port1.close()
    port2.close()
  })

  defineInvokeHandler(remote, events.initialize, () => {})

  return { context, remote, port: port1, terminate }
}

it('terminates and rejects initialization when the transport fails before its first reply', async () => {
  const { context, port, terminate } = connection()
  const pending = createWorkerSpotter(context, config, terminate)

  port.emit('error', new Error('Worker could not load'))

  await expect(pending).rejects.toThrow('Worker could not load')
  expect(terminate).toHaveBeenCalledTimes(1)
})

it('rejects every pending operation when the transport fails and makes disposal idempotent', async () => {
  const { context, port, terminate } = connection()
  const spotter = await createWorkerSpotter(context, config, terminate)

  try {
    const settled = Promise.allSettled([
      spotter.processAudio(new Float32Array(4), 16000),
      spotter.reset(),
    ])
    const failure = new Error('Worker stopped')

    port.emit('error', failure)
    spotter.dispose()

    expect(await settled).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ])
    await expect(spotter.setKeywords([])).rejects.toThrow('Worker stopped')
    expect(terminate).toHaveBeenCalledTimes(1)
  }
  finally {
    spotter.dispose()
  }
})

it('recovers after a cloning failure without leaving the audio queue occupied', async () => {
  const { context, remote, port, terminate } = connection()

  defineInvokeHandler(remote, events.processAudio, () => [])

  const spotter = await createWorkerSpotter(context, config, terminate)
  const postMessage = vi.spyOn(port, 'postMessage').mockImplementationOnce(() => {
    throw new DOMException('Could not clone request', 'DataCloneError')
  })

  try {
    await expect(spotter.processAudio(new Float32Array(4), 16000)).rejects.toThrow('Could not clone request')

    await expect(spotter.processAudio(new Float32Array(4), 16000)).resolves.toEqual([])
    expect(terminate).not.toHaveBeenCalled()
  }
  finally {
    postMessage.mockRestore()
    spotter.dispose()
  }
})
