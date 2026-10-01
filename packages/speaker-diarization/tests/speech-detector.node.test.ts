import { describe, expect, it } from 'vitest'

import type { SpeechSegment } from '../src/speech-detector'

import { createSpeechDetector } from '../src/speech-detector'

const rate = 16000

/** Stands in for the segmentation model: a frame is speech where its receptive field is mostly non-zero. */
const source = {
  async speech(samples: Float32Array) {
    const frames = samples.length < 991 ? 0 : Math.floor((samples.length - 991) / 270) + 1

    return Float32Array.from({ length: frames }, (_, i) => {
      const field = samples.subarray(i * 270, i * 270 + 991)

      return field.filter(value => value !== 0).length / field.length
    })
  },
}

/** Audio that is non-zero inside the given [start, end) spans, in seconds. */
function audio(seconds: number, spans: Array<[number, number]>) {
  const samples = new Float32Array(seconds * rate)

  for (const [start, end] of spans)
    samples.fill(0.5, start * rate, end * rate)

  return samples
}

async function run(samples: Float32Array, block = 1600, options = {}) {
  const detector = createSpeechDetector(source, options)
  const segments: SpeechSegment[] = []
  const starts: Array<number | undefined> = []

  for (let i = 0; i < samples.length; i += block) {
    segments.push(...await detector.accept(samples.subarray(i, i + block)))
    starts.push(detector.speechStart)
  }

  segments.push(...await detector.flush())

  return { segments: segments.map(({ start, samples }) => [start / rate, (start + samples.length) / rate]), starts, detector }
}

describe('createSpeechDetector', () => {
  it('ends an utterance after enough silence and keeps shorter gaps inside it', async () => {
    const { segments } = await run(audio(8, [[1, 2], [2.3, 3], [4.2, 5], [6, 6.1]]))

    // The utterances are [1, 3] with its 0.3 s gap, then [4.2, 5]. The detector drops the 0.1 s burst. Edges are accurate to a frame (17 ms).
    expect(segments).toHaveLength(2)
    expect(segments[0]![0]).toBeCloseTo(1, 1)
    expect(segments[0]![1]).toBeCloseTo(3, 1)
    expect(segments[1]![0]).toBeCloseTo(4.2, 1)
    expect(segments[1]![1]).toBeCloseTo(5, 1)
  })

  it('reports ongoing speech after the decision delay and hands out the utterance audio', async () => {
    const samples = audio(6, [[1, 4]])
    const { segments, starts } = await run(samples)
    // One entry per 0.1 s block. The detector knows about speech 0.5 to 1.25 s after it starts.
    const first = starts.findIndex(start => start !== undefined)

    expect(first / 10).toBeGreaterThanOrEqual(1.4)
    expect(first / 10).toBeLessThanOrEqual(2.3)
    expect(starts[first]! / rate).toBeCloseTo(1, 1)
    expect(starts.at(-1)).toBeUndefined()
    expect(segments).toHaveLength(1)
  })

  it('splits long speech and handles input longer than the window', async () => {
    const { segments, detector } = await run(audio(25, [[0.5, 24.5]]), 12 * rate, { maxSpeechSeconds: 10 })

    expect(segments.map(([start, end]) => [Math.round(start * 10) / 10, Math.round(end * 10) / 10])).toEqual([[0.5, 10.5], [10.5, 20.5], [20.5, 24.5]])
    expect(detector.received).toBe(25 * rate)

    detector.reset()
    expect(detector.received).toBe(0)
    expect(await detector.accept(audio(2, [[0.2, 1]]))).toEqual([])
    expect((await detector.flush()).map(({ start }) => Math.round(start / rate * 10) / 10)).toEqual([0.2])
  })

  it('rejects impossible options', () => {
    expect(() => createSpeechDetector(source, { threshold: 1 })).toThrow('between 0 and 1')
    expect(() => createSpeechDetector(source, { windowSeconds: 11 })).toThrow('windowSeconds')
    expect(() => createSpeechDetector(source, { maxSpeechSeconds: 0.1 })).toThrow('maxSpeechSeconds')
    // Checks every 0.75 s that decide up to 0.5 s back need more than 1.25 s of audio per call.
    expect(() => createSpeechDetector(source, { windowSeconds: 1 })).toThrow('windowSeconds must exceed')
  })
})
