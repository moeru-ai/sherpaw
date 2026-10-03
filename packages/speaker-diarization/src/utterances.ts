import type { SpeechDetectorOptions, SpeechSegment } from './speech-detector'
import type { SpeakerTracker } from './types'

import { createSpeechDetector } from './speech-detector'

/** Finds utterances in 16 kHz mono audio for `createStreamingDiarizer`. */
export interface UtteranceDetector {
  /** Adds a block of audio and resolves to the utterances that ended. */
  accept: (block: Float32Array) => Promise<SpeechSegment[]>
  /** Resolves to the utterances that end with the audio. */
  flush: () => Promise<SpeechSegment[]>
  /** Someone speaks at the last decided sample. */
  speaking: () => boolean
  /**
   * The first sample of the ongoing utterance, counted from the first block, when the detector
   * knows it. `sileroUtterances` finds it with a tracker that runs the segmentation model.
   * Otherwise it is undefined.
   */
  speechStart: () => number | undefined
  /** Audio before this sample is final. Cuts happen only there. */
  decided: () => number
  /** Forgets all audio; the next block starts at sample 0. */
  reset: () => void
}

/** The part of a Silero VAD from `@sherpaw/vad` (`createVad`) that `sileroUtterances` uses. */
export interface SileroVad {
  acceptWaveform: (samples: Float32Array) => void
  flush: () => void
  isDetected: () => boolean
  isEmpty: () => boolean
  front: () => { start: number, samples: Float32Array }
  pop: () => void
  reset: () => void
}

export interface SileroUtteranceOptions {
  /** A tracker that runs the segmentation model and locates the start of the current utterance. */
  tracker?: Pick<SpeakerTracker, 'segmentation' | 'speech'>
  /** A segmentation frame is speech at this probability or more. Default: 0.6. */
  onsetThreshold?: number
}

/**
 * Utterances from Silero VAD. The VAD reports an utterance as soon as the silence after it lasts
 * long enough. The caller keeps the VAD and frees it.
 */
export function sileroUtterances(vad: SileroVad, options: SileroUtteranceOptions = {}): UtteranceDetector {
  const threshold = options.onsetThreshold ?? 0.6

  if (!(threshold > 0 && threshold < 1))
    throw new RangeError('onsetThreshold must be between 0 and 1')

  let received = 0
  let previousEnd = 0
  let speechStart: number | undefined
  /** The last 4 seconds of accepted audio. */
  let chunks: Float32Array[] = []
  let offset = 0

  function append(block: Float32Array) {
    chunks.push(block.slice())
    received += block.length

    const keep = Math.max(0, received - 4 * 16000)

    while (chunks.length && offset + chunks[0]!.length <= keep)
      offset += chunks.shift()!.length

    if (chunks.length && offset < keep) {
      chunks[0] = chunks[0]!.slice(keep - offset)
      offset = keep
    }
  }

  function range(from: number, to: number) {
    const samples = new Float32Array(to - from)
    let at = offset

    for (const chunk of chunks) {
      const start = Math.max(from, at)
      const end = Math.min(to, at + chunk.length)

      if (end > start)
        samples.set(chunk.subarray(start - at, end - at), start - from)

      at += chunk.length

      if (at >= to)
        break
    }

    return samples
  }

  function findStart(probabilities: Float32Array, windowStart: number) {
    let last = probabilities.length - 1

    while (last >= 0 && probabilities[last]! < threshold && (probabilities.length - 1 - last) * 270 / 16000 < 0.3)
      last--

    if (last < 0 || probabilities[last]! < threshold)
      return undefined

    let start = last
    let silence = 0

    for (let frame = last - 1; frame >= 0; frame--) {
      if (probabilities[frame]! >= threshold) {
        start = frame
        silence = 0
      }
      else {
        silence++

        if (silence * 270 / 16000 >= 0.2)
          break
      }
    }

    return Math.max(windowStart, windowStart + start * 270 + 495 - 135)
  }

  async function locateStart() {
    const tracker = options.tracker

    if (!tracker?.segmentation)
      return

    const start = Math.max(previousEnd, received - 4 * 16000)
    const samples = range(start, received)

    if (samples.length < 1982)
      return

    try {
      speechStart = findStart(await tracker.speech(samples, 16000), start)
    }
    catch {
      // The VAD still detects utterances if the tracker cannot inspect this window.
    }
  }

  function drain() {
    const ended: SpeechSegment[] = []

    while (!vad.isEmpty()) {
      const { start, samples } = vad.front()

      vad.pop()
      ended.push({ start, samples })
      previousEnd = start + samples.length
    }

    if (ended.length)
      speechStart = undefined

    return ended
  }

  return {
    async accept(block) {
      const wasDetected = vad.isDetected()

      vad.acceptWaveform(block)
      append(block)
      const ended = drain()

      if (!vad.isDetected())
        speechStart = undefined

      if (!wasDetected && vad.isDetected())
        await locateStart()

      return ended
    },
    async flush() {
      vad.flush()

      const ended = drain()

      if (!vad.isDetected())
        speechStart = undefined

      return ended
    },
    speaking: () => vad.isDetected(),
    speechStart: () => speechStart,
    decided: () => received,
    reset() {
      vad.reset()
      received = 0
      previousEnd = 0
      speechStart = undefined
      chunks = []
      offset = 0
    },
  }
}

/**
 * Utterances from the segmentation model's speech probabilities, which the tracker computes in its
 * Worker (`createSpeechDetector`). Use it where Silero VAD misses speech, such as films with music.
 */
export function segmentationUtterances(tracker: SpeakerTracker, options?: SpeechDetectorOptions): UtteranceDetector {
  const detector = createSpeechDetector(tracker, options)

  return {
    accept: block => detector.accept(block),
    flush: () => detector.flush(),
    speaking: () => detector.speechStart !== undefined,
    speechStart: () => detector.speechStart,
    decided: () => detector.decided,
    reset: () => detector.reset(),
  }
}
