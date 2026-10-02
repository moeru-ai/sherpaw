import type { TimedToken } from '@sherpaw/asr/tokens'
import type { SpeakerGuess, SpeakerTracker, SpeakerTurn } from '@sherpaw/speaker-diarization'
import type { StreamingDiarizer, UtteranceDetector } from '@sherpaw/speaker-diarization/conversation'

import { createStreamingDiarizer } from '@sherpaw/speaker-diarization/conversation'
import { describe, expect, it } from 'vitest'

import { transcribeTurns } from '../../src/features/speaker-diarization/transcript'

const rate = 16000
const block = rate / 10

// Each test voice is audio of one constant level: voice 1 is 0.1, voice 2 is 0.2. Silence is 0.
function voice(level: number, seconds: number) {
  return new Float32Array(Math.round(seconds * rate)).fill(level / 10)
}

function join(...parts: Float32Array[]) {
  const audio = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0

  for (const part of parts) {
    audio.set(part, at)
    at += part.length
  }

  return audio
}

/** The main voice of some audio, or null for silence. */
function levelOf(samples: Float32Array): number | null {
  const counts = new Map<number, number>()

  for (const value of samples) {
    if (value !== 0)
      counts.set(Math.round(value * 10), (counts.get(Math.round(value * 10)) ?? 0) + 1)
  }

  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Like Silero VAD: an utterance ends after 0.5 s of silence, and speech is known in the block that holds it. */
function fakeDetector(): UtteranceDetector {
  let received = 0
  let speaking = false
  let start = 0
  let silence = 0
  let chunks: Float32Array[] = []

  function end() {
    const audio = join(...chunks)

    speaking = false

    return [{ start, samples: audio.subarray(0, audio.length - silence) }]
  }

  return {
    async accept(samples) {
      const voiced = samples.some(value => value !== 0)
      let ended: Array<{ start: number, samples: Float32Array }> = []

      if (voiced && !speaking) {
        speaking = true
        start = received
        chunks = []
      }

      if (speaking) {
        chunks.push(samples)
        silence = voiced ? 0 : silence + samples.length

        if (silence >= rate / 2)
          ended = end()
      }

      received += samples.length

      return ended
    },
    flush: async () => (speaking ? end() : []),
    speaking: () => speaking,
    speechStart: () => undefined,
    decided: () => received,
    reset() {
      received = 0
      speaking = false
    },
  }
}

/** Labels turns by their main voice, and finds a change when the last two 1.5 s windows differ. */
function fakeTracker(): SpeakerTracker {
  let index = 0
  const window = 1.5 * rate

  return {
    segmentation: false,
    async track(samples) {
      return { index: index++, speaker: levelOf(samples), score: 0.9, confidence: 'high', pending: false, mixed: false, overlap: false, revisions: [] } satisfies SpeakerTurn
    },
    async peek(samples) {
      const before = samples.length >= 2 * window ? levelOf(samples.subarray(samples.length - 2 * window, samples.length - window)) : null
      const after = levelOf(samples.subarray(Math.max(0, samples.length - window)))
      const changed = before !== null && after !== null && before !== after

      return { speaker: after, score: 0.8, confidence: 'medium', changes: [], ...(changed ? { windowChange: (samples.length - window) / rate } : {}) } satisfies SpeakerGuess
    },
    async reset() {
      index = 0
    },
    async enroll() {
      return 0
    },
    async inspect() {
      return { units: [], speakers: [] }
    },
    async speech() {
      return new Float32Array(0)
    },
    // Cosine 1 for a window of the speaker's voice, 0 for another voice, NaN for silence.
    async similarity(samples, sampleRate, speaker, options = {}) {
      const size = Math.round((options.windowSeconds ?? 1) * sampleRate)
      const step = Math.round((options.stepSeconds ?? 0.25) * sampleRate)
      const count = samples.length < size ? 0 : Math.floor((samples.length - size) / step) + 1

      return Float32Array.from({ length: count }, (_, i) => {
        const level = levelOf(samples.subarray(i * step, i * step + size))

        return level === null ? Number.NaN : level === speaker ? 1 : 0
      })
    },
    dispose() {},
  }
}

/** Emits one token per 0.1 s of speech, named after its voice, `lag` seconds after the audio. Replies come in a later task. */
function fakeRecognizer(lag = 0.1) {
  const tokens: TimedToken[] = []
  let heard = 0
  // Audio of an unfinished 0.1 s block: like a real recognizer, it waits for the rest.
  let carry = new Float32Array(0)

  return {
    async accept(samples: Float32Array) {
      await new Promise(resolve => setTimeout(resolve, 0))

      const audio = join(carry, samples)
      const start = heard - carry.length
      let at = 0

      for (; at + block <= audio.length; at += block) {
        const level = levelOf(audio.subarray(at, at + block))

        if (level !== null)
          tokens.push({ text: ` w${level}`, time: (start + at) / rate + lag })
      }

      carry = audio.slice(at)
      heard += samples.length

      return ''
    },
    tokens: () => tokens,
    received: () => heard,
  }
}

interface Row {
  text: string
  final: boolean
}

function setUp(recognizer = fakeRecognizer(), { focus }: { focus?: number } = {}) {
  const diarizer = createStreamingDiarizer({ tracker: fakeTracker(), speech: fakeDetector(), ...(focus === undefined ? {} : { focus: { speaker: focus } }) })
  const rows: Row[] = []
  const live: string[] = []
  const transcript = transcribeTurns(diarizer, recognizer, {
    turn: (index, text, final) => rows[index] = { text, final },
    live: text => live.push(text),
    error: (error) => {
      throw error
    },
  })

  return { diarizer, transcript, rows, live }
}

/** Pushes the audio in 0.1 s blocks. By default, the recognizer replies between the blocks, as with a live microphone. */
async function feed(diarizer: StreamingDiarizer, audio: Float32Array, { replies = true } = {}) {
  for (let at = 0; at < audio.length; at += block) {
    await diarizer.push(audio.subarray(at, at + block))

    if (replies)
      await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/** The voices of a row's words, for example 'w1 w1 w2' -> [1, 1, 2]. */
function voicesOf(row: Row) {
  return row.text.split(' ').filter(Boolean).map(word => Number(word.slice(1)))
}

describe('turn transcript', () => {
  it('gives each turn the words of its audio, and marks them final after the utterance', async () => {
    const { diarizer, transcript, rows, live } = setUp()

    await feed(diarizer, join(voice(0, 1), voice(1, 2), voice(0, 1), voice(2, 1.5), voice(0, 1)))
    await diarizer.flush()
    await transcript.flush()

    expect(rows.map(row => row.final)).toEqual([true, true])
    expect(rows.map(voicesOf)).toEqual([Array.from({ length: 20 }, () => 1), Array.from({ length: 15 }, () => 2)])
    // The words of the turn in progress showed while it went on.
    expect(live.some(text => text.startsWith('w1'))).toBe(true)
  })

  it('keeps each word with its speaker where the diarizer cuts an utterance', async () => {
    const { diarizer, transcript, rows } = setUp()
    const speakers: Array<number | null> = []

    diarizer.on('turn', ({ turn }) => speakers[turn.index] = turn.speaker)
    await feed(diarizer, join(voice(0, 1), voice(1, 3), voice(2, 3), voice(0, 1)))
    await diarizer.flush()
    await transcript.flush()

    expect(speakers).toEqual([1, 2])

    rows.forEach((row, i) => {
      const voices = voicesOf(row)

      expect(voices.filter(v => v === speakers[i]).length / voices.length).toBeGreaterThanOrEqual(0.75)
    })

    expect(rows.flatMap(voicesOf)).toHaveLength(60)
  })

  it('places only its own words when the recognizer heard an earlier conversation', async () => {
    const recognizer = fakeRecognizer()
    const first = setUp(recognizer)

    await feed(first.diarizer, join(voice(0, 1), voice(1, 2), voice(0, 1)))
    await first.diarizer.flush()
    await first.transcript.flush()

    const { diarizer, transcript, rows } = setUp(recognizer)

    await feed(diarizer, join(voice(0, 1), voice(2, 2), voice(0, 1)))
    await diarizer.flush()
    await transcript.flush()

    expect(rows.map(voicesOf)).toEqual([Array.from({ length: 20 }, () => 2)])
  })

  it('drops the words of the old conversation on reset, also those that the recognizer still handles', async () => {
    const { diarizer, transcript, rows } = setUp()

    // The reset comes in the middle of an utterance, while the recognizer still handles its audio.
    await feed(diarizer, join(voice(0, 1), voice(1, 1.5)), { replies: false })

    const resetting = diarizer.reset()

    transcript.reset()
    await resetting
    rows.length = 0
    await feed(diarizer, join(voice(0, 1), voice(2, 2), voice(0, 1)))
    await diarizer.flush()
    await transcript.flush()

    expect(rows.map(voicesOf)).toEqual([Array.from({ length: 20 }, () => 2)])
  })

  it('transcribes only the focus speaker, also right after another voice without a pause', async () => {
    const { diarizer, transcript, rows } = setUp(fakeRecognizer(0.2), { focus: 1 })
    const speakers: Array<number | null> = []

    diarizer.on('turn', ({ turn }) => speakers[turn.index] = turn.speaker)
    // Voice 2 talks, voice 1 follows at once, voice 2 answers after a pause.
    await feed(diarizer, join(voice(0, 1), voice(2, 2), voice(1, 3), voice(0, 1), voice(2, 2), voice(0, 1)))
    await diarizer.flush()
    await transcript.flush()

    const words = rows.flatMap(voicesOf)

    expect(words.every(voice => voice === 1)).toBe(true)
    // The focus speaker's 3 s give 30 words.
    expect(words.length).toBeGreaterThanOrEqual(28)
    expect(rows.filter((_, i) => speakers[i] === 2).every(row => row.text === '')).toBe(true)
  })

  it('keeps late words in the focus speaker\'s turn', async () => {
    // The tokens come 0.5 s after their audio, 0.3 s later than the transcript expects.
    const { diarizer, transcript, rows } = setUp(fakeRecognizer(0.5), { focus: 1 })
    const speakers: Array<number | null> = []

    diarizer.on('turn', ({ turn }) => speakers[turn.index] = turn.speaker)
    await feed(diarizer, join(voice(0, 1), voice(1, 2), voice(2, 2), voice(1, 2), voice(0, 1)))
    await diarizer.flush()
    await transcript.flush()

    expect(speakers).toEqual([1, 2, 1])
    expect(rows[1]!.text).toBe('')
    expect(rows.flatMap(voicesOf).filter(voice => voice === 1)).toHaveLength(40)
  })
})
