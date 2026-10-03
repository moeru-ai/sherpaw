import { describe, expect, it } from 'vitest'

import type { ConversationTurn, UtteranceDetector } from '../src/conversation'
import type { SpeakerGuess, SpeakerTracker, SpeakerTurn } from '../src/types'

import { createStreamingDiarizer } from '../src/conversation'

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

/**
 * Like Silero VAD: an utterance ends after 0.5 s of silence, and speech is known in the block that
 * holds it. With `startBefore`, the detector gives a start that many seconds before the voice.
 */
function fakeDetector({ startBefore }: { startBefore?: number } = {}): UtteranceDetector {
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
    speechStart: () => (speaking && startBefore !== undefined ? Math.max(0, start - Math.round(startBefore * rate)) : undefined),
    decided: () => received,
    reset() {
      received = 0
      speaking = false
    },
  }
}

/** Labels turns by their main voice, and finds a change when the last two 1.5 s windows differ. */
function fakeTracker(): SpeakerTracker & { resets: number } {
  let index = 0
  const window = 1.5 * rate

  return {
    segmentation: false,
    resets: 0,
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
      this.resets++
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

interface AudioEvent {
  time: number
  samples: Float32Array
  silent?: true
}

async function run(audio: Float32Array, { focus }: { focus?: number } = {}) {
  const tracker = fakeTracker()
  const diarizer = createStreamingDiarizer({ tracker, speech: fakeDetector(), ...(focus === undefined ? {} : { focus: { speaker: focus } }) })
  const turns: ConversationTurn[] = []
  const sent: AudioEvent[] = []

  diarizer.on('turn', event => turns.push(event.turn))
  diarizer.on('audio', event => sent.push(event))

  for (let at = 0; at < audio.length; at += block)
    await diarizer.push(audio.subarray(at, at + block))

  await diarizer.flush()

  return { diarizer, tracker, turns, sent }
}

/** Samples of one voice in the audio events that are not silent. */
function voiceSamples(events: AudioEvent[], level: number) {
  return events.filter(event => !event.silent).reduce((sum, event) => sum + event.samples.filter(value => Math.round(value * 10) === level).length, 0)
}

/** The audio events, joined where one event starts at the end of the one before it. */
function runsOf(events: AudioEvent[]) {
  const runs: AudioEvent[] = []

  for (const { time, samples } of events) {
    const last = runs.at(-1)

    if (last && Math.abs(last.time + last.samples.length / rate - time) < 1e-9)
      last.samples = join(last.samples, samples)
    else
      runs.push({ time, samples })
  }

  return runs
}

describe('streaming diarizer', () => {
  it('gives each utterance a turn with its speaker', async () => {
    const { turns } = await run(join(voice(0, 1), voice(1, 2), voice(0, 1), voice(2, 1.5), voice(0, 1)))

    expect(turns.map(turn => [turn.index, turn.speaker, turn.cause])).toEqual([[0, 1, 'pause'], [1, 2, 'pause']])
    expect(turns[0]!.start).toBeCloseTo(0, 5)
    expect(turns[0]!.end).toBeCloseTo(3, 5)
  })

  it('sends the audio of each utterance once, in order, from the start of its first turn', async () => {
    const diarizer = createStreamingDiarizer({ tracker: fakeTracker(), speech: fakeDetector() })
    const utterances: AudioEvent[][] = []
    const turns: ConversationTurn[] = []

    diarizer.on('speech-start', () => utterances.push([]))
    diarizer.on('audio', event => utterances.at(-1)!.push(event))
    diarizer.on('turn', event => turns.push(event.turn))

    const audio = join(voice(0, 1), voice(1, 2), voice(0, 1), voice(2, 1.5), voice(0, 1))

    for (let at = 0; at < audio.length; at += block)
      await diarizer.push(audio.subarray(at, at + block))

    await diarizer.flush()

    // Each utterance sends one run of audio without gaps. It starts with the lead-in, and it can
    // hold silence after the last turn. No sample goes out twice.
    const runs = utterances.map(runsOf)

    expect(runs.map(run => run.length)).toEqual([1, 1])

    const [first, second] = runs.map(run => run[0]!)

    expect(first!.time).toBeCloseTo(turns[0]!.start, 5)
    expect(first!.time + first!.samples.length / rate).toBeGreaterThanOrEqual(turns[0]!.end)
    expect(second!.time).toBeCloseTo(turns[1]!.start, 5)
    expect(second!.time).toBeGreaterThanOrEqual(first!.time + first!.samples.length / rate - 1e-9)
    expect([first, second].map(run => levelOf(run!.samples))).toEqual([1, 2])
  })

  it('does not send audio again for a start in the silence that ended the last utterance', async () => {
    const diarizer = createStreamingDiarizer({ tracker: fakeTracker(), speech: fakeDetector({ startBefore: 0.3 }) })
    const turns: ConversationTurn[] = []
    const sent: AudioEvent[] = []

    diarizer.on('turn', event => turns.push(event.turn))
    diarizer.on('audio', event => sent.push(event))

    const audio = join(voice(0, 1), voice(1, 2), voice(0, 0.6), voice(2, 1.5), voice(0, 1))

    for (let at = 0; at < audio.length; at += block)
      await diarizer.push(audio.subarray(at, at + block))

    await diarizer.flush()

    // The first utterance's audio goes out until 3.4 s, when the detector ends it. The second voice
    // starts at 3.6 s, and the detector places its start at 3.3 s.
    expect(turns.map(turn => turn.start)).toEqual([expect.closeTo(0.7, 5), expect.closeTo(3.4, 5)])
    sent.slice(1).forEach((event, i) => expect(event.time).toBeGreaterThanOrEqual(sent[i]!.time + sent[i]!.samples.length / rate - 1e-9))
    expect(voiceSamples(sent, 2)).toBe(1.5 * rate)
  })

  it('cuts an utterance where the speaker changes', async () => {
    const { turns, sent } = await run(join(voice(0, 1), voice(1, 3), voice(2, 3), voice(0, 1)))

    expect(turns.map(turn => [turn.speaker, turn.cause])).toEqual([[1, 'change'], [2, 'pause']])
    // The cut lands near the change (4 s), within the 0.75 s between checks.
    expect(Math.abs(turns[0]!.end - 4)).toBeLessThanOrEqual(0.75)
    // The second turn starts at the cut, and the audio goes on across it without a gap.
    expect(turns[1]!.start).toBeCloseTo(turns[0]!.end, 5)
    expect(runsOf(sent)).toHaveLength(1)
  })

  it('sends only the focus speaker\'s voice, also right after another voice without a pause', async () => {
    // Voice 2 talks, voice 1 follows at once, voice 2 answers after a pause.
    const { turns, sent } = await run(join(voice(0, 1), voice(2, 2), voice(1, 3), voice(0, 1), voice(2, 2), voice(0, 1)), { focus: 1 })

    expect(voiceSamples(sent, 2)).toBe(0)
    // The focus speaker's 3 s go out, except at most one 0.25 s step at the change.
    expect(voiceSamples(sent, 1)).toBeGreaterThanOrEqual(2.75 * rate)
    expect(sent.filter(event => event.silent).every(event => event.samples.every(value => value === 0))).toBe(true)
    // The other voice still gets turns.
    expect(turns.some(turn => turn.speaker === 2)).toBe(true)
  })

  it('cuts turns where the focus speaker starts or stops', async () => {
    const { turns, sent } = await run(join(voice(0, 1), voice(1, 2), voice(2, 2), voice(1, 2), voice(0, 1)), { focus: 1 })

    expect(turns.map(turn => turn.speaker)).toEqual([1, 2, 1])
    // Focus decisions come in 0.25 s steps.
    expect(Math.abs(turns[0]!.end - 3)).toBeLessThanOrEqual(0.25)
    expect(Math.abs(turns[1]!.end - 5)).toBeLessThanOrEqual(0.25)
    // At a change without a pause, at most one 0.25 s step of the other voice goes out.
    expect(voiceSamples(sent, 2)).toBeLessThanOrEqual(0.25 * rate)
  })

  it('keeps the start of the focus speaker\'s utterance', async () => {
    const { sent } = await run(join(voice(0, 1), voice(1, 2), voice(0, 1)), { focus: 1 })

    expect(voiceSamples(sent, 1)).toBe(2 * rate)
  })

  it('sends every voice while the focus speaker has no voice, and tries again after a reset', async () => {
    const tracker = fakeTracker()
    const compare = tracker.similarity
    let enrolled = false

    tracker.similarity = async (...args) => {
      if (!enrolled)
        throw new RangeError('Speaker 1 has no voice to compare with yet')

      return compare(...args)
    }

    const diarizer = createStreamingDiarizer({ tracker, speech: fakeDetector(), focus: { speaker: 1 } })
    const sent: AudioEvent[] = []
    const errors: unknown[] = []

    diarizer.on('audio', event => sent.push(event))
    diarizer.on('error', event => errors.push(event.error))

    async function play(audio: Float32Array) {
      for (let at = 0; at < audio.length; at += block)
        await diarizer.push(audio.subarray(at, at + block))

      await diarizer.flush()
    }

    await play(join(voice(0, 1), voice(2, 2), voice(0, 1)))
    expect(errors).toHaveLength(1)
    expect(voiceSamples(sent, 2)).toBe(2 * rate)

    enrolled = true
    sent.length = 0
    await diarizer.reset()
    await play(join(voice(0, 1), voice(2, 2), voice(0, 1)))
    expect(voiceSamples(sent, 2)).toBe(0)
  })

  it('does not label a turn of the old conversation after a reset', async () => {
    const tracker = fakeTracker()
    const track = tracker.track
    const resetsAtCall: number[] = []

    // Labels take a while, so the second turn still waits for its label at the reset.
    tracker.track = async (samples, sampleRate) => {
      resetsAtCall.push(tracker.resets)
      await new Promise(resolve => setTimeout(resolve, 10))

      return track(samples, sampleRate)
    }

    const diarizer = createStreamingDiarizer({ tracker, speech: fakeDetector() })
    const audio = join(voice(0, 1), voice(1, 1.5), voice(0, 1), voice(2, 1.5), voice(0, 1))

    for (let at = 0; at < audio.length; at += block)
      await diarizer.push(audio.subarray(at, at + block))

    await diarizer.reset()
    await diarizer.flush()

    expect(resetsAtCall).toEqual([0])
  })

  it('applies revisions to the turns that the tracker numbered', async () => {
    const tracker = fakeTracker()
    const track = tracker.track

    // The app labeled an utterance first, so the tracker numbers this conversation's turns from 1.
    await track(voice(1, 1), rate)
    tracker.track = async (samples, sampleRate) => {
      const turn = await track(samples, sampleRate)

      // The conversation's second turn moves its first turn to speaker 3.
      return turn.index === 2 ? { ...turn, revisions: [{ index: 1, speaker: 3 }] } : turn
    }

    const diarizer = createStreamingDiarizer({ tracker, speech: fakeDetector() })
    const audio = join(voice(0, 1), voice(1, 1.5), voice(0, 1), voice(2, 1.5), voice(0, 1))

    for (let at = 0; at < audio.length; at += block)
      await diarizer.push(audio.subarray(at, at + block))

    await diarizer.flush()

    expect(diarizer.turns().map(turn => [turn.speaker, turn.revisions.length])).toEqual([[3, 1], [2, 0]])
  })

  it('reports an utterance that the detector finds only when it ends', async () => {
    for (const focus of [undefined, 1]) {
      // This detector never reports speech while it goes on.
      const speech = { ...fakeDetector(), speaking: () => false }
      const diarizer = createStreamingDiarizer({ tracker: fakeTracker(), speech, ...(focus === undefined ? {} : { focus: { speaker: focus } }) })
      const types: string[] = []
      const sent: AudioEvent[] = []

      diarizer.on('speech-start', event => types.push(event.type))
      diarizer.on('speech-end', event => types.push(event.type))
      diarizer.on('turn', event => types.push(event.type))
      diarizer.on('audio', event => sent.push(event))

      const audio = join(voice(0, 1), voice(1, 2), voice(0, 1))

      for (let at = 0; at < audio.length; at += block)
        await diarizer.push(audio.subarray(at, at + block))

      await diarizer.flush()

      expect(types).toEqual(['speech-start', 'speech-end', 'turn'])
      expect(voiceSamples(sent, 1)).toBe(2 * rate)
    }
  })

  it('sends the same events to iterators, handlers and streams, and ends them on dispose', async () => {
    const diarizer = createStreamingDiarizer({ tracker: fakeTracker(), speech: fakeDetector() })
    const iterated: string[] = []
    const handled: string[] = []
    const streamed: string[] = []
    const iterating = (async () => {
      for await (const event of diarizer)
        iterated.push(event.type)
    })()
    const reader = diarizer.readable.getReader()
    const streaming = (async () => {
      for (let result = await reader.read(); !result.done; result = await reader.read())
        streamed.push(result.value.type)
    })()

    diarizer.on('speech-start', event => handled.push(event.type))
    diarizer.on('turn', event => handled.push(event.type))
    diarizer.on('speech-end', event => handled.push(event.type))

    const audio = join(voice(0, 1), voice(1, 2), voice(0, 1))
    const writer = diarizer.writable.getWriter()

    for (let at = 0; at < audio.length; at += block)
      await writer.write(audio.subarray(at, at + block))

    // Closing the input ends the events.
    await writer.close()
    await Promise.all([iterating, streaming])

    expect(handled).toEqual(['speech-start', 'speech-end', 'turn'])
    expect(iterated).toEqual(streamed)
    expect(iterated.filter(type => handled.includes(type))).toEqual(handled)
    expect(iterated).toContain('audio')
    expect(iterated).toContain('partial')
    expect(iterated).toContain('turn-update')
    await expect(diarizer.push(new Float32Array(block))).rejects.toThrow('disposed')
  })

  it('works as a transform: the events end after the piped audio', async () => {
    const diarizer = createStreamingDiarizer({ tracker: fakeTracker(), speech: fakeDetector() })
    const audio = join(voice(0, 1), voice(1, 2), voice(0, 1))
    const source = new ReadableStream<Float32Array>({
      start(controller) {
        for (let at = 0; at < audio.length; at += block)
          controller.enqueue(audio.subarray(at, at + block))

        controller.close()
      },
    })
    const reader = source.pipeThrough(diarizer).getReader()
    const types: string[] = []

    for (let result = await reader.read(); !result.done; result = await reader.read())
      types.push(result.value.type)

    expect(types.filter(type => ['speech-start', 'speech-end', 'turn'].includes(type))).toEqual(['speech-start', 'speech-end', 'turn'])
    expect(diarizer.readable).toBe(diarizer.readable)
    await expect(diarizer.push(new Float32Array(block))).rejects.toThrow('disposed')
  })

  it('starts a new conversation on reset', async () => {
    const { diarizer, tracker } = await run(join(voice(0, 1), voice(1, 2), voice(0, 1)))

    await diarizer.reset()

    const turns: ConversationTurn[] = []

    diarizer.on('turn', event => turns.push(event.turn))

    const audio = join(voice(0, 1), voice(2, 2), voice(0, 1))

    for (let at = 0; at < audio.length; at += block)
      await diarizer.push(audio.subarray(at, at + block))

    await diarizer.flush()

    expect(tracker.resets).toBe(1)
    expect(turns).toMatchObject([{ index: 0, speaker: 2 }])
    expect(turns[0]!.start).toBeCloseTo(0, 5)
    expect(diarizer.turns()).toHaveLength(1)
  })

  it('keeps leadInSeconds of audio from before the detector reports speech', async () => {
    const starts: number[] = []

    for (const leadInSeconds of [0, 0.5]) {
      const diarizer = createStreamingDiarizer({ tracker: fakeTracker(), speech: fakeDetector(), leadInSeconds })
      const audio = join(voice(0, 1), voice(1, 2), voice(0, 1))

      diarizer.on('turn', event => starts.push(event.turn.start))

      for (let at = 0; at < audio.length; at += block)
        await diarizer.push(audio.subarray(at, at + block))

      await diarizer.flush()
    }

    // The speech starts at 1 s, and the detector reports it in the block that starts there.
    expect(starts[0]).toBeCloseTo(1, 5)
    expect(starts[1]).toBeCloseTo(0.5, 5)
    expect(() => createStreamingDiarizer({ tracker: fakeTracker(), speech: fakeDetector(), leadInSeconds: -1 })).toThrow('leadInSeconds')
  })
})
