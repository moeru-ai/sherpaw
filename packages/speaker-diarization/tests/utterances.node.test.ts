import { describe, expect, it } from 'vitest'

import type { SileroVad } from '../src/conversation'

import { sileroUtterances } from '../src/conversation'

const rate = 16000

class FakeVad implements SileroVad {
  detected = false
  segments: Array<{ start: number, samples: Float32Array }> = []
  nextDetected = false

  acceptWaveform(_samples?: Float32Array) {
    this.detected = this.nextDetected
  }

  flush() {
    this.detected = false
  }

  isDetected() {
    return this.detected
  }

  isEmpty() {
    return this.segments.length === 0
  }

  front() {
    return this.segments[0]!
  }

  pop() {
    this.segments.shift()
  }

  reset() {
    this.detected = false
    this.segments = []
  }
}

function tracker(probabilities: Float32Array, reject = false) {
  const windows: Float32Array[] = []

  return {
    segmentation: true,
    windows,
    async speech(samples: Float32Array) {
      windows.push(samples)

      if (reject)
        throw new Error('speech failed')

      return probabilities
    },
  }
}

async function start(detector: ReturnType<typeof sileroUtterances>, vad: FakeVad, samples = new Float32Array(2000)) {
  vad.nextDetected = true
  await detector.accept(samples)
}

describe('silero utterances', () => {
  it('finds the start from the segmentation probabilities', async () => {
    const vad = new FakeVad()
    const source = tracker(Float32Array.from([0.1, 0.1, 0.9, 0.9, 0.1, 0.9]))
    const detector = sileroUtterances(vad, { tracker: source })

    await start(detector, vad)

    expect(detector.speechStart()).toBe(2 * 270 + 360)
  })

  it('bridges a dip shorter than 0.2 seconds but not a longer dip', async () => {
    const shortVad = new FakeVad()
    const shortSource = tracker(Float32Array.from([0.9, ...Array.from({ length: 11 }, () => 0.1), 0.9]))
    const shortDetector = sileroUtterances(shortVad, { tracker: shortSource })

    await start(shortDetector, shortVad)

    expect(shortDetector.speechStart()).toBe(360)

    const longVad = new FakeVad()
    const longSource = tracker(Float32Array.from([0.9, ...Array.from({ length: 12 }, () => 0.1), 0.9]))
    const longDetector = sileroUtterances(longVad, { tracker: longSource })

    await start(longDetector, longVad)

    expect(longDetector.speechStart()).toBe(13 * 270 + 360)
  })

  it('limits the window by the previous utterance end and four seconds', async () => {
    const vad = new FakeVad()
    const source = tracker(Float32Array.from([0.9]))
    const detector = sileroUtterances(vad, { tracker: source })

    await start(detector, vad, new Float32Array(3000).fill(1))
    vad.segments.push({ start: 0, samples: new Float32Array(1000) })
    await detector.flush()

    await start(detector, vad, new Float32Array(5000).fill(2))

    expect(source.windows[1]).toHaveLength(7000)
    expect(source.windows[1]![0]).toBe(1)

    vad.segments.push({ start: 3000, samples: new Float32Array(5000) })
    await detector.flush()

    await start(detector, vad, new Float32Array(70000).fill(3))

    expect(source.windows[2]).toHaveLength(4 * rate)
    expect(source.windows[2]![0]).toBe(3)
  })

  it('has no start without a usable tracker or after a rejected speech call', async () => {
    const noTrackerVad = new FakeVad()
    const noTracker = sileroUtterances(noTrackerVad)
    const noSegmentationVad = new FakeVad()
    const noSegmentation = sileroUtterances(noSegmentationVad, {
      tracker: {
        segmentation: false,
        async speech() {
          return new Float32Array()
        },
      },
    })
    const rejectedVad = new FakeVad()
    const rejected = sileroUtterances(rejectedVad, { tracker: tracker(new Float32Array(), true) })

    await start(noTracker, noTrackerVad)
    await start(noSegmentation, noSegmentationVad)
    await start(rejected, rejectedVad)

    expect(noTracker.speechStart()).toBeUndefined()
    expect(noSegmentation.speechStart()).toBeUndefined()
    expect(rejected.speechStart()).toBeUndefined()
  })

  it('clears the start when an utterance ends and on reset', async () => {
    const vad = new FakeVad()
    const detector = sileroUtterances(vad, { tracker: tracker(Float32Array.from([0.9])) })

    await start(detector, vad)
    expect(detector.speechStart()).toBe(360)

    vad.segments.push({ start: 0, samples: new Float32Array(2000) })
    await detector.flush()
    expect(detector.speechStart()).toBeUndefined()

    await start(detector, vad)
    detector.reset()
    expect(detector.speechStart()).toBeUndefined()
  })

  it('restarts the VAD in a silence before its int32 sample count overflows, and keeps positions', async () => {
    // Like sherpa-onnx's VAD: positions count from its last reset, and 2^31 samples break it.
    class CountingVad extends FakeVad {
      count = 0
      resets = 0

      override acceptWaveform(samples: Float32Array) {
        super.acceptWaveform()
        this.count += samples.length

        if (this.count >= 2 ** 31)
          throw new Error('int32 overflow')
      }

      override reset() {
        super.reset()
        this.count = 0
        this.resets++
      }
    }

    const vad = new CountingVad()
    const detector = sileroUtterances(vad)
    const block = new Float32Array(2 ** 24)

    // 3 * 2^30 samples of silence, more than the VAD can count: it restarts after every 2^30.
    for (let i = 0; i < 193; i++)
      await detector.accept(block)

    expect(vad.resets).toBe(3)
    expect(detector.decided()).toBe(3 * 2 ** 30 + 2 ** 24)

    // An utterance that the restarted VAD reports 1 s before its own count.
    vad.segments.push({ start: vad.count - rate, samples: new Float32Array(rate / 2) })

    const [utterance] = await detector.accept(new Float32Array(rate / 10))

    expect(utterance!.start).toBe(3 * 2 ** 30 + 2 ** 24 - rate)
  })

  it('validates the onset threshold', () => {
    const vad = new FakeVad()

    expect(() => sileroUtterances(vad, { onsetThreshold: 0 })).toThrow(RangeError)
    expect(() => sileroUtterances(vad, { onsetThreshold: 1 })).toThrow(RangeError)
    expect(() => sileroUtterances(vad, { onsetThreshold: -0.1 })).toThrow(RangeError)
    expect(() => sileroUtterances(vad, { onsetThreshold: 1.1 })).toThrow(RangeError)
  })
})
