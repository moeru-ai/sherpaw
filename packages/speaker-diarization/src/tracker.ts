import type { Extractor } from '@sherpaw/speaker-identification'

import type { ClusteringOptions } from './clustering'
import type { SpeakerConfidence, SpeakerGuess, SpeakerRevision, SpeakerTurn } from './types'

import { centroid, clusterEmbeddings, dot, maximumAssignment, normalize } from './clustering'

export interface NativeSpeakerTrackerConfig {
  /** Re-cluster at most this many recent embeddings after each utterance. Default: 300. */
  historyLimit?: number
}

export interface NativeSpeakerTracker {
  /** Labels one utterance of mono PCM. Call in time order. */
  track: (samples: Float32Array, sampleRate: number) => SpeakerTurn
  /** Guesses the nearest established speaker without changing any state. */
  peek: (samples: Float32Array, sampleRate: number) => SpeakerGuess
  /** Forgets every speaker and starts a new session. */
  reset: () => void
  /** Idempotent. Track throws after disposal. The extractor stays with its owner. */
  dispose: () => void
}

// The window and hop follow 3D-Speaker's CAM++ diarization; other lengths were not tried.
const WINDOW_SECONDS = 1.5
const HOP_SECONDS = 0.75
// The values below were chosen on the AMI dev set.
/** Shorter utterances are labeled from the nearest speaker but never clustered. */
const MIN_WINDOWED_SECONDS = 1
const MIN_EMBEDDED_SECONDS = 0.25
/** An utterance is one unit when every window stays within this cosine of the utterance mean. */
const CONSISTENT = 0.5
/** Otherwise, runs of neighboring windows at or above this cosine become units. */
const NEIGHBOR = 0.4
/** Clusters with less speech are pending: they may still be merged away. */
const ESTABLISHED_SECONDS = 4
/** Minimum centroid cosine to keep a speaker number from one clustering run to the next. */
const MATCH = 0.6
const SHORT_MATCH = 0.3
/**
 * A pending cluster this close to an established speaker borrows that speaker's label instead of a
 * new number; such clusters are mostly fragments around speaker changes. On AMI test and AliMeeting
 * Eval utterances cut at speaker changes, this reduced the extra speaker numbers per recording from
 * 4.6 to 2.7 and from 3.8 to 0.9, and accuracy in the first two minutes rose by about 2.5 points.
 */
const BORROW = 0.3
const MIXED_SHARE = 0.8
/**
 * Adjacent 1.5 s windows below this cosine belong to different speakers. On two-speaker AliMeeting
 * sessions this found 95% of speaker changes inside utterances with 87% precision.
 */
const CHANGE = 0.3
/** A changed label is reported once it holds for this many clustering runs; on AMI this removed 77% of revisions without losing accuracy. */
const STABLE_REVISIONS = 3
const CLUSTERING: ClusteringOptions = { ahcLimit: 40, ahcThreshold: 0.4, pruning: 0.05, minNeighbors: 6, maxSpeakers: 15, mergeThreshold: 0.8 }
/** Logistic model of whether a label is right, fitted on AMI dev utterances. */
const WEIGHTS = { bias: -0.4004, short: -0.2224, logSeconds: 0.1714, best: 0.6519, margin: 0.8238, noSpeaker: -0.0285, share: 0.2209, pending: -0.2142, split: -0.2872, consistency: 0.1615, logUnits: 0.2124 }

interface Unit {
  embedding: Float32Array
  seconds: number
  turn: number
}

function level(score: number): SpeakerConfidence {
  return score >= 0.9 ? 'high' : score >= 0.7 ? 'medium' : 'low'
}

/**
 * Streaming speaker labels from speaker embeddings: after each utterance, all
 * recent embeddings are re-clustered, and speaker numbers follow cluster
 * centroids so that a speaker keeps its number when clusters merge and split.
 */
export function createSpeakerTracker(extractor: Extractor, config: NativeSpeakerTrackerConfig = {}): NativeSpeakerTracker {
  const historyLimit = config.historyLimit ?? 300

  if (!Number.isInteger(historyLimit) || historyLimit < 2)
    throw new RangeError('historyLimit must be an integer of at least 2')

  let units: Unit[] = []
  let labels: number[] = []
  /** Established speakers by id; ids are internal until first reported. */
  let profiles = new Map<number, Float32Array>()
  /** Pending clusters by id with their member units, in creation order. */
  let pendingClusters = new Map<number, Set<number>>()
  let numbers = new Map<number, number>()
  /** Per utterance: the id last reported, or undefined for utterances without units. */
  let reported: Array<number | undefined> = []
  /** Per utterance: a different id seen in consecutive clustering runs, and how many times. */
  let candidates: Array<{ id: number, count: number } | undefined> = []
  let previous = -1
  let nextId = 0
  let disposed = false

  function reset() {
    units = []
    labels = []
    profiles = new Map()
    pendingClusters = new Map()
    numbers = new Map()
    reported = []
    candidates = []
    previous = -1
    nextId = 0
  }

  function number(id: number): number | null {
    if (id < 0)
      return null

    if (!numbers.has(id))
      numbers.set(id, numbers.size)

    return numbers.get(id)!
  }

  function embed(samples: Float32Array, sampleRate: number): Float32Array | undefined {
    try {
      return normalize(extractor.extract(samples, sampleRate))
    }
    catch {
      // Digital silence, or audio shorter than the extractor's minimum, has no embedding; the
      // utterance keeps a context label. `validate` rejects invalid samples before this point.
      return undefined
    }
  }

  function nearest(embedding: Float32Array): { id: number, best: number, margin: number } | undefined {
    const ranked = [...profiles].map(([id, center]) => ({ id, cosine: dot(center, embedding) })).sort((a, b) => b.cosine - a.cosine)

    if (!ranked.length)
      return undefined

    // With one speaker, the margin is measured against -1, as in the fitted model.
    return { id: ranked[0]!.id, best: ranked[0]!.cosine, margin: ranked[0]!.cosine - (ranked[1]?.cosine ?? -1) }
  }

  function score(features: { short: boolean, seconds: number, match?: { best: number, margin: number }, share: number, pending: boolean, split: boolean, consistency: number }): number {
    const z = WEIGHTS.bias
      + WEIGHTS.short * Number(features.short)
      + WEIGHTS.logSeconds * Math.log(Math.max(features.seconds, 0.1))
      + WEIGHTS.best * (features.match?.best ?? 0)
      + WEIGHTS.margin * Math.max(features.match?.margin ?? 0, -1)
      + WEIGHTS.noSpeaker * Number(!features.match)
      + WEIGHTS.share * features.share
      + WEIGHTS.pending * Number(features.pending)
      + WEIGHTS.split * Number(features.split)
      + WEIGHTS.consistency * features.consistency
      + WEIGHTS.logUnits * Math.log1p(units.length)

    return 1 / (1 + Math.exp(-z))
  }

  /** Splits an utterance into windows, then into units that should hold one speaker each. */
  function segment(samples: Float32Array, sampleRate: number, turn: number): { added: Unit[], consistency: number } {
    const seconds = samples.length / sampleRate
    const length = Math.min(samples.length, Math.round(WINDOW_SECONDS * sampleRate))
    const hop = Math.round(HOP_SECONDS * sampleRate)
    const starts: number[] = []

    for (let start = 0; start + length <= samples.length; start += hop)
      starts.push(start)

    if (samples.length - length - starts.at(-1)! > sampleRate / 1000)
      starts.push(samples.length - length)

    const windows = starts
      .map(start => ({ embedding: embed(samples.subarray(start, start + length), sampleRate), start }))
      .filter((window): window is { embedding: Float32Array, start: number } => !!window.embedding)

    if (!windows.length)
      return { added: [], consistency: 1 }

    const mean = centroid(windows.map(window => window.embedding), windows.keys())
    const consistency = Math.min(...windows.map(window => dot(window.embedding, mean)))

    if (windows.length === 1 || consistency >= CONSISTENT)
      return { added: [{ embedding: embed(samples, sampleRate) ?? mean, seconds, turn }], consistency }

    const added: Unit[] = []
    let run = [windows[0]!]

    function close() {
      if (run.length >= 2) {
        added.push({ embedding: centroid(run.map(window => window.embedding), run.keys()), seconds: (run.at(-1)!.start - run[0]!.start + length) / sampleRate, turn })
      }
      else {
        added.push({ embedding: run[0]!.embedding, seconds: length / sampleRate, turn })
      }
    }

    for (const window of windows.slice(1)) {
      if (dot(window.embedding, run.at(-1)!.embedding) >= NEIGHBOR) {
        run.push(window)
      }
      else {
        close()
        run = [window]
      }
    }

    close()

    return { added, consistency }
  }

  /** Re-clusters recent units and gives every cluster a stable id. */
  function clusterRecent(): number {
    const first = Math.max(0, units.length - historyLimit)
    const recent = units.slice(first)
    const clusters = clusterEmbeddings(recent.map(unit => unit.embedding), CLUSTERING)
    const ids = [...new Set(clusters)]
    const members = ids.map(() => new Set<number>())

    clusters.forEach((cluster, i) => members[ids.indexOf(cluster)]!.add(first + i))

    const centers = members.map(set => centroid(units.map(unit => unit.embedding), set))
    const sizes = members.map(set => [...set].reduce((sum, i) => sum + units[i]!.seconds, 0))
    const established = sizes.map(size => size >= ESTABLISHED_SECONDS)

    if (!established.includes(true))
      established[sizes.indexOf(Math.max(...sizes))] = true

    // The first pending id that shares units with a cluster, in creation order.
    const pendingOf = members.map(set => [...pendingClusters].find(([, old]) => [...old].some(i => set.has(i)))?.[0])
    const assigned: Array<number | undefined> = Array.from({ length: ids.length })
    const keys = [...profiles.keys()]
    const settled = established.flatMap((value, i) => (value ? [i] : []))

    if (keys.length && settled.length) {
      const scores = settled.map(i => keys.map(key => dot(centers[i]!, profiles.get(key)!)))

      for (const [row, column] of maximumAssignment(scores)) {
        if (scores[row]![column]! >= MATCH)
          assigned[settled[row]!] = keys[column]
      }
    }

    for (const i of settled) {
      if (assigned[i] === undefined) {
        // A promoted pending cluster keeps the id it was reported with.
        const hint = pendingOf[i]

        assigned[i] = hint !== undefined && !profiles.has(hint) && !assigned.includes(hint) ? hint : nextId++
      }

      profiles.set(assigned[i]!, centers[i]!)
    }

    const taken = new Set(settled.map(i => assigned[i]))

    for (let i = 0; i < ids.length; i++) {
      if (established[i])
        continue

      if (keys.length) {
        const free = [...profiles.keys()].filter(key => !taken.has(key))
        const cosines = free.map(key => dot(profiles.get(key)!, centers[i]!))
        const best = Math.max(...cosines)

        if (cosines.length && best >= MATCH) {
          assigned[i] = free[cosines.indexOf(best)]
          continue
        }
      }

      const cosines = settled.map(j => dot(centers[j]!, centers[i]!))

      if (Math.max(...cosines) >= BORROW) {
        assigned[i] = assigned[settled[cosines.indexOf(Math.max(...cosines))]!]
        continue
      }

      const id = [...pendingClusters].find(([, old]) => [...old].some(unit => members[i]!.has(unit)))?.[0] ?? nextId++

      pendingClusters.set(id, members[i]!)
      assigned[i] = id
    }

    clusters.forEach((cluster, i) => labels[first + i] = assigned[ids.indexOf(cluster)]!)

    return first
  }

  /** Majority speaker of an utterance's units, weighted by seconds. */
  function vote(turn: number): { id: number, share: number, count: number } {
    const votes = new Map<number, number>()

    units.forEach((unit, i) => {
      if (unit.turn === turn)
        votes.set(labels[i]!, (votes.get(labels[i]!) ?? 0) + unit.seconds)
    })

    let id = -1
    let most = -Infinity
    let total = 0

    for (const [key, seconds] of votes) {
      total += seconds

      if (seconds > most) {
        most = seconds
        id = key
      }
    }

    return { id, share: most / total, count: votes.size }
  }

  function validate(samples: Float32Array, sampleRate: number) {
    if (disposed)
      throw new Error('Speaker tracker has been disposed')

    if (!(samples instanceof Float32Array))
      throw new TypeError('samples must be a Float32Array')

    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
      throw new RangeError('sampleRate must be an integer between 8000 and 192000 Hz')

    // The extractor rejects such samples too, but `embed` would hide that error behind a context label.
    for (const sample of samples) {
      if (!Number.isFinite(sample) || Math.abs(sample) > 1)
        throw new RangeError('PCM samples must be finite and between -1 and 1')
    }
  }

  return {
    track(samples, sampleRate) {
      validate(samples, sampleRate)

      const index = reported.length
      const seconds = samples.length / sampleRate

      if (seconds < MIN_WINDOWED_SECONDS) {
        const embedding = seconds >= MIN_EMBEDDED_SECONDS ? embed(samples, sampleRate) : undefined
        const match = embedding && nearest(embedding)
        const id = match && match.best >= SHORT_MATCH ? match.id : previous
        const pending = id >= 0 && !profiles.has(id)
        const value = score({ short: true, seconds, match, share: 1, pending, split: false, consistency: 1 })

        reported.push(undefined)

        return { index, speaker: number(id), score: value, confidence: level(value), pending, mixed: false, revisions: [] }
      }

      const { added, consistency } = segment(samples, sampleRate, index)

      reported.push(undefined)

      if (!added.length)
        return { index, speaker: number(previous), score: 0, confidence: 'low', pending: false, mixed: false, revisions: [] }

      units.push(...added)
      labels.push(...added.map(() => -1))

      const first = clusterRecent()
      const { id, share, count } = vote(index)
      const mine = units.flatMap((unit, i) => (unit.turn === index ? [i] : []))
      const pending = !profiles.has(id)
      const match = nearest(centroid(units.map(unit => unit.embedding), mine))
      const value = score({ short: false, seconds, match, share, pending, split: count > 1, consistency })

      // Earlier utterances in the clustered range may have moved to another speaker.
      const revisions: SpeakerRevision[] = []
      const touched = new Set(units.slice(first).map(unit => unit.turn))

      touched.delete(index)

      for (const turn of [...touched].sort((a, b) => a - b)) {
        const current = vote(turn).id
        const candidate = candidates[turn]

        if (current === reported[turn]) {
          candidates[turn] = undefined
          continue
        }

        candidates[turn] = { id: current, count: candidate?.id === current ? candidate.count + 1 : 1 }

        if (candidates[turn].count >= STABLE_REVISIONS) {
          reported[turn] = current
          candidates[turn] = undefined
          revisions.push({ index: turn, speaker: number(current) })
        }
      }

      reported[index] = id
      previous = id

      return { index, speaker: number(id), score: value, confidence: level(value), pending, mixed: share < MIXED_SHARE, revisions }
    },

    peek(samples, sampleRate) {
      validate(samples, sampleRate)

      const length = Math.round(WINDOW_SECONDS * sampleRate)
      let seconds = samples.length / sampleRate
      let embedding = seconds >= MIN_EMBEDDED_SECONDS && samples.length < 2 * length ? embed(samples, sampleRate) : undefined
      let change: number | undefined

      if (samples.length >= 2 * length) {
        // Compare the last two windows without overlap: overlapping windows hide most changes.
        const before = embed(samples.subarray(samples.length - 2 * length, samples.length - length), sampleRate)
        const after = embed(samples.subarray(samples.length - length), sampleRate)

        if (before && after && dot(before, after) < CHANGE) {
          change = (samples.length - length) / sampleRate
          seconds = WINDOW_SECONDS
          embedding = after
        }
        else {
          embedding = before && after ? centroid([before, after], [0, 1]) : before ?? after
        }
      }

      const match = embedding && nearest(embedding)
      const id = match && match.best >= SHORT_MATCH ? match.id : -1
      // The same model as for short utterances; it was fitted on finished utterances only.
      const value = score({ short: seconds < MIN_WINDOWED_SECONDS, seconds, match, share: 1, pending: false, split: false, consistency: 1 })

      // Reads numbers without assigning new ones: a speaker that `track` has not reported yet stays null.
      return { speaker: numbers.get(id) ?? null, score: value, confidence: level(value), ...(change === undefined ? {} : { change }) }
    },

    reset() {
      if (disposed)
        throw new Error('Speaker tracker has been disposed')

      reset()
    },

    dispose() {
      disposed = true
    },
  }
}
