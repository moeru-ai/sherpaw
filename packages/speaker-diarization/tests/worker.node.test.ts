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
      expect(await tracker.peek(utterance(reference[7]!), 16000)).toMatchObject({ speaker: 3 })
      expect(await tracker.peek(utterance(reference[7]!), 16000)).not.toHaveProperty('change')

      // 1.5 s of speaker 0 followed by 1.5 s of speaker 2: the guess follows the new speaker.
      const first = utterance(reference[0]!)
      const switched = new Float32Array(48000)

      switched.set(first.subarray(first.length - 24000))
      switched.set(utterance(reference[3]!).subarray(0, 24000), 24000)
      expect(await tracker.peek(switched, 16000)).toMatchObject({ speaker: 2, change: 1.5 })

      // Speaker 3 first sounds like speaker 0 and borrows its label until it has 4 s of speech.
      expect(turns.map(turn => turn.speaker)).toEqual([0, 1, 1, 2, 0, 0, 0, 3, 2, 0])
      expect(turns.map(turn => turn.index)).toEqual(reference.map((_, index) => index))

      // After revisions, both number speakers in order of first appearance.
      const revised = turns.map(turn => turn.speaker)

      for (const { index, speaker } of turns.flatMap(turn => turn.revisions))
        revised[index] = speaker

      expect(revised).toEqual(reference.map(segment => segment.speaker))

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
})
