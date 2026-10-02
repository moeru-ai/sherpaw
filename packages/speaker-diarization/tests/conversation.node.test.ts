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
    dispose() {},
  }
}

interface AudioEvent {
  time: number
  samples: Float32Array
}

async function run(audio: Float32Array) {
  const tracker = fakeTracker()
  const diarizer = createStreamingDiarizer({ tracker, speech: fakeDetector() })
  const turns: ConversationTurn[] = []
  const sent: AudioEvent[] = []

  diarizer.on('turn', event => turns.push(event.turn))
  diarizer.on('audio', ({ time, samples }) => sent.push({ time, samples }))

  for (let at = 0; at < audio.length; at += block)
    await diarizer.push(audio.subarray(at, at + block))

  await diarizer.flush()

  return { diarizer, tracker, turns, sent }
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

  it('cuts an utterance where the speaker changes', async () => {
    const { turns, sent } = await run(join(voice(0, 1), voice(1, 3), voice(2, 3), voice(0, 1)))

    expect(turns.map(turn => [turn.speaker, turn.cause])).toEqual([[1, 'change'], [2, 'pause']])
    // The cut lands near the change (4 s), within the 0.75 s between checks.
    expect(Math.abs(turns[0]!.end - 4)).toBeLessThanOrEqual(0.75)
    // The second turn starts at the cut, and the audio goes on across it without a gap.
    expect(turns[1]!.start).toBeCloseTo(turns[0]!.end, 5)
    expect(runsOf(sent)).toHaveLength(1)
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
