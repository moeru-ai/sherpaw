import type { SpeakerTracker, SpeechSegment } from '@sherpaw/speaker-diarization'
import type { VadInstance } from '@sherpaw/vad'

import { createSpeechDetector } from '@sherpaw/speaker-diarization'

export type SpeechDetection = 'silero' | 'segmentation'

/** What the speaker tracking page needs from a speech detector. */
export interface UtteranceDetector {
  /** Adds a block of 16 kHz audio and resolves to the utterances that ended. */
  accept: (block: Float32Array) => Promise<SpeechSegment[]>
  /** Resolves to the utterances that end with the audio. */
  flush: () => Promise<SpeechSegment[]>
  /** Someone speaks at the last decided sample. */
  speaking: () => boolean
  /**
   * The first sample of the ongoing utterance, counted from the first block, when the detector
   * knows it. Undefined for Silero VAD, which reports speech about 0.25 s after it starts.
   */
  speechStart: () => number | undefined
  /** Audio before this sample is final. The page cuts utterances only there, like the simulations. */
  decided: () => number
  reset: () => void
  free: () => void
}

export const speechDetectionOptions: Array<{ value: SpeechDetection, title: string, detail: string }> = [
  { value: 'silero', title: 'Silero VAD', detail: 'Reacts fast. Can miss speech under music or sound effects.' },
  { value: 'segmentation', title: 'Segmentation model', detail: 'Finds more speech in films and TV. Utterances end about 1 s later.' },
]

/** Silero VAD from @sherpaw/vad. It reports a finished segment as soon as the silence lasts long enough. */
export function sileroDetector(vad: VadInstance): UtteranceDetector {
  let received = 0

  function drain() {
    const ended: SpeechSegment[] = []

    while (!vad.isEmpty()) {
      const segment = vad.front()

      vad.pop()
      ended.push({ start: segment.start, samples: segment.samples })
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
    reset: () => {
      vad.reset()
      received = 0
    },
    free: () => vad.free(),
  }
}

/** Utterances from the segmentation model's speech probabilities, computed in the tracker's Worker. */
export function segmentationDetector(tracker: SpeakerTracker, options: { threshold: number, minSilenceSeconds: number }): UtteranceDetector {
  const detector = createSpeechDetector(tracker, { ...options, minSpeechSeconds: 0.25, maxSpeechSeconds: 20 })

  return {
    accept: block => detector.accept(block),
    flush: () => detector.flush(),
    speaking: () => detector.speechStart !== undefined,
    speechStart: () => detector.speechStart,
    decided: () => detector.decided,
    reset: () => detector.reset(),
    free: () => {},
  }
}
