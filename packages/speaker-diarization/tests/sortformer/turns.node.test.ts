// cspell:ignore sortformer
import { describe, expect, it } from 'vitest'

import { activeSpeakers, turnsOf } from '../../src/sortformer/turns'

const speakers = 8

function repeat<T>(value: T, count: number) {
  return Array.from({ length: count }, () => value)
}

function probabilities(labels: Array<number | number[] | undefined>) {
  const values = new Float32Array(labels.length * speakers)

  labels.forEach((label, frame) => {
    for (const speaker of label === undefined ? [] : Array.isArray(label) ? label : [label])
      values[frame * speakers + speaker] = 0.8
  })

  return values
}

describe('sortformer turns', () => {
  it('uses the highest speaker above the threshold for each frame', () => {
    const values = probabilities(Array.from({ length: 30 }, () => [0, 1]))

    for (let frame = 0; frame < 30; frame++)
      values[frame * speakers + 1] = 0.9

    expect(turnsOf(values, 30)).toEqual([{ start: 0, end: 0.3, speaker: 1, overlapSeconds: 0.3 }])
  })

  it('drops speaker runs shorter than 0.3 seconds', () => {
    expect(turnsOf(probabilities([...repeat(0, 30), ...repeat(1, 29)]), 59)).toEqual([
      { start: 0, end: 0.3, speaker: 0, overlapSeconds: 0 },
    ])
  })

  it('joins a speaker across a gap shorter than 0.5 seconds', () => {
    expect(turnsOf(probabilities([...repeat(0, 30), ...repeat(undefined, 49), ...repeat(0, 30)]), 109)).toEqual([
      { start: 0, end: 1.09, speaker: 0, overlapSeconds: 0 },
    ])
  })

  it('counts other speakers above the threshold as overlap', () => {
    expect(turnsOf(probabilities([...repeat(0, 30), ...repeat([0, 1], 30)]), 60)).toEqual([
      { start: 0, end: 0.6, speaker: 0, overlapSeconds: 0.3 },
    ])
  })

  it('starts a new speaker\'s turn where they rise above the previous speaker, at most 1 s earlier', () => {
    // Speaker 0 leads, both fall below the threshold, speaker 1 passes speaker 0, then leads.
    const crossing = new Float32Array(240 * speakers)
    const set = (from: number, to: number, speaker: number, value: number) => {
      for (let frame = from; frame < to; frame++)
        crossing[frame * speakers + speaker] = value
    }

    set(0, 100, 0, 0.9)
    set(100, 120, 0, 0.4)
    set(100, 120, 1, 0.2)
    set(120, 140, 0, 0.1)
    set(120, 140, 1, 0.4)
    set(140, 240, 1, 0.9)

    expect(turnsOf(crossing, 240)).toEqual([
      { start: 0, end: 1, speaker: 0, overlapSeconds: 0 },
      { start: 1.2, end: 2.4, speaker: 1, overlapSeconds: 0 },
    ])

    // Speaker 1 stays above speaker 0 for 1.5 s before leading: the turn starts 1 s before.
    const slow = new Float32Array(350 * speakers)

    for (let frame = 0; frame < 350; frame++)
      slow[frame * speakers + (frame < 100 ? 0 : 1)] = frame < 100 || frame >= 250 ? 0.9 : 0.3

    expect(turnsOf(slow, 350).map(turn => turn.start)).toEqual([0, 1.5])
  })

  it('returns all speakers active in the requested recent frames', () => {
    expect(activeSpeakers(probabilities([0, 1, [1, 2]]), 3, 0.02)).toEqual([1, 2])
  })

  it('accepts a custom threshold', () => {
    const values = probabilities(repeat(0, 30))

    values.fill(0.6)
    expect(turnsOf(values, 30, { threshold: 0.7 })).toEqual([])
  })

  it('keeps the first leading frame when crossing is false', () => {
    const values = new Float32Array(240 * speakers)

    for (let frame = 0; frame < 240; frame++)
      values[frame * speakers + (frame < 140 ? 0 : 1)] = 0.9

    expect(turnsOf(values, 240, { crossing: false }).map(turn => turn.start)).toEqual([0, 140 * 0.01])
  })

  it('rejects invalid values', () => {
    expect(() => turnsOf(new Float32Array(8), 1, { threshold: 1.1 })).toThrow(RangeError)
    expect(() => turnsOf(new Float32Array(8), 1, { minTurnSeconds: -1 })).toThrow(RangeError)
    expect(() => turnsOf(new Float32Array(8), 1, { crossing: { floor: Number.NaN } })).toThrow(TypeError)
    expect(() => turnsOf(new Float32Array(7), 1)).toThrow(RangeError)
    expect(() => activeSpeakers(new Float32Array(8), 1, -1)).toThrow(RangeError)
  })
})
