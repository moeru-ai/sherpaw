import { describe, expect, it } from 'vitest'

import type { ClusteringOptions } from '../src/clustering'

import { clusterEmbeddings, dot, maximumAssignment, normalize } from '../src/clustering'

// The tracker's settings. Below `ahcLimit` embeddings, AHC runs; otherwise spectral clustering.
const options: ClusteringOptions = { ahcLimit: 40, ahcThreshold: 0.4, pruning: 0.05, minNeighbors: 6, maxSpeakers: 15, mergeThreshold: 0.8 }
const dimension = 192
// Same-speaker cosines are then about 0.6, as for CAM++ embeddings of 1.5 s windows.
const noise = 0.06

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0

    let t = Math.imul(seed ^ (seed >>> 15), seed | 1)

    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `sizes[k]` unit vectors near speaker k's direction, in shuffled order, with their speakers. */
function speakers(sizes: number[], seed: number) {
  const next = random(seed)
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next())
  const centers = sizes.map(() => normalize(Array.from({ length: dimension }, gaussian)))
  const items = sizes.flatMap((size, k) => Array.from({ length: size }, () => ({
    speaker: k,
    embedding: normalize(Array.from(centers[k]!, value => value + noise * gaussian())),
  })))

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));

    [items[i], items[j]] = [items[j]!, items[i]!]
  }

  return { embeddings: items.map(item => item.embedding), truth: items.map(item => item.speaker) }
}

/** True when the labels split the items exactly as the truth does, whatever the label values. */
function samePartition(labels: ArrayLike<number>, truth: number[]) {
  const forward = new Map<number, number>()
  const backward = new Map<number, number>()

  return truth.every((speaker, i) => {
    const label = labels[i]!

    if ((forward.get(label) ?? speaker) !== speaker || (backward.get(speaker) ?? label) !== label)
      return false

    forward.set(label, speaker)
    backward.set(speaker, label)

    return true
  })
}

describe('clusterEmbeddings', () => {
  it('separates speakers with AHC below ahcLimit', () => {
    const { embeddings, truth } = speakers([12, 9, 6], 1)

    expect(embeddings.length).toBeLessThan(options.ahcLimit)
    expect(samePartition(clusterEmbeddings(embeddings, options), truth)).toBe(true)
  })

  it('separates speakers with spectral clustering from ahcLimit on', () => {
    for (const [seed, sizes] of [[2, [30, 20, 15]], [3, [25, 25, 20, 10]], [4, [60, 40]]] as const) {
      const { embeddings, truth } = speakers([...sizes], seed)

      expect(embeddings.length).toBeGreaterThanOrEqual(options.ahcLimit)
      expect(samePartition(clusterEmbeddings(embeddings, options), truth), `seed ${seed}`).toBe(true)
    }
  })

  it('merges clusters whose centroids reach mergeThreshold', () => {
    const { embeddings } = speakers([20, 20], 5)
    const labels = clusterEmbeddings(embeddings, { ...options, mergeThreshold: -1 })

    expect(new Set(labels).size).toBe(1)
  })

  it('handles zero and one embedding', () => {
    expect(clusterEmbeddings([], options)).toEqual(new Int32Array(0))
    expect(clusterEmbeddings([normalize([1, 0, 0])], options)).toEqual(new Int32Array(1))
  })
})

describe('maximumAssignment', () => {
  /** The best total over all pairings that pair every row or every column, by brute force. */
  function bestTotal(scores: number[][]): number {
    const rows = scores.length
    const columns = scores[0]!.length
    const all = (1 << columns) - 1

    function search(row: number, used: number): number {
      if (row === rows)
        return rows <= columns || used === all ? 0 : -Infinity

      // A row may stay unpaired when there are more rows than columns.
      let best = rows > columns ? search(row + 1, used) : -Infinity

      for (let column = 0; column < columns; column++) {
        if (!(used & (1 << column)))
          best = Math.max(best, scores[row]![column]! + search(row + 1, used | (1 << column)))
      }

      return best
    }

    return search(0, 0)
  }

  it('finds the best pairing of square and rectangular score matrices', () => {
    const next = random(6)

    for (const [rows, columns] of [[1, 1], [3, 3], [5, 5], [2, 5], [5, 2]] as const) {
      for (let trial = 0; trial < 20; trial++) {
        const scores = Array.from({ length: rows }, () => Array.from({ length: columns }, () => next() * 2 - 1))
        const pairs = maximumAssignment(scores)

        expect(pairs).toHaveLength(Math.min(rows, columns))
        expect(new Set(pairs.map(([row]) => row)).size).toBe(pairs.length)
        expect(new Set(pairs.map(([, column]) => column)).size).toBe(pairs.length)
        expect(pairs.reduce((sum, [row, column]) => sum + scores[row]![column]!, 0)).toBeCloseTo(bestTotal(scores), 10)
      }
    }
  })

  it('returns no pairs for an empty matrix', () => {
    expect(maximumAssignment([])).toEqual([])
    expect(maximumAssignment([[]])).toEqual([])
  })
})

it('normalize keeps a zero vector at zero', () => {
  expect([...normalize([0, 0])]).toEqual([0, 0])
  expect(dot(normalize([3, 4]), normalize([3, 4]))).toBeCloseTo(1, 6)
})
