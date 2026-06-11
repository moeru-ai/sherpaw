import { beforeEach, expect, it, vi } from 'vitest'

const fakeContexts = new WeakMap<object, FakeWorkerContext>()

class FakeWorkerContext {
  readonly emittedEvents: unknown[] = []
  readonly invokeCalls: Record<string, number> = {}
  private listeners = new Map<string, Set<(event: { body: unknown }) => void>>()

  on(eventa: { id: string }, handler: (event: { body: unknown }) => void): () => void {
    const listeners = this.listeners.get(eventa.id) ?? new Set()
    listeners.add(handler)
    this.listeners.set(eventa.id, listeners)
    return () => {
      listeners.delete(handler)
    }
  }

  emit(eventa: { id: string }, body: unknown): void {
    this.emittedEvents.push(body)
    for (const handler of this.listeners.get(eventa.id) ?? []) {
      handler({ body })
    }
  }

  async invoke(id: string, payload: unknown): Promise<unknown> {
    this.invokeCalls[id] = (this.invokeCalls[id] ?? 0) + 1

    if (id === 'sherpaw:stream-transcription:push') {
      this.emit({ id: 'sherpaw:stream-transcription:event' }, {
        type: 'transcription.partial',
        index: 1,
        text: `chunk:${(payload as { samples?: number[] }).samples?.length ?? 0}`,
      })
      return { text: 'partial', isEndpoint: false }
    }

    if (id === 'sherpaw:stream-transcription:finish') {
      this.emit({ id: 'sherpaw:stream-transcription:event' }, { type: 'transcription.completed' })
      return { text: 'done', sentenceCount: 1 }
    }

    return undefined
  }
}

vi.mock('@moeru/eventa', () => ({
  defineEventa: (id: string) => ({ id }),
  defineInvoke: (context: FakeWorkerContext, invokeEvent: { sendEvent: { id: string } }) => {
    return async (payload: unknown) => context.invoke(invokeEvent.sendEvent.id, payload)
  },
  defineInvokeEventa: (id: string) => ({ sendEvent: { id } }),
}))

vi.mock('@moeru/eventa/adapters/webworkers', () => ({
  createContext: (worker: object) => {
    let context = fakeContexts.get(worker)
    if (!context) {
      context = new FakeWorkerContext()
      fakeContexts.set(worker, context)
    }
    return { context }
  },
}))

const {
  streamTranscriptionDisposeInvoke,
  streamTranscriptionFinishInvoke,
  streamTranscriptionInitInvoke,
} = await import('./events')
const { createSherpawProvider } = await import('./provider')

function createSpeechTransport() {
  const worker = {
    terminate: vi.fn(),
  } as unknown as Worker
  const context = new FakeWorkerContext()
  fakeContexts.set(worker, context)

  const provider = createSherpawProvider({ worker })
  const transport = provider.speech({
    metadata: { files: [], remote_package_size: 0 },
    data: new ArrayBuffer(0),
  })

  return { context, transport }
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('does not load the same speech transport twice when preloaded before stream start', async () => {
  const { context, transport } = createSpeechTransport()

  await transport.loadSpeech()
  await transport.load()

  expect(context.invokeCalls[streamTranscriptionInitInvoke.sendEvent.id]).toBe(1)
})

it('allows loading again after terminateSpeech clears worker state', async () => {
  const { context, transport } = createSpeechTransport()

  await transport.load()
  transport.terminateSpeech()
  await transport.load()

  expect(context.invokeCalls[streamTranscriptionInitInvoke.sendEvent.id]).toBe(2)
})

it('keeps the event stream usable after terminateSpeech and reload', async () => {
  const { transport } = createSpeechTransport()
  const reader = transport.events!.getReader()

  await transport.load()
  transport.terminateSpeech()
  await transport.load()
  await transport.push({ samples: [0] })

  await expect(reader.read()).resolves.toMatchObject({
    done: false,
    value: {
      type: 'transcription.partial',
      text: 'chunk:1',
    },
  })
  await reader.cancel()
})

it('does not retain direct transport events for later fetch RPC responses', async () => {
  const { transport } = createSpeechTransport()

  await transport.load()
  await transport.push({ samples: [0, 0.1] })

  const response = await transport.fetch!('sherpaw://local', {
    body: JSON.stringify({ invoke: streamTranscriptionFinishInvoke.sendEvent.id }),
  })
  const body = await response.json() as { events?: unknown[] }

  expect(body.events).toEqual([{ type: 'transcription.completed' }])
})

it('dispose is idempotent after terminateSpeech', async () => {
  const { context, transport } = createSpeechTransport()

  await transport.load()
  transport.terminateSpeech()
  await transport.dispose()

  expect(context.invokeCalls[streamTranscriptionDisposeInvoke.sendEvent.id] ?? 0).toBe(0)
})
