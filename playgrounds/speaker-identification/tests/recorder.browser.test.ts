import type { Extractor } from '@sherpaw/speaker-identification'

import { loadVirtualData } from '@sherpaw/preloader'
import { createExtractor, initSpeakerIdentificationModule } from '@sherpaw/speaker-identification'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { modelUrl, readAudio } from '../../../packages/speaker-identification/tests/audio'
import { normalizeRecording, startRecording } from '../src/recorder'

let extractor: Extractor

beforeAll(async () => {
  const module = await initSpeakerIdentificationModule()
  const response = await fetch(modelUrl)
  if (!response.ok)
    throw new Error('Run test:prepare to download the speaker model')
  loadVirtualData({ module, virtualData: { 'speaker.onnx': new Uint8Array(await response.arrayBuffer()) } })
  extractor = createExtractor(module, { model: 'speaker.onnx' })
})
afterAll(() => extractor?.dispose())

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
