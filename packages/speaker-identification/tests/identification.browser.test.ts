import { loadVirtualData } from '@sherpaw/preloader'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import type { Extractor, InMemoryDB, SpeakerIdentificationModule } from '../src'

import { createExtractor, createInMemoryDB, initSpeakerIdentificationModule } from '../src'
import { modelUrl, readAudio } from './audio'
import { normalizeRecording, startRecording } from './web/recorder'

let module: SpeakerIdentificationModule
let extractor: Extractor
let db: InMemoryDB
const embeddings = new Map<string, Float32Array>()

beforeAll(async () => {
  module = await initSpeakerIdentificationModule()
  const response = await fetch(modelUrl)
  if (!response.ok)
    throw new Error('Run test:prepare to download the speaker model')
  loadVirtualData({ module, virtualData: { 'speaker.onnx': new Uint8Array(await response.arrayBuffer()) } })
  extractor = createExtractor(module, { model: 'speaker.onnx' })
  db = createInMemoryDB(module, { dimension: extractor.dimension })
  for (const name of ['fangjun-sr-1', 'fangjun-sr-2', 'leijun-sr-1', 'leijun-sr-2', 'fangjun-test-sr-1', 'leijun-test-sr-1', 'liudehua-test-sr-1']) {
    const audio = await readAudio(name)
    embeddings.set(name, extractor.extract(audio.samples, audio.sampleRate))
  }
})
afterAll(() => {
  db?.dispose()
  extractor?.dispose()
})

function embedding(name: string): Float32Array {
  return embeddings.get(name)!
}

it('identifies held-out speakers, rejects an unknown speaker, and returns sorted scores', () => {
  expect(db.dimension).toBe(192)
  expect(db.identify(embedding('fangjun-test-sr-1'), 0.6)).toBeNull()
  expect(db.enroll('方俊 🐾', [embedding('fangjun-sr-1'), embedding('fangjun-sr-2')])).toBe(true)
  expect(db.enroll('leijun', [embedding('leijun-sr-1'), embedding('leijun-sr-2')])).toBe(true)
  expect(db.enroll('leijun', [embedding('fangjun-sr-1')])).toBe(false)
  expect(db.speakers).toEqual(['leijun', '方俊 🐾'])
  expect(db.identify(embedding('fangjun-test-sr-1'), 0.6)?.name).toBe('方俊 🐾')
  expect(db.identify(embedding('leijun-test-sr-1'), 0.6)?.name).toBe('leijun')
  expect(db.identify(embedding('liudehua-test-sr-1'), 0.6)).toBeNull()
  const matches = db.matches(embedding('fangjun-test-sr-1'), -1, 2)
  expect(matches).toHaveLength(2)
  expect(matches[0].score).toBeGreaterThan(matches[1].score)
  expect(matches[0].score).toBeCloseTo(0.853525, 3)
  expect(db.verify('方俊 🐾', embedding('fangjun-test-sr-1'), 0.6)).toBe(true)
  expect(db.verify('leijun', embedding('fangjun-test-sr-1'), 0.6)).toBe(false)
  expect(db.verify('missing', embedding('fangjun-test-sr-1'), 0.6)).toBe(false)
  expect(db.contains('方俊 🐾')).toBe(true)
  expect(db.remove('方俊 🐾')).toBe(true)
  expect(db.remove('方俊 🐾')).toBe(false)
  expect(db.contains('方俊 🐾')).toBe(false)
  expect(db.speakers).toEqual(['leijun'])
  db.remove('leijun')
})

it('rejects invalid input before crossing the native boundary', () => {
  expect(() => createExtractor(module, { model: 'missing.onnx' })).toThrow('not loaded')
  expect(() => extractor.extract(new Float32Array(100), 16000)).toThrow('at least')
  expect(() => extractor.extract(new Float32Array(16000), 16000)).toThrow('silence')
  expect(() => extractor.extract(new Float32Array(16000).fill(Number.NaN), 16000)).toThrow('finite')
  expect(() => extractor.extract(new Float32Array(16000).fill(2), 16000)).toThrow('between')
  expect(() => extractor.extract(new Float32Array(16000), 0)).toThrow('sampleRate')
  expect(() => db.enroll('a\0b', [embedding('fangjun-sr-1')])).toThrow('NUL')
  expect(() => db.enroll('a', [])).toThrow('at least one')
  expect(() => db.enroll('a', [new Float32Array(192)])).toThrow('nonzero')
  expect(() => db.enroll('a', [new Float32Array(12)])).toThrow('192')
  expect(() => db.identify(embedding('fangjun-sr-1'), Number.NaN)).toThrow('threshold')
  expect(() => db.matches(embedding('fangjun-sr-1'), 0.6, 0)).toThrow('count')
})

it('keeps copied embeddings valid across later calls and releases native resources', async () => {
  const audio = await readAudio('fangjun-test-sr-1')
  const expected = embedding('fangjun-test-sr-1').slice()
  for (let i = 0; i < 10; i++) {
    const actual = extractor.extract(audio.samples, audio.sampleRate)
    expect(actual).toEqual(expected)
  }
  const other = createExtractor(module, { model: 'speaker.onnx' })
  const otherDB = createInMemoryDB(module, { dimension: other.dimension })
  try {
    const saved = other.extract(audio.samples, audio.sampleRate)
    expect(otherDB.enroll('a', [saved])).toBe(true)
    other.dispose()
    other.dispose()
    expect(() => other.extract(audio.samples, audio.sampleRate)).toThrow('disposed')
    expect(otherDB.identify(saved, 0.6)?.name).toBe('a')
    otherDB.dispose()
    otherDB.dispose()
    expect(() => otherDB.enroll('a', [saved])).toThrow('disposed')
    expect(() => otherDB.identify(saved, 0.6)).toThrow('disposed')
    expect(() => otherDB.speakers).toThrow('disposed')
    expect(extractor.extract(audio.samples, audio.sampleRate)).toEqual(expected)
    expect(saved).toEqual(expected)
  }
  finally {
    otherDB.dispose()
    other.dispose()
  }
})

it('restores saved embeddings into a database without loading a model', async () => {
  const emptyModule = await initSpeakerIdentificationModule()
  const saved = JSON.stringify({
    name: 'saved speaker',
    vectors: [Array.from(embedding('fangjun-sr-1')), Array.from(embedding('fangjun-sr-2'))],
  })
  const record = JSON.parse(saved) as { name: string, vectors: number[][] }
  const restored = createInMemoryDB(emptyModule, { dimension: 192 })
  try {
    expect(restored.enroll(record.name, record.vectors.map(vector => Float32Array.from(vector)))).toBe(true)
    const match = restored.identify(embedding('fangjun-test-sr-1'), 0.6)
    expect(match?.name).toBe(record.name)
    expect(match?.score).toBeCloseTo(0.853525, 3)
    expect(restored.identify(embedding('liudehua-test-sr-1'), 0.6)).toBeNull()
  }
  finally {
    restored.dispose()
  }
})

it('keeps independent databases isolated and validates their dimension', () => {
  for (const dimension of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x80000000])
    expect(() => createInMemoryDB(module, { dimension })).toThrow('dimension')
  const first = createInMemoryDB(module, { dimension: 192 })
  const second = createInMemoryDB(module, { dimension: 192 })
  try {
    first.enroll('a', [embedding('fangjun-sr-1')])
    expect(second.speakers).toEqual([])
    second.enroll('a', [embedding('leijun-sr-1')])
    first.dispose()
    expect(second.contains('a')).toBe(true)
    expect(second.identify(embedding('leijun-test-sr-1'), 0.6)?.name).toBe('a')
  }
  finally {
    first.dispose()
    second.dispose()
  }
})

it.each([0.5, 1.25])('accepts microphone audio with peak %s through the real recorder', async (inputPeak) => {
  const sourceContext = new AudioContext()
  const destination = sourceContext.createMediaStreamDestination()
  const oscillator = sourceContext.createOscillator()
  const gain = sourceContext.createGain()
  gain.gain.value = inputPeak
  oscillator.connect(gain).connect(destination)
  oscillator.start()
  await sourceContext.resume()
  const microphone = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(destination.stream)
  let recording: Awaited<ReturnType<typeof startRecording>> | undefined
  try {
    let enoughAudio!: () => void
    const captured = new Promise<void>((resolve) => {
      enoughAudio = resolve
    })
    recording = await startRecording((seconds) => {
      if (seconds >= 1.2)
        enoughAudio()
    })
    await captured
    const audio = await recording.stop()
    expect(audio.samples.every(Number.isFinite)).toBe(true)
    const peak = audio.samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)
    expect(peak).toBeCloseTo(Math.min(1, inputPeak), 2)
    // A legitimate floating-point Web Audio signal must not trigger the PCM range error.
    expect(() => extractor.extract(audio.samples, audio.sampleRate)).not.toThrow()
    expect(audio.samples.every(value => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true)
  }
  finally {
    await recording?.stop()
    microphone.mockRestore()
    destination.stream.getTracks().forEach(track => track.stop())
    await sourceContext.close()
  }
})

it('normalizes an entire 61.2-second recording without clipping or truncating it', async () => {
  const audio = await readAudio('fangjun-sr-1')
  const samples = new Float32Array(Math.round(61.2 * audio.sampleRate))
  for (let i = 0; i < samples.length; i++)
    samples[i] = audio.samples[i % audio.samples.length]
  // A late transient used to invalidate the entire minute of speech.
  samples[samples.length - 2] = 1.25
  samples[samples.length - 1] = -1.25
  const original = samples.slice()
  normalizeRecording(samples)
  expect(samples.length / audio.sampleRate).toBe(61.2)
  expect(samples).toEqual(original.map(value => value / 1.25))
  const vector = extractor.extract(samples, audio.sampleRate)
  expect(vector.length).toBe(extractor.dimension)
  expect(vector.every(Number.isFinite)).toBe(true)
})

it('preserves normal recording levels and rejects nonfinite device samples', () => {
  const samples = new Float32Array([0, 0.1, -0.5, 1, -1])
  const original = samples.slice()
  normalizeRecording(samples)
  expect(samples).toEqual(original)
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
    expect(() => normalizeRecording(new Float32Array([0.1, value]))).toThrow('无效数值')
})
