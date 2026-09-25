import { describe, expect, it, vi } from 'vitest'

import type { KeywordEntry, KWSModule } from './types'

import { encodeKeywords, readTokens } from './keywords'
import { createKeywordSpotter } from './spotter'

const model = { encoder: 'encoder', decoder: 'decoder', joiner: 'joiner', tokens: 'tokens' }
const keyword = { tokens: ['a'], label: 'first' }

function runtime() {
  let next = 4
  const allocated = new Set<number>()
  const detectors = new Set<number>()
  const streams = new Set<number>()
  const strings = new Map<number, string>()
  const configs: string[] = []
  const results: string[] = []
  const module = {
    FS: {
      analyzePath: () => ({ exists: true }),
      stat: () => ({ mode: 1, size: 10 }),
      isFile: () => true,
      readFile: () => '<blk> 0\na 1\nb 2\n',
    },
    HEAPF32: new Float32Array(4096),
    _malloc: vi.fn(() => {
      const ptr = next
      next += 128
      allocated.add(ptr)
      return ptr
    }),
    _free: vi.fn((ptr: number) => { expect(allocated.delete(ptr)).toBe(true) }),
    lengthBytesUTF8: (text: string) => new TextEncoder().encode(text).length,
    stringToUTF8: (text: string, ptr: number) => strings.set(ptr, text),
    UTF8ToString: (ptr: number) => strings.get(ptr),
    _SherpawCreateKeywordSpotter: vi.fn((_e, _d, _j, _t, k) => {
      configs.push(strings.get(k)!)
      const ptr = next++
      detectors.add(ptr)
      return ptr
    }),
    _SherpaOnnxDestroyKeywordSpotter: vi.fn((ptr: number) => { expect(detectors.delete(ptr)).toBe(true) }),
    _SherpaOnnxCreateKeywordStream: vi.fn(() => {
      const ptr = next++
      streams.add(ptr)
      return ptr
    }),
    _SherpaOnnxDestroyOnlineStream: vi.fn((ptr: number) => { expect(streams.delete(ptr)).toBe(true) }),
    _SherpaOnnxOnlineStreamAcceptWaveform: vi.fn(),
    _SherpaOnnxIsKeywordStreamReady: () => results.length > 0,
    _SherpaOnnxDecodeKeywordStream: vi.fn(),
    _SherpaOnnxResetKeywordStream: vi.fn(),
    _SherpawKeywordResultKeyword: (ptr: number) => {
      strings.set(1, JSON.parse(strings.get(ptr)!).keyword)
      return 1
    },
    _SherpawKeywordResultCount: (ptr: number) => JSON.parse(strings.get(ptr)!).tokens.length,
    _SherpawKeywordResultToken: (ptr: number, index: number) => {
      strings.set(1, JSON.parse(strings.get(ptr)!).tokens[index])
      return 1
    },
    _SherpawKeywordResultTimestamp: (ptr: number, index: number) => JSON.parse(strings.get(ptr)!).timestamps[index],
    _SherpawKeywordResultStartTime: (ptr: number) => JSON.parse(strings.get(ptr)!).start_time,
    _SherpaOnnxGetKeywordResult: () => {
      const ptr = next++
      allocated.add(ptr)
      strings.set(ptr, results.shift()!)
      return ptr
    },
    _SherpaOnnxDestroyKeywordResult: (ptr: number) => { expect(allocated.delete(ptr)).toBe(true) },
  }
  return { module, configs, results, allocated, detectors, streams, typed: module as unknown as KWSModule }
}

describe('keyword validation', () => {
  const vocabulary = readTokens('<blk> 0\na 1\nb 2\n')
  it.each([
    { tokens: [], label: 'empty' },
    { tokens: ['unknown'], label: 'bad' },
    { tokens: ['a\nb'], label: 'injection' },
    { tokens: ['a'], label: ' ' },
    { ...keyword, score: Number.NaN },
    { ...keyword, score: 0 },
    { ...keyword, score: 1e40 },
    { ...keyword, score: 1e-40 },
    { ...keyword, threshold: 0 },
    { ...keyword, threshold: -1 },
    { ...keyword, threshold: 1.1 },
    { ...keyword, threshold: Number.POSITIVE_INFINITY },
  ])('rejects malformed entries: %j', (entry) => {
    expect(() => encodeKeywords([entry], vocabulary)).toThrow()
  })
  it('rejects duplicate sequences, sparse input, and malformed token files', () => {
    expect(() => encodeKeywords([keyword, keyword], vocabulary)).toThrow(/Duplicate/)
    expect(() => encodeKeywords(Array.from({ length: 1 }) as KeywordEntry[], vocabulary)).toThrow()
    for (const text of ['', 'a', 'a 1\nb 1', 'a 1\na 2'])
      expect(() => readTokens(text)).toThrow()
  })
  it('preserves arbitrary labels without injecting them into native syntax', () => {
    const label = '你好 world\n@evil #0 :9 " \\ '
    const encoded = encodeKeywords([{ ...keyword, label }], vocabulary)
    expect(encoded.text).toBe('a :1 #0.25 @sherpaw_0')
    expect(encoded.labels.get('sherpaw_0')).toBe(label)
  })
})

describe('native ownership and updates', () => {
  it('rolls back failed allocation, detector and stream creation', async () => {
    const r = runtime()
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    r.module._malloc.mockReturnValueOnce(0)
    await expect(spotter.setKeywords([keyword])).rejects.toThrow(/allocate/)
    r.module._SherpawCreateKeywordSpotter.mockReturnValueOnce(0)
    await expect(spotter.setKeywords([keyword])).rejects.toThrow(/create keyword spotter/)
    r.module._SherpaOnnxCreateKeywordStream.mockReturnValueOnce(0)
    await expect(spotter.setKeywords([keyword])).rejects.toThrow(/create keyword stream/)
    expect(r.detectors.size).toBe(1)
    expect(r.streams.size).toBe(1)
    expect(r.allocated.size).toBe(0)
    await spotter.setKeywords([keyword])
    spotter.dispose()
    expect(r.detectors.size + r.streams.size + r.allocated.size).toBe(0)
  })

  it('copies requests, applies them in order, and recovers after rejection', async () => {
    const r = runtime()
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    const entry = { tokens: ['b'], label: 'second' }
    const first = spotter.setKeywords([entry])
    entry.tokens[0] = 'unknown'
    const invalid = spotter.setKeywords([entry])
    const pause = spotter.setKeywords([])
    await expect(invalid).rejects.toThrow(/unknown/)
    await first
    await pause
    expect(r.configs[1]).toContain('b :1')
    expect(r.detectors.size + r.streams.size).toBe(0)
    expect(spotter.processAudio(new Float32Array(16), 16000)).toEqual([])
    expect(r.module._SherpaOnnxOnlineStreamAcceptWaveform).not.toHaveBeenCalled()
    await spotter.setKeywords([keyword])
    spotter.dispose()
  })

  it('rejects pending requests on disposal, which is idempotent', async () => {
    const r = runtime()
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    const pending = spotter.setKeywords([keyword])
    spotter.dispose()
    spotter.dispose()
    await expect(pending).rejects.toThrow(/disposed/)
    await expect(spotter.setKeywords([])).rejects.toThrow(/disposed/)
    expect(() => spotter.processAudio(new Float32Array(), 16000)).toThrow(/disposed/)
    expect(r.detectors.size + r.streams.size + r.allocated.size).toBe(0)
  })

  it('returns every hit and resets between ready decode steps', () => {
    const r = runtime()
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    const hit = { keyword: 'sherpaw_0', tokens: ['a'], start_time: 2, timestamps: [0.4] }
    r.results.push(JSON.stringify(hit), JSON.stringify({ ...hit, keyword: '' }), JSON.stringify(hit))
    expect(spotter.processAudio(new Float32Array(32), 16000)).toEqual([
      { label: 'first', tokens: ['a'], startTime: 2, timestamps: [0.4] },
      { label: 'first', tokens: ['a'], startTime: 2, timestamps: [0.4] },
    ])
    expect(r.module._SherpaOnnxResetKeywordStream).toHaveBeenCalledTimes(2)
    expect(r.allocated.size).toBe(0)
    spotter.dispose()
  })

  it('frees native results and PCM when decoding or input throws', () => {
    const r = runtime()
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    r.module._SherpaOnnxOnlineStreamAcceptWaveform.mockImplementationOnce(() => {
      throw new Error('input')
    })
    expect(() => spotter.processAudio(new Float32Array(32), 16000)).toThrow('input')
    r.results.push('invalid JSON')
    expect(() => spotter.processAudio(new Float32Array(32), 16000)).toThrow()
    expect(r.allocated.size).toBe(0)
    spotter.dispose()
  })

  it('validates initial vocabulary and audio before native calls', () => {
    const r = runtime()
    expect(() => createKeywordSpotter(r.typed, { model, keywords: [] })).toThrow(/Initial/)
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 2])
      expect(() => spotter.processAudio(new Float32Array([value]), 16000)).toThrow(/PCM/)
    expect(() => spotter.processAudio(new Float32Array(1), 0)).toThrow(/sampleRate/)
    expect(r.module._SherpaOnnxOnlineStreamAcceptWaveform).not.toHaveBeenCalled()
    spotter.dispose()
  })

  it('guards sample rate changes before WASM and allows them after replacement', async () => {
    const r = runtime()
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    spotter.processAudio(new Float32Array(4), 48000)
    expect(() => spotter.processAudio(new Float32Array(4), 16000)).toThrow(/constant/)
    expect(r.module._SherpaOnnxOnlineStreamAcceptWaveform).toHaveBeenCalledTimes(1)
    await spotter.setKeywords([keyword])
    spotter.processAudio(new Float32Array(4), 16000)
    spotter.dispose()
  })

  it('preserves special tokens and native timestamp precision', () => {
    const r = runtime()
    const spotter = createKeywordSpotter(r.typed, { model, keywords: [keyword] })
    r.results.push(JSON.stringify({ keyword: 'sherpaw_0', tokens: ['"', '\\'], start_time: 0.125, timestamps: [0.125, 0.25] }))
    const [hit] = spotter.processAudio(new Float32Array(4), 16000)
    expect(hit.tokens).toEqual(['"', '\\'])
    expect(hit.timestamps).toEqual([0.125, 0.25])
    spotter.dispose()
  })
})
