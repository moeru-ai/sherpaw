import type { StreamingRecognizer } from '@sherpaw/asr'
import type { StreamingDiarizer } from '@sherpaw/speaker-diarization/conversation'

import { createTokenTimeline } from '@sherpaw/asr/tokens'

const SAMPLE_RATE = 16000
// The recognizer's endpoint rule needs 0.8 s of trailing silence. The 480 ms X-ASR chunks also come
// late, so 1 s was not always enough.
const FINISH = 2 * SAMPLE_RATE

/** What the transcript reports. Turn indexes are the diarizer's. */
export interface TranscriptHandlers {
  /** A turn's words changed, or they became final because the recognizer heard the whole utterance. */
  turn: (index: number, text: string, final: boolean) => void
  /** The words of the turn in progress changed. */
  live: (text: string) => void
  error: (error: unknown) => void
}

export interface TurnTranscript {
  /** Resolves when the recognizer has handled the audio so far. */
  flush: () => Promise<void>
  /** Drops the words of the old conversation. Call it together with the diarizer's `reset`. */
  reset: () => void
  /** Stops listening to the diarizer. The caller keeps the recognizer. */
  dispose: () => void
}

/**
 * Words for the turns of a streaming diarizer. The recognizer hears the diarizer's `audio` events,
 * and a token timeline puts each word into the turn whose audio produced it.
 */
export function transcribeTurns(
  diarizer: Pick<StreamingDiarizer, 'on'>,
  recognizer: Pick<StreamingRecognizer, 'accept' | 'tokens' | 'received'>,
  handlers: TranscriptHandlers,
  lagSeconds = 0.2,
): TurnTranscript {
  const timeline = createTokenTimeline(SAMPLE_RATE, lagSeconds)
  /** Session positions where the turns start, by turn index. */
  let starts: number[] = []
  let texts: string[] = []
  let finals: boolean[] = []
  let live = ''
  /** Where the turn in progress starts, while an utterance goes on. */
  let liveFrom: number | undefined
  let queue = Promise.resolve()
  let generation = 0

  /** Runs the recognizer steps one at a time, in order. A step of an old session stops after its await. */
  function enqueue(step: (session: number) => Promise<void>) {
    const session = generation

    queue = queue.then(() => step(session)).catch(handlers.error)
  }

  /** Triggering workflow: recognizer reply -> {@link place} -> the words of the open turns and of the turn in progress. */
  function place() {
    const open = finals.findIndex(final => !final)
    // Only open turns change. The turn before them can still get the final mark of its sentence.
    const from = Math.max(0, (open < 0 ? starts.length : open) - 1)
    const placed = timeline.place(recognizer.tokens(), starts.slice(from), liveFrom)

    placed.rows.forEach((text, i) => {
      if (texts[from + i] !== text) {
        texts[from + i] = text
        handlers.turn(from + i, text, finals[from + i]!)
      }
    })

    if (placed.live !== live) {
      live = placed.live
      handlers.live(live)
    }
  }

  const stops = [
    diarizer.on('speech-start', ({ time }) => {
      liveFrom = Math.round(time * SAMPLE_RATE)
    }),
    diarizer.on('turn-update', ({ turn, changed }) => {
      if (!changed.includes('created'))
        return

      starts[turn.index] = Math.round(turn.start * SAMPLE_RATE)
      texts[turn.index] = ''
      finals[turn.index] = false
      // The turn in progress goes on after a cut.
      liveFrom = Math.round(turn.end * SAMPLE_RATE)
    }),
    diarizer.on('audio', ({ time, samples }) => enqueue(async (session) => {
      await recognizer.accept(samples)

      if (session !== generation)
        return

      // The recognizer can hold audio of an earlier conversation, so its own count places this audio.
      timeline.hear(Math.round(time * SAMPLE_RATE), recognizer.received() - samples.length, samples.length)
      place()
    })),
    diarizer.on('speech-end', () => {
      const count = starts.length

      liveFrom = undefined
      enqueue(async (session) => {
        // The recognizer gives the last words of the utterance only after silence.
        await recognizer.accept(new Float32Array(FINISH))

        if (session !== generation)
          return

        place()

        for (let index = 0; index < count; index++) {
          if (!finals[index]) {
            finals[index] = true
            handlers.turn(index, texts[index]!, true)
          }
        }
      })
    }),
  ]

  return {
    flush: () => queue,

    reset() {
      // Silence also ends an utterance in progress in the recognizer. Its last tokens then come well
      // before the new audio, so the timeline does not take them for the first words of the new session.
      if (liveFrom !== undefined)
        enqueue(async () => void await recognizer.accept(new Float32Array(FINISH)))

      generation++
      timeline.reset()
      starts = []
      texts = []
      finals = []
      live = ''
      liveFrom = undefined
    },

    dispose() {
      generation++
      stops.forEach(stop => stop())
    },
  }
}
