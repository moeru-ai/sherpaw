import { describe, expect, it } from 'vitest'

import { decode, findChanges, FRAME_SECONDS, overlapSeconds } from '../src/segmentation'

/** Scores in the model's 7 classes per frame, where the given class wins. */
function scores(classes: number[]): Float32Array {
  const out = new Float32Array(classes.length * 7).fill(-10)

  classes.forEach((k, frame) => out[frame * 7 + k] = 0)

  return out
}

/** `seconds` of frames of one class. */
function span(k: number, seconds: number): number[] {
  return Array.from<number>({ length: Math.round(seconds / FRAME_SECONDS) }).fill(k)
}

describe('segmentation decoding', () => {
  it('reads single speakers, silence and overlap', () => {
    const frames = decode(scores([0, 1, 2, 3, 4, 5, 6]))

    expect([...frames.owner]).toEqual([-1, 0, 1, 2, -1, -1, -1])
    expect(frames.overlap[3]).toBeLessThan(0.01)
    expect(frames.overlap[6]).toBeGreaterThan(0.99)
  })

  it('finds changes between runs of different speakers', () => {
    // A 1 s, pause 0.2 s, B 0.5 s, A 1 s.
    const classes = [...span(1, 1), ...span(0, 0.2), ...span(2, 0.5), ...span(1, 1)]
    const changes = findChanges(decode(scores(classes)), 0.3)

    expect(changes).toHaveLength(2)
    expect(changes[0]).toBeCloseTo(1.1, 1)
    expect(changes[1]).toBeCloseTo(1.7, 1)
  })

  it('ignores runs shorter than the minimum and keeps the surrounding speaker', () => {
    // B talks alone for only 0.2 s, then overlaps with A: A's run is not broken.
    const classes = [...span(1, 1), ...span(2, 0.2), ...span(4, 0.5), ...span(1, 1)]

    expect(findChanges(decode(scores(classes)), 0.3)).toEqual([])
  })

  it('measures overlap', () => {
    const frames = decode(scores([...span(1, 1), ...span(4, 0.6), ...span(1, 1)]))

    expect(overlapSeconds(frames)).toBeCloseTo(0.6, 1)
  })
})
