import { beforeEach, expect, it, vi } from 'vitest'

const disposeSpy = vi.fn()
let pushAudioError: Error | null = null

class FakeStreamingTranscriptionSession {
  pushAudio() {
    if (pushAudioError) {
      throw pushAudioError
    }
    return { text: '', isEndpoint: false }
  }

  finish() {
    return { text: 'done', sentenceCount: 1 }
  }

  dispose() {
    disposeSpy()
  }
}

vi.mock('@sherpaw/asr', () => ({
  initASRModule: vi.fn(async () => ({})),
}))

vi.mock('@sherpaw/preloader', () => ({
  loadData: vi.fn(),
}))

vi.mock('./session', () => ({
  StreamingTranscriptionSession: FakeStreamingTranscriptionSession,
}))

const { transcribeOnce } = await import('./core')

beforeEach(() => {
  disposeSpy.mockClear()
  pushAudioError = null
})

it('disposes the session when transcribeOnce fails while pushing audio', async () => {
  pushAudioError = new Error('push failed')

  await expect(transcribeOnce({
    metadata: { files: [], remote_package_size: 0 },
    data: new ArrayBuffer(0),
    audio: new Float32Array([0, 0.1]),
  })).rejects.toThrow('push failed')

  expect(disposeSpy).toHaveBeenCalledTimes(1)
})
