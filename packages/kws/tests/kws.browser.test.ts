import { loadData } from '@sherpaw/preloader'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Detection, KeywordEntry, KeywordSpotter, KWSModel, KWSModule } from '../src/types'

// Exercise the published JS layout and its relative WASM URL, not only source.
// eslint-disable-next-line antfu/no-import-dist
import { createKeywordSpotter, initKWSModule } from '../dist/index.js'

const files = import.meta.glob<string>('./models/**/*.wav', { eager: true, query: '?url', import: 'default' })
const packs = import.meta.glob<string>('../../../models/huggingface/sherpa-onnx-kws-*/install/bin/wasm/preload.{data,js.metadata}', { eager: true, query: '?url', import: 'default' })
const first: KeywordEntry = { matches: [{ tokens: ['zh', 'ōu', 'w', 'àng', 'j', 'ūn'] }], label: '周望军' }
const second: KeywordEntry = { matches: [{ tokens: ['l', 'uò', 'sh', 'í'] }], label: '落实' }
const english: KeywordEntry = { matches: [{ tokens: ['L', 'AY1', 'T', 'AH1', 'P'] }], label: 'LIGHT UP' }

async function bytes(directory: string, filename: string): Promise<ArrayBuffer> {
  const url = files[`./models/${directory}/${filename}`]
  if (!url)
    throw new Error(`Run pnpm -F @sherpaw/kws test:prepare: missing ${filename}`)
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Run pnpm -F @sherpaw/kws test:prepare: ${response.status} ${filename}`)
  return response.arrayBuffer()
}

async function audio(directory: string, filename: string): Promise<Float32Array> {
  const buffer = await bytes(directory, `test_wavs/${filename}`)
  const context = new AudioContext({ sampleRate: 16000 })
  try {
    const decoded = await context.decodeAudioData(buffer)
    expect(decoded.numberOfChannels).toBe(1)
    // Streaming input has no end-of-file operation. Feed one second of silence
    // so the last keyword has enough trailing blanks and complete feature frames.
    const padded = new Float32Array(decoded.length + 16000)
    padded.set(decoded.getChannelData(0))
    return padded
  }
  finally {
    await context.close()
  }
}

function feed(spotter: KeywordSpotter, samples: Float32Array, sampleRate = 16000): Detection[] {
  const detections: Detection[] = []
  for (let start = 0; start < samples.length; start += 1600)
    detections.push(...spotter.processAudio(samples.subarray(start, start + 1600), sampleRate))
  return detections
}

describe.each([
  { directory: 'sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01', wav: '5.wav', miss: '4.wav', bilingual: false },
  { directory: 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20', wav: 'zh_5.wav', miss: 'zh_4.wav', bilingual: true },
])('$directory', ({ directory, wav, miss, bilingual }) => {
  let module: KWSModule
  let model: KWSModel
  let samples: Float32Array
  let unrelated: Float32Array
  beforeAll(async () => {
    module = await initKWSModule()
    const prefix = `../../../models/huggingface/${directory}/install/bin/wasm/preload`
    const [data, metadata] = await Promise.all([fetch(packs[`${prefix}.data`]), fetch(packs[`${prefix}.js.metadata`])])
    expect(data.ok && metadata.ok).toBe(true)
    loadData({ module, data: await data.arrayBuffer(), metadata: await metadata.json() })
    model = { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' }
    samples = await audio(directory, wav)
    unrelated = await audio(directory, miss)
  }, 120000)

  afterAll(() => {
    for (const path of Object.values(model ?? {}))
      module.FS.unlink(path)
  })

  it('detects Chinese, returns timestamps, and listens again after each hit', () => {
    const spotter = createKeywordSpotter(module, { model, keywords: [first, second] })
    try {
      const hits = feed(spotter, samples)
      expect(hits.map(hit => hit.label)).toEqual([first.label, second.label])
      expect(hits[0].tokens).toEqual(first.matches[0].tokens)
      expect(hits[0].timestamps).toHaveLength(first.matches[0].tokens.length)
      expect(hits[0].startTime).toBeGreaterThanOrEqual(0)
      expect(hits[0].timestamps[0]).toBeGreaterThan(0)
      expect(feed(spotter, samples).map(hit => hit.label)).toEqual([first.label, second.label])
    }
    finally {
      spotter.dispose()
    }
  })

  it('finds multiple hits within one processAudio call', () => {
    const spotter = createKeywordSpotter(module, { model, keywords: [first, second] })
    try {
      expect(spotter.processAudio(samples, 16000).map(hit => hit.label)).toEqual([first.label, second.label])
    }
    finally {
      spotter.dispose()
    }
  })

  it('maps multiple matches to one keyword and replaces the entire match group', async () => {
    const spotter = createKeywordSpotter(module, {
      model,
      keywords: [{ label: 'grouped', matches: [...first.matches, ...second.matches] }],
    })
    try {
      const hits = feed(spotter, samples)
      expect(hits.map(hit => hit.label)).toEqual(['grouped', 'grouped'])
      expect(hits.map(hit => hit.tokens)).toEqual([first.matches[0].tokens, second.matches[0].tokens])
      await spotter.setKeywords([{ label: 'grouped', matches: second.matches }])
      expect(feed(spotter, samples).map(hit => hit.tokens)).toEqual([second.matches[0].tokens])
    }
    finally {
      spotter.dispose()
    }
  })

  it('rejects invalid updates without losing the active keyword, replaces, pauses and resumes', async () => {
    const spotter = createKeywordSpotter(module, { model, keywords: [first] })
    try {
      expect(feed(spotter, unrelated)).toEqual([])
      expect(feed(spotter, new Float32Array(32000))).toEqual([])
      await expect(spotter.setKeywords([{ ...first, matches: [{ tokens: ['NOT_A_MODEL_TOKEN'] }] }])).rejects.toThrow(/token/)
      await expect(spotter.setKeywords([{ ...first, threshold: 2 }])).rejects.toThrow(/threshold/)
      expect(feed(spotter, samples).map(hit => hit.label)).toEqual([first.label])
      // Update with a partially accepted utterance: none of it may survive.
      spotter.processAudio(samples.subarray(0, 8000), 16000)
      await spotter.setKeywords([second])
      expect(feed(spotter, samples).map(hit => hit.label)).toEqual([second.label])
      await spotter.setKeywords([])
      expect(feed(spotter, samples)).toEqual([])
      await spotter.setKeywords([first])
      expect(feed(spotter, samples).map(hit => hit.label)).toEqual([first.label])
    }
    finally {
      spotter.dispose()
    }
  })

  it('releases every detector, stream and result across repeated updates', async () => {
    const create = vi.spyOn(module, '_SherpawCreateKeywordSpotter')
    const destroy = vi.spyOn(module, '_SherpaOnnxDestroyKeywordSpotter')
    const createStream = vi.spyOn(module, '_SherpaOnnxCreateKeywordStream')
    const destroyStream = vi.spyOn(module, '_SherpaOnnxDestroyOnlineStream')
    const result = vi.spyOn(module, '_SherpaOnnxGetKeywordResult')
    const freeResult = vi.spyOn(module, '_SherpaOnnxDestroyKeywordResult')
    const spotter = createKeywordSpotter(module, { model, keywords: [first] })
    try {
      for (let i = 0; i < 12; i++) {
        await spotter.setKeywords([i % 2 ? first : second])
        feed(spotter, samples)
      }
      const pending = spotter.setKeywords([first])
      spotter.dispose()
      spotter.dispose()
      await expect(pending).rejects.toThrow(/disposed/)
      expect(destroy.mock.calls.map(([ptr]) => ptr).sort()).toEqual(create.mock.results.map(r => r.value).sort())
      expect(destroyStream.mock.calls.map(([ptr]) => ptr).sort()).toEqual(createStream.mock.results.map(r => r.value).sort())
      expect(freeResult).toHaveBeenCalledTimes(result.mock.calls.length)
      expect(() => spotter.processAudio(samples, 16000)).toThrow(/disposed/)
    }
    finally {
      spotter.dispose()
      vi.restoreAllMocks()
    }
  }, 120000)

  if (bilingual) {
    it('resamples 48 kHz input and rejects rate changes without aborting the runtime', async () => {
      const spotter = createKeywordSpotter(module, { model, keywords: [first] })
      try {
        const upsampled = Float32Array.from({ length: samples.length * 3 }, (_, i) => samples[Math.floor(i / 3)])
        expect(feed(spotter, upsampled, 48000).map(hit => hit.label)).toEqual([first.label])
        expect(() => spotter.processAudio(samples, 16000)).toThrow(/constant/)
        await spotter.setKeywords([first])
        expect(feed(spotter, samples).map(hit => hit.label)).toEqual([first.label])
      }
      finally {
        spotter.dispose()
      }
    })

    it('detects English with caller labels containing spaces and switches languages', async () => {
      const spotter = createKeywordSpotter(module, { model, keywords: [english] })
      try {
        const en = await audio(directory, 'en_0.wav')
        expect(feed(spotter, en).map(hit => hit.label)).toEqual([english.label])
        await spotter.setKeywords([first])
        expect(feed(spotter, en)).toEqual([])
        expect(feed(spotter, samples).map(hit => hit.label)).toEqual([first.label])
      }
      finally {
        spotter.dispose()
      }
    })
  }
})
