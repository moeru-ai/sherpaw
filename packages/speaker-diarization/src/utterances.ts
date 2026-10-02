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
   * knows it. Undefined for Silero VAD, which reports speech up to about 1 s after it starts.
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

/**
 * Utterances from Silero VAD. The VAD reports an utterance as soon as the silence after it lasts
 * long enough. The caller keeps the VAD and frees it.
 */
export function sileroUtterances(vad: SileroVad): UtteranceDetector {
  let received = 0

  function drain() {
    const ended: SpeechSegment[] = []

    while (!vad.isEmpty()) {
      const { start, samples } = vad.front()

      vad.pop()
      ended.push({ start, samples })
    }

    return ended
  }

  return {
    async accept(block) {
      vad.acceptWaveform(block)
      received += block.length

      return drain()
    },
    async flush() {
      vad.flush()

      return drain()
    },
    speaking: () => vad.isDetected(),
    speechStart: () => undefined,
    decided: () => received,
    reset() {
      vad.reset()
      received = 0
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
