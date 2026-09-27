import type { DataMetadata } from '@sherpaw/preloader'
import type { Buffer } from 'node:buffer'

import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'

import type { KeywordEntry } from '../src/types'

// Exercise the published Node entry, its worker script, and its WASM asset.
// eslint-disable-next-line antfu/no-import-dist
import { createKeywordSpotter } from '../dist/node.js'

const directory = 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20'
const first: KeywordEntry = { matches: [{ tokens: ['zh', 'ōu', 'w', 'àng', 'j', 'ūn'] }], label: 'first' }
const second: KeywordEntry = { matches: [{ tokens: ['l', 'uò', 'sh', 'í'] }], label: 'second' }
const english: KeywordEntry = { matches: [{ tokens: ['L', 'AY1', 'T', 'AH1', 'P'] }], label: 'LIGHT UP' }

/** Decode the upstream mono PCM16 fixtures and append streaming tail silence. */
async function readAudio(filename: string): Promise<Float32Array> {
  const wav = await readFile(new URL(`./models/${directory}/test_wavs/${filename}`, import.meta.url))

  expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
  expect(wav.toString('ascii', 8, 12)).toBe('WAVE')

  let pcm: Buffer | undefined
  let sampleRate = 0

  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunk = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    const start = offset + 8

    if (chunk === 'fmt ') {
      expect(wav.readUInt16LE(start)).toBe(1)
      expect(wav.readUInt16LE(start + 2)).toBe(1)
      expect(wav.readUInt16LE(start + 14)).toBe(16)

      sampleRate = wav.readUInt32LE(start + 4)
    }

    if (chunk === 'data')
      pcm = wav.subarray(start, start + size)

    offset = start + size + (size % 2)
  }

  if (!pcm || sampleRate !== 16000)
    throw new Error(`Expected a 16 kHz PCM fixture: ${filename}`)

  const samples = new Float32Array(pcm.length / 2 + sampleRate)

  for (let index = 0; index < pcm.length / 2; index++)
    samples[index] = pcm.readInt16LE(index * 2) / 32768

  return samples
}

describe('published Node worker', () => {
  let model: { data: Uint8Array, metadata: DataMetadata }
  let chinese: Float32Array
  let en: Float32Array

  beforeAll(async () => {
    const prefix = new URL(`../../../models/huggingface/${directory}/install/bin/wasm/`, import.meta.url)
    const [data, metadata, zhSamples, enSamples] = await Promise.all([
      readFile(new URL('preload.data', prefix)),
      readFile(new URL('preload.js.metadata', prefix), 'utf8'),
      readAudio('zh_5.wav'),
      readAudio('en_0.wav'),
    ])

    model = { data: new Uint8Array(data), metadata: JSON.parse(metadata) }
    chinese = zhSamples
    en = enSamples
  })

  it('detects Chinese and English without detaching caller model or audio buffers', async () => {
    const modelSize = model.data.byteLength
    const spotter = await createKeywordSpotter({ model, keywords: [first, second] })

    try {
      const original = chinese.slice()
      const hits = await spotter.processAudio(chinese.subarray(0), 16000)

      expect(hits.map(hit => hit.label)).toEqual([first.label, second.label])
      expect(hits[0].tokens).toEqual(first.matches[0].tokens)
      expect(hits[0].timestamps).toHaveLength(first.matches[0].tokens.length)
      expect(hits[0].startTime).toBeGreaterThanOrEqual(0)

      expect(model.data.byteLength).toBe(modelSize)
      expect(chinese).toEqual(original)

      await spotter.setKeywords([english])

      const mutableSamples = en.slice()
      const processing = spotter.processAudio(mutableSamples, 16000)

      mutableSamples.fill(0)

      expect((await processing).map(hit => hit.label)).toEqual([english.label])
      expect(mutableSamples.byteLength).toBe(en.byteLength)
    }
    finally {
      spotter.dispose()
    }
  }, 30000)

  it('snapshots shared model bytes and PCM views without taking caller buffers', async () => {
    const sharedBuffer = new SharedArrayBuffer(model.data.byteLength + 32)
    const sharedBytes = new Uint8Array(sharedBuffer, 16, model.data.byteLength)

    sharedBytes.set(model.data)

    const creating = createKeywordSpotter({ model: { ...model, data: sharedBytes }, keywords: [first, second] })

    sharedBytes.fill(0)

    const spotter = await creating

    try {
      const backing = new Float32Array(chinese.length + 16)

      backing.set(chinese, 8)

      const samples = backing.subarray(8, 8 + chinese.length)
      const processing = spotter.processAudio(samples, 16000)

      samples.fill(0)

      expect((await processing).map(hit => hit.label)).toEqual([first.label, second.label])

      expect(sharedBuffer.byteLength).toBe(model.data.byteLength + 32)
      expect(sharedBytes.byteLength).toBe(model.data.byteLength)
      expect(sharedBytes.every(value => value === 0)).toBe(true)

      expect(backing.length).toBe(chinese.length + 16)
      expect(samples.length).toBe(chinese.length)
      expect(samples.every(value => value === 0)).toBe(true)
    }
    finally {
      spotter.dispose()
    }
  }, 30000)

  it('orders replacements, audio, pause, and resume without requiring intervening awaits', async () => {
    const spotter = await createKeywordSpotter({ model, keywords: [first] })

    try {
      const update = spotter.setKeywords([second], { maxActivePaths: 8 })
      const afterUpdate = spotter.processAudio(chinese, 16000)
      const pause = spotter.setKeywords([])
      const whilePaused = spotter.processAudio(chinese, 16000)
      const resume = spotter.setKeywords([first])
      const afterResume = spotter.processAudio(chinese, 16000)
      const [, updatedHits, , pausedHits, , resumedHits] = await Promise.all([
        update,
        afterUpdate,
        pause,
        whilePaused,
        resume,
        afterResume,
      ])

      expect(updatedHits.map(hit => hit.label)).toEqual([second.label])

      expect(pausedHits).toEqual([])

      expect(resumedHits.map(hit => hit.label)).toEqual([first.label])
    }
    finally {
      spotter.dispose()
    }
  }, 30000)

  it('keeps the previous keywords after rejected updates and continues accepting requests', async () => {
    const spotter = await createKeywordSpotter({ model, keywords: [first] })

    try {
      await expect(spotter.setKeywords([{ label: 'invalid', matches: [{ tokens: ['NOT_A_MODEL_TOKEN'] }] }])).rejects.toThrow(/token/i)
      await expect(spotter.setKeywords([second], { maxActivePaths: 0 })).rejects.toThrow(/maxActivePaths/)
      expect((await spotter.processAudio(chinese, 16000)).map(hit => hit.label)).toEqual([first.label])

      await spotter.setKeywords([second])

      expect((await spotter.processAudio(chinese, 16000)).map(hit => hit.label)).toEqual([second.label])
    }
    finally {
      spotter.dispose()
    }
  }, 30000)

  it('resets the stream so a new recording can use a different sample rate', async () => {
    const spotter = await createKeywordSpotter({ model, keywords: [first] })

    try {
      await spotter.processAudio(new Float32Array(4800), 48000)

      await expect(spotter.processAudio(chinese, 16000)).rejects.toThrow(/sampleRate/)

      await spotter.reset()

      expect((await spotter.processAudio(chinese, 16000)).map(hit => hit.label)).toEqual([first.label])
    }
    finally {
      spotter.dispose()
    }
  }, 30000)

  it('rejects pending work on disposal and makes repeated disposal harmless', async () => {
    const spotter = await createKeywordSpotter({ model, keywords: [first] })
    const pending = Promise.allSettled([
      spotter.processAudio(chinese, 16000),
      spotter.setKeywords([second]),
      spotter.reset(),
    ])

    spotter.dispose()
    spotter.dispose()

    expect((await pending).map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected'])

    await expect(spotter.processAudio(chinese, 16000)).rejects.toThrow()
    await expect(spotter.setKeywords([first])).rejects.toThrow()
    await expect(spotter.reset()).rejects.toThrow()
  }, 30000)

  it('bounds outstanding audio requests and releases the queue slot after completion', async () => {
    const spotter = await createKeywordSpotter({ model, keywords: [first], maxPendingAudio: 1 })

    try {
      const firstRequest = spotter.processAudio(chinese, 16000)
      const rejectedRequest = spotter.processAudio(chinese, 16000)

      await expect(rejectedRequest).rejects.toThrow(/queue/i)
      expect((await firstRequest).map(hit => hit.label)).toEqual([first.label])

      expect((await spotter.processAudio(chinese, 16000)).map(hit => hit.label)).toEqual([first.label])
    }
    finally {
      spotter.dispose()
    }
  }, 30000)

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])('rejects an invalid audio queue limit (%s)', async (maxPendingAudio) => {
    await expect(createKeywordSpotter({ model, keywords: [first], maxPendingAudio })).rejects.toThrow(/maxPendingAudio/)
  })

  it('rejects initialization errors and can initialize a fresh worker afterward', async () => {
    await expect(createKeywordSpotter({ model, keywords: [] })).rejects.toThrow(/Initial keywords/)

    const spotter = await createKeywordSpotter({ model, keywords: [first] })

    try {
      expect(await spotter.processAudio(new Float32Array(1600), 16000)).toEqual([])
    }
    finally {
      spotter.dispose()
    }
  }, 30000)

  it('rejects already aborted and interrupted initialization', async () => {
    const alreadyAborted = new AbortController()

    alreadyAborted.abort()

    await expect(createKeywordSpotter({ model, keywords: [first], signal: alreadyAborted.signal })).rejects.toThrow()

    const interrupted = new AbortController()
    const creating = createKeywordSpotter({ model, keywords: [first], signal: interrupted.signal })
    const result = expect(creating).rejects.toThrow()

    interrupted.abort()

    await result
  }, 30000)

  it('uses the abort signal for the initialized detector lifetime', async () => {
    const controller = new AbortController()
    const spotter = await createKeywordSpotter({ model, keywords: [first], signal: controller.signal })
    const pending = Promise.allSettled([
      spotter.processAudio(chinese, 16000),
      spotter.reset(),
    ])

    controller.abort()

    expect((await pending).map(result => result.status)).toEqual(['rejected', 'rejected'])
    await expect(spotter.processAudio(chinese, 16000)).rejects.toThrow()

    spotter.dispose()
  }, 30000)
})
