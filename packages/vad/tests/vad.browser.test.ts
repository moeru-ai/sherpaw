import { expect, it } from 'vitest'

import { initVADModule } from '../src'
import { decodeWavPcm16, encodeWavPcm16 } from './helpers/wav'

it('runs in a browser context', () => {
  expect(window).toBeDefined()
})

it('encodes and decodes wav pcm16 data', () => {
  const sampleRate = 16000
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25, -0.25])
  const buffer = encodeWavPcm16(samples, sampleRate)
  const decoded = decodeWavPcm16(buffer)

  expect(decoded.sampleRate).toBe(sampleRate)
  expect(decoded.samples.length).toBe(samples.length)
  expect(decoded.samples[1]).toBeCloseTo(samples[1], 2)
})

it('initializes VAD module or reports a clear prebuilt-missing error', async () => {
  try {
    const vadModule = await initVADModule()
    expect(vadModule).toBeDefined()
  }
  catch (error) {
    expect(String(error)).toContain('Missing prebuilt VAD module')
  }
}, 120000)
