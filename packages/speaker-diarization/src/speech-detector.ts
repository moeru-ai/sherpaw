/**
 * Utterances from the segmentation model's speech probabilities, for audio in which Silero VAD
 * misses speech, such as films with music and effects. Every `checkSeconds`, the model looks at the
 * last `windowSeconds`. The detector decides a frame once `marginSeconds` of audio follow it. So each
 * decision comes `marginSeconds` to `marginSeconds + checkSeconds` after the audio.
 */

const SAMPLE_RATE = 16000
const FRAME_SHIFT = 270
const FRAME_CENTER = 495

export interface SpeechDetectorOptions {
  /**
   * A frame is speech at this probability or more. Default: 0.8, which gave about the same false
   * alarms as Silero VAD at 0.5 in films, meetings and talk shows. Lower values find more speech and
   * more non-speech.
   */
  threshold?: number
  /** Non-speech of at least this long ends an utterance. Shorter gaps stay inside it. Default: 0.5. */
  minSilenceSeconds?: number
  /** The detector drops shorter utterances. Default: 0.25. */
  minSpeechSeconds?: number
  /** The detector splits longer utterances. Default: 20. */
  maxSpeechSeconds?: number
  /** Audio that each model call looks at, at most 10 s. Default: 5. */
  windowSeconds?: number
  /** New audio between model calls. Default: 0.75. */
  checkSeconds?: number
  /** The detector decides a frame once this much audio follows it. Default: 0.5. */
  marginSeconds?: number
}

/** One utterance: `start` counts samples from the first accepted sample, or from the last `reset`. */
export interface SpeechSegment {
  start: number
  samples: Float32Array
}

export interface SpeechDetector {
  /** Adds 16 kHz mono PCM and resolves to the utterances that ended, in order. Call one at a time. */
  accept: (samples: Float32Array) => Promise<SpeechSegment[]>
  /** Decides the rest of the audio and resolves to the utterances that end with it. */
  flush: () => Promise<SpeechSegment[]>
  /** The first sample of the ongoing utterance once it is at least `minSpeechSeconds` long, or undefined. */
  readonly speechStart: number | undefined
  /** Samples accepted since the start or the last `reset`. */
  readonly received: number
  /** Samples before this one are final. Later samples can still start or end an utterance. */
  readonly decided: number
  /** Forgets all audio. The next sample is number 0. */
  reset: () => void
}

/** What the detector needs from a speaker tracker with the segmentation model. */
export interface SpeechSource {
  speech: (samples: Float32Array, sampleRate: number) => Promise<Float32Array>
}

export function createSpeechDetector(source: SpeechSource, options: SpeechDetectorOptions = {}): SpeechDetector {
  const threshold = options.threshold ?? 0.8
  const minSilence = Math.round((options.minSilenceSeconds ?? 0.5) * SAMPLE_RATE)
  const minSpeech = Math.round((options.minSpeechSeconds ?? 0.25) * SAMPLE_RATE)
  const maxSpeech = Math.round((options.maxSpeechSeconds ?? 20) * SAMPLE_RATE)
  const window = Math.round((options.windowSeconds ?? 5) * SAMPLE_RATE)
  const check = Math.round((options.checkSeconds ?? 0.75) * SAMPLE_RATE)
  const margin = Math.round((options.marginSeconds ?? 0.5) * SAMPLE_RATE)

  if (!(threshold > 0 && threshold < 1))
    throw new RangeError('threshold must be between 0 and 1')

  if (window < 2 * FRAME_CENTER || window > 10 * SAMPLE_RATE)
    throw new RangeError('windowSeconds must be between 0.07 and 10')

  if (!(check > 0) || margin < 0 || minSilence < 0 || minSpeech < 0 || !(maxSpeech > minSpeech))
    throw new RangeError('checkSeconds must be positive, the other durations must not be negative, and maxSpeechSeconds must exceed minSpeechSeconds')

  // Each call must reach back to the last decided frame, or the frames in between are never decided.
  if (window < check + margin + FRAME_SHIFT)
    throw new RangeError('windowSeconds must exceed checkSeconds + marginSeconds')

  /** Audio from sample `offset` on, in the blocks it arrived in: appending never copies earlier audio. */
  let chunks: Float32Array[] = []
  let offset = 0
  let received = 0
  let nextCheck = check
  /** Frames with their center before this sample are final. */
  let decided = 0
  /** The open utterance: its first speech sample and the end of its last speech frame. */
  let start: number | undefined
  let lastSpeech = 0

  function append(samples: Float32Array) {
    // A copy: the caller may reuse its buffer.
    chunks.push(samples.slice())
    received += samples.length

    const keep = keepFrom()

    while (chunks.length && offset + chunks[0]!.length <= keep)
      offset += chunks.shift()!.length
  }

  /** A copy of the audio between two sample positions. */
  function range(from: number, to: number): Float32Array {
    const out = new Float32Array(to - from)
    let at = offset

    for (const chunk of chunks) {
      const a = Math.max(from, at)
      const b = Math.min(to, at + chunk.length)

      if (b > a)
        out.set(chunk.subarray(a - at, b - at), a - from)

      at += chunk.length

      if (at >= to)
        break
    }

    return out
  }

  /** The oldest sample still needed: the open utterance, or the next model window. */
  function keepFrom() {
    return Math.min(start ?? Infinity, Math.max(0, received - window))
  }

  function segment(from: number, to: number): SpeechSegment {
    return { start: from, samples: range(from, to) }
  }

  /** Advances the utterance state by one decided frame that covers samples [from, to). */
  function step(from: number, to: number, speech: boolean, ended: SpeechSegment[]) {
    if (speech) {
      start ??= from
      lastSpeech = to

      if (lastSpeech - start >= maxSpeech) {
        ended.push(segment(start, start + maxSpeech))
        start += maxSpeech
      }
    }
    else if (start !== undefined && to - lastSpeech >= minSilence) {
      if (lastSpeech - start >= minSpeech)
        ended.push(segment(start, lastSpeech))

      start = undefined
    }
  }

  /**
   * Runs the model on the last window and decides the frames up to `until`. Windows start at
   * different offsets, so the frame grid of one call can differ from the previous one by up to a
   * frame. Each frame keeps the value from the first call that decides it.
   */
  async function decide(until: number, ended: SpeechSegment[]) {
    const from = Math.max(0, received - window)
    const probabilities = await source.speech(range(from, received), SAMPLE_RATE)

    for (let frame = 0; frame < probabilities.length; frame++) {
      const center = from + frame * FRAME_SHIFT + FRAME_CENTER

      if (center < decided)
        continue

      if (center >= until)
        break

      step(center - FRAME_SHIFT / 2, center + FRAME_SHIFT / 2, probabilities[frame]! >= threshold, ended)
      decided = center + 1
    }
  }

  return {
    async accept(samples) {
      const ended: SpeechSegment[] = []

      // Long input goes in steps of `checkSeconds`, so that every frame falls inside some window.
      for (let i = 0; i < samples.length; i += check) {
        append(samples.subarray(i, i + check))

        while (received >= nextCheck) {
          nextCheck += check
          await decide(received - margin, ended)
        }
      }

      return ended
    },

    async flush() {
      const ended: SpeechSegment[] = []

      if (received > decided)
        await decide(Infinity, ended)

      if (start !== undefined && lastSpeech - start >= minSpeech)
        ended.push(segment(start, lastSpeech))

      start = undefined
      decided = received

      return ended
    },

    get speechStart() {
      return start !== undefined && lastSpeech - start >= minSpeech ? start : undefined
    },

    get received() {
      return received
    },

    get decided() {
      return decided
    },

    reset() {
      chunks = []
      offset = 0
      received = 0
      nextCheck = check
      decided = 0
      start = undefined
      lastSpeech = 0
    },
  }
}
