import type { Extractor } from '@sherpaw/speaker-identification'

import { describe, expect, it } from 'vitest'

import { normalize } from '../src/clustering'
import { createSpeakerTracker } from '../src/tracker'

// Each test voice is audio of one constant level, and the fake extractor maps that level to a fixed
// embedding. So the clustering sees exact cosines between the voices.
const voices = {
  owner: [1, 0, 0, 0],
  // Cosine 0.35 with the owner: at least `borrowThreshold` (0.3), below `enrollThreshold` (0.4).
  nearOwner: [0.35, Math.sqrt(1 - 0.35 ** 2), 0, 0],
  other: [0, 0, 1, 0],
  nearOther: [0, 0, 0.35, Math.sqrt(1 - 0.35 ** 2)],
  // Closest to the owner (0.35), and also at least `borrowThreshold` to the other speaker (0.31).
  betweenOwnerAndOther: [0.35, Math.sqrt(1 - 0.35 ** 2 - 0.31 ** 2), 0.31, 0],
}
const names = Object.keys(voices) as Array<keyof typeof voices>

const extractor: Extractor = {
  dimension: 4,
  extract: samples => normalize(voices[names[Math.round(samples[0]! * 10) - 1]!]),
  dispose: () => {},
}

function audio(voice: keyof typeof voices, seconds: number) {
  return new Float32Array(seconds * 16000).fill((names.indexOf(voice) + 1) / 10)
}

describe('speaker tracker', () => {
  it('never lets a new voice borrow an enrolled speaker\'s number', async () => {
    const tracker = createSpeakerTracker(extractor)
    const owner = tracker.enroll(audio('owner', 6), 16000)

    expect(await tracker.track(audio('owner', 5), 16000)).toMatchObject({ speaker: owner, pending: false })
    // Below `enrollThreshold`, the new voice is a new, pending speaker, not the owner.
    expect(await tracker.track(audio('nearOwner', 2), 16000)).toMatchObject({ speaker: owner + 1, pending: true })
  })

  it('keeps a new voice that is closest to an enrolled speaker new, instead of borrowing another number', async () => {
    const tracker = createSpeakerTracker(extractor)
    const owner = tracker.enroll(audio('owner', 6), 16000)

    await tracker.track(audio('owner', 5), 16000)
    expect(await tracker.track(audio('other', 5), 16000)).toMatchObject({ speaker: owner + 1 })
    expect(await tracker.track(audio('betweenOwnerAndOther', 2), 16000)).toMatchObject({ speaker: owner + 2, pending: true })
  })

  it('adds speech to an enrolled speaker only when it sounds like them', async () => {
    const tracker = createSpeakerTracker(extractor)
    const owner = tracker.enroll(audio('owner', 6), 16000)

    // Cosine 0.35, below `enrollThreshold` (0.4).
    expect(() => tracker.enroll(audio('nearOwner', 6), 16000, { speaker: owner })).toThrow('does not sound like speaker 0')
    expect(() => tracker.enroll(audio('owner', 6), 16000, { speaker: owner + 1 })).toThrow('not enrolled')
    expect(tracker.enroll(audio('owner', 6), 16000, { speaker: owner })).toBe(owner)
    expect(tracker.inspect().speakers).toHaveLength(1)
    expect(tracker.inspect().speakers[0]!.embedding[0]).toBeCloseTo(1, 5)
  })

  it('weights the enrollment speech by its seconds', async () => {
    const tracker = createSpeakerTracker(extractor, { tuning: { enrollThreshold: 0.3 } })
    const owner = tracker.enroll(audio('owner', 12), 16000)

    tracker.enroll(audio('nearOwner', 6), 16000, { speaker: owner })

    // 12 s of [1, 0, 0, 0] and 6 s of [0.35, 0.94, 0, 0].
    const [x, y] = tracker.inspect().speakers[0]!.embedding
    const mean = [(12 + 6 * 0.35) / 18, (6 * Math.sqrt(1 - 0.35 ** 2)) / 18]

    expect(x! / y!).toBeCloseTo(mean[0]! / mean[1]!, 4)
  })

  it('compares windows of audio with a speaker\'s voice', async () => {
    const tracker = createSpeakerTracker(extractor)
    const owner = tracker.enroll(audio('owner', 6), 16000)
    const samples = new Float32Array(4 * 16000)

    // 2 s of the owner, then 2 s of a voice at cosine 0.35 to the owner.
    samples.set(audio('owner', 2))
    samples.set(audio('nearOwner', 2), 2 * 16000)

    const cosines = tracker.similarity(samples, 16000, owner, { windowSeconds: 1, stepSeconds: 0.5 })

    // A window takes the voice of its first sample in the fake extractor.
    expect([...cosines].map(cosine => Number(cosine.toFixed(2)))).toEqual([1, 1, 1, 1, 0.35, 0.35, 0.35])
    expect(() => tracker.similarity(samples, 16000, owner + 1)).toThrow('no voice')
    expect(() => tracker.similarity(samples, 16000, owner, { windowSeconds: 0.1 })).toThrow('windowSeconds')
  })

  it('lets a new voice borrow the number of a similar speaker who is not enrolled', async () => {
    const tracker = createSpeakerTracker(extractor)

    expect(await tracker.track(audio('other', 5), 16000)).toMatchObject({ speaker: 0, pending: false })
    expect(await tracker.track(audio('nearOther', 2), 16000)).toMatchObject({ speaker: 0, pending: false })

    const strict = createSpeakerTracker(extractor, { tuning: { borrowThreshold: 1 } })

    await strict.track(audio('other', 5), 16000)
    expect(await strict.track(audio('nearOther', 2), 16000)).toMatchObject({ speaker: 1, pending: true })
  })
})
