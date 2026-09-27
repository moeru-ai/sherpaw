import type { WebAssemblyModule } from '@sherpaw/shared'

import { beforeEach, expect, it, vi } from 'vitest'

import { createOnlineRecognizer, OnlineRecognizerTypes } from './asr'
import { createStreamingRecognizer } from './streaming'

vi.mock('./asr', async original => ({
  ...await original<typeof import('./asr')>(),
  createOnlineRecognizer: vi.fn(),
}))

const module = {} as WebAssemblyModule
function nativeFixture() {
  let ready = false
  let partial = ''
  const stream = {
    handle: 1,
    acceptWaveform: vi.fn((_rate: number, _samples: Float32Array) => { ready = true }),
    setOption: vi.fn(),
    inputFinished: vi.fn(),
    free: vi.fn(),
  }
  const native = {
    config: { featConfig: { sampleRate: 16000 } },
    createStream: () => stream,
    isReady: () => ready,
    decode: vi.fn(() => { ready = false }),
    getResult: () => ({ text: partial }),
    isEndpoint: vi.fn(() => false),
    reset: vi.fn(),
    free: vi.fn(),
  }
  vi.mocked(createOnlineRecognizer).mockReturnValue(native as unknown as ReturnType<typeof createOnlineRecognizer>)
  return { native, stream, setText: (text: string) => {
    partial = text
  } }
}

beforeEach(() => vi.clearAllMocks())

it('waits for suspended inference before finishing or freeing the native stream', async () => {
  const { native, stream, setText } = nativeFixture()
  let resume!: () => void
  const suspended = new Promise<void>((resolve) => {
    resume = resolve
  })
  const backend = {
    decode: vi.fn(async () => {
      await suspended
      native.decode()
      setText('final words')
    }),
    dispose: vi.fn(async () => {}),
  }
  const session = await createStreamingRecognizer(module, { type: OnlineRecognizerTypes.Paraformer }, backend)
  const accepting = session.accept(new Float32Array(320))
  await vi.waitFor(() => expect(backend.decode).toHaveBeenCalledOnce())
  const finishing = session.finish()
  const disposing = session.dispose()
  expect(session.dispose()).toBe(disposing)
  expect(stream.inputFinished).not.toHaveBeenCalled()
  expect(stream.free).not.toHaveBeenCalled()
  resume()
  expect(await accepting).toBe('final words')
  expect(await finishing).toBe('final words')
  await disposing
  expect(stream.setOption).toHaveBeenCalledWith('is_final', '1')
  expect(stream.acceptWaveform).toHaveBeenCalledOnce()
  expect(stream.free).toHaveBeenCalledOnce()
  expect(native.free).toHaveBeenCalledOnce()
  expect(backend.dispose).toHaveBeenCalledOnce()
  await expect(session.accept(new Float32Array())).rejects.toThrow('disposed')
})

it('keeps endpoint text and flushes the transducer tail exactly once', async () => {
  const { native, stream, setText } = nativeFixture()
  const session = await createStreamingRecognizer(module)
  setText('first')
  native.isEndpoint.mockReturnValueOnce(true)
  expect(await session.accept(new Float32Array(320))).toBe('first')
  expect(native.reset).toHaveBeenCalledOnce()
  setText('last')
  expect(await session.finish()).toBe('first last')
  expect(await session.finish()).toBe('first last')
  expect(stream.acceptWaveform.mock.calls.at(-1)).toEqual([16000, new Float32Array(16000)])
  expect(stream.inputFinished).toHaveBeenCalledOnce()
  expect(session.stats().decodedChunks).toBe(2)
  await session.dispose()
})

it('rejects a failed decode without publishing a result and still releases resources', async () => {
  const { native, stream } = nativeFixture()
  const getResult = vi.spyOn(native, 'getResult')
  const backend = {
    decode: vi.fn(async () => { throw new Error('GPU failed') }),
    dispose: vi.fn(async () => {}),
  }
  const session = await createStreamingRecognizer(module, undefined, backend)
  await expect(session.accept(new Float32Array(320))).rejects.toThrow('GPU failed')
  await expect(session.finish()).rejects.toThrow('GPU failed')
  expect(getResult).not.toHaveBeenCalled()
  await session.dispose()
  expect(stream.free).toHaveBeenCalledOnce()
  expect(native.free).toHaveBeenCalledOnce()
  expect(backend.dispose).toHaveBeenCalledOnce()
})

it('cleans up the recognizer and backend when native stream creation fails', async () => {
  const { native, stream } = nativeFixture()
  stream.handle = 0
  const backend = { decode: vi.fn(), dispose: vi.fn(async () => {}) }
  await expect(createStreamingRecognizer(module, undefined, backend)).rejects.toThrow('Failed to create the online stream')
  expect(native.free).toHaveBeenCalledOnce()
  expect(backend.dispose).toHaveBeenCalledOnce()
})
