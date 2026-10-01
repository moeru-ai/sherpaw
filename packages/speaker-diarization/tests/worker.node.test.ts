import type { Buffer } from 'node:buffer'

import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'

import type { DiarizationModelPacks, SpeakerSegment } from '../src/types'

// Exercise the published Node entry, its worker script, and its WASM asset.
// eslint-disable-next-line antfu/no-import-dist
import { createDiarizer, createSpeakerTracker } from '../dist/node.js'

// Output of the upstream sherpa-onnx example for 0-four-speakers-zh.wav with
// pyannote-segmentation-3.0, window shift ratio 0.1 and four clusters. CAM++ reproduces it.
const reference: SpeakerSegment[] = [
  { start: 0.318, end: 6.865, speaker: 0 },
  { start: 7.017, end: 10.747, speaker: 1 },
  { start: 11.455, end: 13.632, speaker: 1 },
  { start: 13.75, end: 17.041, speaker: 2 },
  { start: 22.137, end: 24.837, speaker: 0 },
  { start: 27.638, end: 29.478, speaker: 3 },
  { start: 30.001, end: 31.553, speaker: 3 },
  { start: 33.68, end: 37.932, speaker: 3 },
  { start: 48.04, end: 50.47, speaker: 2 },
  { start: 52.529, end: 54.605, speaker: 0 },
]

/** Decode the upstream mono PCM16 fixture. */
async function readAudio(filename: string): Promise<Float32Array> {
  const wav = await readFile(new URL(`./fixtures/${filename}`, import.meta.url))
  let pcm: Buffer | undefined

  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4)

    if (wav.toString('ascii', offset, offset + 4) === 'data')
      pcm = wav.subarray(offset + 8, offset + 8 + size)

    offset += 8 + size + (size % 2)
  }

  if (!pcm)
    throw new Error(`Run pnpm -F @sherpaw/speaker-diarization test:prepare: missing ${filename}`)

  const samples = new Float32Array(pcm.length / 2)

  for (let index = 0; index < samples.length; index++)
    samples[index] = pcm.readInt16LE(index * 2) / 32768

  return samples
}

function expectSegments(actual: SpeakerSegment[], expected: SpeakerSegment[]): void {
  expect(actual.map(segment => segment.speaker)).toEqual(expected.map(segment => segment.speaker))

  actual.forEach((segment, index) => {
    expect(segment.start).toBeCloseTo(expected[index].start, 2)
    expect(segment.end).toBeCloseTo(expected[index].end, 2)
  })
}

describe('published Node worker', () => {
  let model: DiarizationModelPacks
  let samples: Float32Array

  beforeAll(async () => {
    const models = new URL('../../../models/', import.meta.url)
    const pack = new URL('huggingface/sherpaw-campplus-zh-en-advanced/install/bin/wasm/', models)
    const [segmentation, embedding, metadata] = await Promise.all([
      readFile(new URL('sherpa-onnx-pyannote-segmentation-3-0/model/normalized/speaker-segmentation.onnx', models)),
      readFile(new URL('preload.data', pack)),
      readFile(new URL('preload.js.metadata', pack), 'utf8'),
    ])

    // No segmentation pack is published yet. A pack of one file is that file plus a manifest.
    model = {
      segmentation: {
        data: new Uint8Array(segmentation),
        metadata: { files: [{ filename: '/speaker-segmentation.onnx', start: 0, end: segmentation.length }], remote_package_size: segmentation.length },
      },
      embedding: { data: new Uint8Array(embedding), metadata: JSON.parse(metadata) },
    }
    samples = await readAudio('0-four-speakers-zh.wav')
  })

  it('diarizes a recording with per-call clustering and keeps caller buffers', async () => {
    const modelSize = model.segmentation.data.byteLength
    const diarizer = await createDiarizer({ model, clustering: { numSpeakers: 4 } })

    try {
      const original = samples.slice()

      expect(diarizer.sampleRate).toBe(16000)
      expectSegments(await diarizer.diarize(samples, 16000), reference)

      const merged = await diarizer.diarize(samples, 16000, { distanceThreshold: 0.9 })

      expect(new Set(merged.map(segment => segment.speaker)).size).toBe(3)
      expectSegments(await diarizer.diarize(samples, 16000), reference)
      expect(model.segmentation.data.byteLength).toBe(modelSize)
      expect(samples).toEqual(original)
    }
    finally {
      diarizer.dispose()
    }
  })

  it('rejects invalid input and operations after disposal', async () => {
    await expect(createDiarizer({ model, clustering: { numSpeakers: 0 } })).rejects.toThrow('numSpeakers')

    const diarizer = await createDiarizer({ model, clustering: { numSpeakers: 2 } })

    await expect(diarizer.diarize(samples, 48000)).rejects.toThrow('16000 Hz')

    diarizer.dispose()
    diarizer.dispose()

    await expect(diarizer.diarize(samples, 16000)).rejects.toThrow('disposed')
  })

  it('tracks the speakers of consecutive utterances', async () => {
    const tracker = await createSpeakerTracker({ model: model.embedding })
    const utterance = ({ start, end }: SpeakerSegment) => samples.subarray(Math.round(start * 16000), Math.round(end * 16000))

    try {
      expect(await tracker.peek(utterance(reference[0]!), 16000)).toMatchObject({ speaker: null })

      const turns = []

      for (const segment of reference)
        turns.push(await tracker.track(utterance(segment), 16000))

      // Guesses do not change the session.
      expect(await tracker.peek(utterance(reference[7]!), 16000)).toMatchObject({ speaker: 3, changes: [] })
      expect(await tracker.peek(utterance(reference[7]!), 16000)).not.toHaveProperty('windowChange')

      // 1.5 s of speaker 0 followed by 1.5 s of speaker 2: the guess follows the new speaker.
      const first = utterance(reference[0]!)
      const switched = new Float32Array(48000)

      switched.set(first.subarray(first.length - 24000))
      switched.set(utterance(reference[3]!).subarray(0, 24000), 24000)
      expect(await tracker.peek(switched, 16000)).toMatchObject({ speaker: 2, changes: [], windowChange: 1.5 })

      // Speaker 3 first sounds like speaker 0 and borrows its label until it has 4 s of speech.
      expect(turns.map(turn => turn.speaker)).toEqual([0, 1, 1, 2, 0, 0, 0, 3, 2, 0])
      expect(turns.map(turn => turn.index)).toEqual(reference.map((_, index) => index))
      // Overlap needs the segmentation model.
      expect(turns.some(turn => turn.overlap)).toBe(false)

      // After revisions, both number speakers in order of first appearance.
      const revised = turns.map(turn => turn.speaker)

      for (const { index, speaker } of turns.flatMap(turn => turn.revisions))
        revised[index] = speaker

      expect(revised).toEqual(reference.map(segment => segment.speaker))

      // The speaker map: unit-length embeddings of the clustered units and one reference per speaker.
      const map = await tracker.inspect()
      const length = (embedding: Float32Array) => Math.hypot(...embedding)

      expect(map.speakers.map(speaker => speaker.speaker)).toEqual([0, 1, 2, 3])
      expect(map.speakers.every(speaker => !speaker.enrolled && speaker.embedding.length === 192)).toBe(true)
      expect(map.units.length).toBeGreaterThanOrEqual(reference.length)
      expect([...map.units, ...map.speakers].every(item => Math.abs(length(item.embedding) - 1) < 1e-3)).toBe(true)
      // Every utterance's units belong to its revised speaker.
      expect(map.units.every(unit => unit.speaker === revised[unit.index])).toBe(true)

      // Unclamped samples are rejected, instead of silently keeping the previous label.
      await expect(tracker.track(utterance(reference[1]!).map(value => value * 8), 16000)).rejects.toThrow('between -1 and 1')

      await tracker.reset()

      expect(await tracker.track(utterance(reference[1]!), 16000)).toMatchObject({ index: 0, speaker: 0 })
    }
    finally {
      tracker.dispose()
    }

    await expect(tracker.track(samples, 16000)).rejects.toThrow('disposed')
  })

  it('recognizes an enrolled speaker from the first utterance and keeps the enrollment across sessions', async () => {
    await expect(createSpeakerTracker({ model: model.embedding, tuning: { matchThreshold: 2 } })).rejects.toThrow('between -1 and 1')

    const tracker = await createSpeakerTracker({ model: model.embedding })
    const utterance = ({ start, end }: SpeakerSegment) => samples.subarray(Math.round(start * 16000), Math.round(end * 16000))

    try {
      await expect(tracker.enroll(utterance(reference[5]!), 16000)).rejects.toThrow('at least 5 s')

      // Two people in the enrollment audio: speaker 0 and speaker 2, 3 s each.
      const two = new Float32Array(6 * 16000)

      two.set(utterance(reference[0]!).subarray(0, 3 * 16000))
      two.set(utterance(reference[3]!).subarray(0, 3 * 16000), 3 * 16000)
      await expect(tracker.enroll(two, 16000)).rejects.toThrow('more than one voice')

      // 5.9 s of speaker 1. The test below tracks the same audio. It checks that the parts work together, not the accuracy.
      const a = utterance(reference[1]!)
      const b = utterance(reference[2]!)
      const enrollment = new Float32Array(a.length + b.length)

      enrollment.set(a)
      enrollment.set(b, a.length)
      expect(await tracker.enroll(enrollment, 16000)).toBe(0)

      const turns = []

      for (const segment of reference)
        turns.push(await tracker.track(utterance(segment), 16000))

      // Speaker 1 has the enrolled number from the first utterance. The others follow it in order of
      // appearance. Speaker 3 first borrows speaker 0's number, and a later revision corrects it.
      expect(turns.map(turn => turn.speaker)).toEqual([1, 0, 0, 2, 1, 1, 1, 3, 2, 1])

      const revised = turns.map(turn => turn.speaker)

      for (const { index, speaker } of turns.flatMap(turn => turn.revisions))
        revised[index] = speaker

      expect(revised).toEqual([1, 0, 0, 2, 1, 3, 3, 3, 2, 1])
      expect((await tracker.inspect()).speakers.map(({ speaker, enrolled }) => ({ speaker, enrolled }))).toEqual([
        { speaker: 0, enrolled: true },
        { speaker: 1, enrolled: false },
        { speaker: 2, enrolled: false },
        { speaker: 3, enrolled: false },
      ])

      // A new session keeps the enrolled speaker and numbers the others after it.
      await tracker.reset()
      expect(await tracker.track(utterance(reference[1]!), 16000)).toMatchObject({ index: 0, speaker: 0 })
      expect(await tracker.track(utterance(reference[0]!), 16000)).toMatchObject({ index: 1, speaker: 1 })

      await tracker.reset({ forgetEnrolled: true })
      expect(await tracker.track(utterance(reference[0]!), 16000)).toMatchObject({ speaker: 0 })
    }
    finally {
      tracker.dispose()
    }
  })

  it('finds short interjections and overlapping speech with the segmentation model', async () => {
    const tracker = await createSpeakerTracker({ model: model.embedding, segmentation: { data: model.segmentation.data } })
    const utterance = ({ start, end }: SpeakerSegment) => samples.subarray(Math.round(start * 16000), Math.round(end * 16000))

    try {
      const turns = []

      for (const segment of reference)
        turns.push(await tracker.track(utterance(segment), 16000))

      // Labels come from the embeddings as before. None of these utterances overlaps.
      expect(turns.map(turn => turn.speaker)).toEqual([0, 1, 1, 2, 0, 0, 0, 3, 2, 0])
      expect(turns.some(turn => turn.overlap)).toBe(false)

      const first = utterance(reference[0]!)
      const switched = new Float32Array(48000)

      switched.set(first.subarray(first.length - 24000))
      switched.set(utterance(reference[3]!).subarray(0, 24000), 24000)

      const guess = await tracker.peek(switched, 16000)

      // Both detectors find this change.
      expect(guess).toMatchObject({ speaker: 2, windowChange: 1.5 })
      expect(guess.changes).toHaveLength(1)
      expect(guess.changes[0]).toBeCloseTo(1.5, 1)

      // 1 s of speaker 2 inside speaker 0 is shorter than the 1.5 s embedding windows. The first
      // change lies midway through the pause before the interjection.
      const interjection = new Float32Array(6 * 16000)

      interjection.set(first.subarray(16000, 4 * 16000))
      interjection.set(utterance(reference[3]!).subarray(16000, 2 * 16000), 3 * 16000)
      interjection.set(first.subarray(4 * 16000, 6 * 16000), 4 * 16000)

      const found = await tracker.peek(interjection, 16000, { final: true })

      expect(found.speaker).toBe(0)
      expect(found.changes).toHaveLength(2)
      expect(found.changes[0]).toBeGreaterThan(2.6)
      expect(found.changes[0]).toBeLessThan(3.1)
      expect(found.changes[1]).toBeCloseTo(4, 1)

      // Speaker 0 talks over speaker 3 from 1 s on.
      const overlapped = utterance(reference[7]!).slice()

      for (let i = 16000; i < overlapped.length; i++)
        overlapped[i] = 0.6 * overlapped[i]! + 0.6 * first[i - 16000]!

      expect(await tracker.track(overlapped, 16000)).toMatchObject({ overlap: true })

      // Speech probability per frame: 2 s of silence, then 3 s of speaker 0.
      const padded = new Float32Array(5 * 16000)

      padded.set(first.subarray(0, 3 * 16000), 2 * 16000)

      const speech = await tracker.speech(padded, 16000)
      const mean = (values: Float32Array) => values.reduce((sum, value) => sum + value, 0) / values.length
      // The center of frame i is sample i * 270 + 495.
      const frameAt = (seconds: number) => Math.round((seconds * 16000 - 495) / 270)

      expect(speech).toHaveLength(Math.floor((padded.length - 991) / 270) + 1)
      expect(mean(speech.subarray(frameAt(0.2), frameAt(1.8)))).toBeLessThan(0.1)
      expect(mean(speech.subarray(frameAt(2.5), frameAt(4.8)))).toBeGreaterThan(0.8)
      await expect(tracker.speech(new Float32Array(11 * 16000), 16000)).rejects.toThrow('at most 10 s')
      await expect(tracker.speech(padded, 8000)).rejects.toThrow('16000 Hz')
    }
    finally {
      tracker.dispose()
    }

    // A margin longer than the 10 s window still ends the pass over a finished utterance.
    const wide = await createSpeakerTracker({ model: model.embedding, segmentation: { data: model.segmentation.data }, tuning: { segmentationMarginSeconds: 12 } })

    try {
      const long = new Float32Array(12 * 16000)

      long.set(samples.subarray(0, long.length))
      expect((await wide.peek(long, 16000, { final: true })).changes).toBeInstanceOf(Array)
    }
    finally {
      wide.dispose()
    }
  })
})
