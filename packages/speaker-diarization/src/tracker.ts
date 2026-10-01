import type { Extractor } from '@sherpaw/speaker-identification'

import type { ClusteringOptions } from './clustering'
import type { Segment } from './segmentation'
import type { SpeakerConfidence, SpeakerGuess, SpeakerMap, SpeakerRevision, SpeakerTrackerResetOptions, SpeakerTrackerTuning, SpeakerTurn } from './types'

import { centroid, clusterEmbeddings, dot, maximumAssignment, normalize } from './clustering'
import { decode, findChanges, MIN_SEGMENTATION_SAMPLES, overlapSeconds, SEGMENTATION_SAMPLE_RATE } from './segmentation'
import { resolveTuning } from './tuning'

export interface NativeSpeakerTrackerConfig {
  /** Re-cluster at most this many recent embeddings after each utterance. Default: 300. */
  historyLimit?: number
  /** Runs pyannote segmentation-3.0; enables frame-level speaker changes and overlap flags for 16 kHz audio. */
  segment?: Segment
  /** Parameters to change. The others keep their values from `defaultSpeakerTrackerTuning`. Unknown names throw. */
  tuning?: Partial<SpeakerTrackerTuning>
}

export interface NativeSpeakerTracker {
  /** Labels one utterance of mono PCM. Call in time order. */
  track: (samples: Float32Array, sampleRate: number) => Promise<SpeakerTurn>
  /** Guesses the nearest established speaker and finds speaker changes without changing any state. */
  peek: (samples: Float32Array, sampleRate: number, options?: { final?: boolean }) => Promise<SpeakerGuess>
  /** Adds a known speaker from at least 5 s of their speech and returns their speaker number. */
  enroll: (samples: Float32Array, sampleRate: number) => number
  /** Copies of the recently clustered units and the numbered speakers' references. Changes nothing. */
  inspect: () => SpeakerMap
  /** Per segmentation frame of at most 10 s of 16 kHz audio: the probability that anyone speaks. Needs `segment`. */
  speech: (samples: Float32Array, sampleRate: number) => Promise<Float32Array>
  /** Forgets tracked speakers and starts a new session. Enrolled speakers stay unless `forgetEnrolled` is true. */
  reset: (options?: SpeakerTrackerResetOptions) => void
  /** Idempotent. Track throws after disposal. The extractor stays with its owner. */
  dispose: () => void
}

// The window and hop follow 3D-Speaker's CAM++ diarization; other lengths were not tried.
const WINDOW_SECONDS = 1.5
const HOP_SECONDS = 0.75
// The values below come from tuning on the AMI dev set. Callers can change the ones in SpeakerTrackerTuning.
/** Shorter utterances are labeled from the nearest speaker but never clustered. */
const MIN_WINDOWED_SECONDS = 1
const MIN_EMBEDDED_SECONDS = 0.25
/** An utterance is one unit when every window stays within this cosine of the utterance mean. */
const CONSISTENT = 0.5
/** Otherwise, runs of neighboring windows at or above this cosine become units. */
const NEIGHBOR = 0.4
const MIXED_SHARE = 0.8
/**
 * Segmentation-based speaker changes, from simulations of the sandbox page on AliMeeting, AMI and
 * MagicData Mandarin conversations: each call looks at the last 10 s. The tracker ignores changes
 * closer than 0.3 s to either end of the audio.
 */
const SEGMENT_WINDOW_SECONDS = 10
const SEGMENT_MIN_PIECE_SECONDS = 0.3
/** Enrollment needs at least this much audio. The evaluated enrollments used 5-30 s of speech. */
const MIN_ENROLL_SECONDS = 5
/**
 * Enrollment audio must be one voice: its largest group of similar 1.5 s windows must hold this share
 * of the windows. A test on talk shows enrolled 4 s of the person plus 4 s of someone else. The
 * enrolled number then went to other people 37% of the time. With a clean enrollment, it went to them
 * 4% of the time.
 */
const MIN_ENROLL_SHARE = 0.6
/** Windows of one voice stay in one group down to this average cosine. Different people rarely reach it. */
const ENROLL_GROUP_COSINE = 0.3
/** A changed label is reported once it holds for this many clustering runs; on AMI this removed 77% of revisions without losing accuracy. */
const STABLE_REVISIONS = 3
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
  const segmenter = config.segment
  const tuning = resolveTuning(config.tuning)
  const clustering: ClusteringOptions = { ahcLimit: 40, ahcThreshold: tuning.clusterThreshold, pruning: 0.05, minNeighbors: 6, maxSpeakers: tuning.maxSpeakers, mergeThreshold: tuning.mergeThreshold }

  if (!Number.isInteger(historyLimit) || historyLimit < 2)
    throw new RangeError('historyLimit must be an integer of at least 2')

  let units: Unit[] = []
  let labels: number[] = []
  /** Established speakers by id; ids are internal until first reported. */
  let profiles = new Map<number, Float32Array>()
  /** Pending clusters by id with their member units, in creation order. */
  let pendingClusters = new Map<number, Set<number>>()
  let numbers = new Map<number, number>()
  let nextNumber = 0
  /** Enrolled speakers by id. The tracker compares clusters with this embedding, which never changes. */
  let anchors = new Map<number, Float32Array>()
  /** Per utterance: the id last reported, or undefined for utterances without units. */
  let reported: Array<number | undefined> = []
  /** Per utterance: a different id seen in consecutive clustering runs, and how many times. */
  let candidates: Array<{ id: number, count: number } | undefined> = []
  let previous = -1
  let nextId = 0
  let disposed = false

  function reset(forgetEnrolled = false) {
    units = []
    labels = []
    pendingClusters = new Map()
    reported = []
    candidates = []
    previous = -1

    if (forgetEnrolled)
      anchors = new Map()

    // Enrolled speakers start the new session from their enrolled embedding, numbered 0, 1, ... in
    // enrollment order. Other speakers follow them.
    profiles = new Map(anchors)
    numbers = new Map([...anchors.keys()].map((id, i) => [id, i]))
    nextNumber = anchors.size

    if (!anchors.size)
      nextId = 0
  }

  function number(id: number): number | null {
    if (id < 0)
      return null

    if (!numbers.has(id))
      numbers.set(id, nextNumber++)

    return numbers.get(id)!
  }

  /** The embedding that the tracker compares a cluster centroid with: the enrolled embedding, or the speaker's centroid. */
  function reference(id: number): Float32Array {
    return anchors.get(id) ?? profiles.get(id)!
  }

  function threshold(id: number): number {
    return anchors.has(id) ? tuning.enrollThreshold : tuning.matchThreshold
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

  /** Short utterances and live guesses take an enrolled speaker only at the enrolled threshold. */
  function nearestThreshold(id: number): number {
    return anchors.has(id) ? Math.max(tuning.nearestThreshold, tuning.enrollThreshold) : tuning.nearestThreshold
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
    const clusters = clusterEmbeddings(recent.map(unit => unit.embedding), clustering)
    const ids = [...new Set(clusters)]
    const members = ids.map(() => new Set<number>())

    clusters.forEach((cluster, i) => members[ids.indexOf(cluster)]!.add(first + i))

    const centers = members.map(set => centroid(units.map(unit => unit.embedding), set))
    const sizes = members.map(set => [...set].reduce((sum, i) => sum + units[i]!.seconds, 0))
    const established = sizes.map(size => size >= tuning.establishedSeconds)

    if (!established.includes(true))
      established[sizes.indexOf(Math.max(...sizes))] = true

    // The first pending id that shares units with a cluster, in creation order.
    const pendingOf = members.map(set => [...pendingClusters].find(([, old]) => [...old].some(i => set.has(i)))?.[0])
    const assigned: Array<number | undefined> = Array.from({ length: ids.length })
    const keys = [...profiles.keys()]
    const settled = established.flatMap((value, i) => (value ? [i] : []))

    if (keys.length && settled.length) {
      const scores = settled.map(i => keys.map(key => dot(centers[i]!, reference(key))))

      for (const [row, column] of maximumAssignment(scores)) {
        if (scores[row]![column]! >= threshold(keys[column]!))
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
    const free = [...profiles.keys()].filter(key => !taken.has(key))
    // Each pending cluster's closest free speaker. An enrolled speaker's number goes to at most one
    // pending cluster, the closest one. Without this rule, every new voice near the enrolled one takes
    // that number, before the enrolled person speaks long enough to become established.
    const closest = members.map((_, i) => {
      if (established[i] || !free.length)
        return undefined

      const cosines = free.map(key => dot(reference(key), centers[i]!))
      const best = Math.max(...cosines)
      const key = free[cosines.indexOf(best)]!

      return best >= threshold(key) ? { key, cosine: best } : undefined
    })

    for (let i = 0; i < ids.length; i++) {
      if (established[i])
        continue

      const match = closest[i]

      if (match && (!anchors.has(match.key) || closest.every(other => other?.key !== match.key || other.cosine <= match.cosine))) {
        assigned[i] = match.key
        continue
      }

      // Borrow only when the closest established speaker is not enrolled. A new voice gets an enrolled
      // number only through the rule above, at `enrollThreshold`. A voice closest to an enrolled
      // speaker stays new, so that it does not take the number of the next closest speaker.
      const cosines = settled.map(j => dot(centers[j]!, centers[i]!))
      const best = Math.max(...cosines)
      const lender = assigned[settled[cosines.indexOf(best)]!]!

      if (best >= tuning.borrowThreshold && !anchors.has(lender)) {
        assigned[i] = lender
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

  function segmented(sampleRate: number): Segment | undefined {
    return sampleRate === SEGMENTATION_SAMPLE_RATE ? segmenter : undefined
  }

  /** Changes inside [start, end) seconds of the samples, in seconds from the start of the samples. */
  async function changesWithin(run: Segment, samples: Float32Array, start: number, end: number): Promise<number[]> {
    const piece = samples.subarray(Math.round(start * SEGMENTATION_SAMPLE_RATE), Math.round(end * SEGMENTATION_SAMPLE_RATE))

    if (piece.length < MIN_SEGMENTATION_SAMPLES)
      return []

    return findChanges(decode(await run(piece)), tuning.segmentationRunSeconds).map(change => start + change)
  }

  /**
   * Speaker changes in audio that starts at the last known change. Without `final`, the tracker
   * segments only the last window, and changes near its end wait for more audio. With `final`, the
   * audio is complete, and the tracker segments it window by window from the start.
   */
  async function segmentChanges(run: Segment, samples: Float32Array, final: boolean): Promise<number[]> {
    const seconds = samples.length / SEGMENTATION_SAMPLE_RATE

    if (!final) {
      const found = await changesWithin(run, samples, Math.max(0, seconds - SEGMENT_WINDOW_SECONDS), seconds)

      return found.filter(change => change >= SEGMENT_MIN_PIECE_SECONDS && change <= seconds - tuning.segmentationMarginSeconds)
    }

    const changes: number[] = []

    for (let start = 0; ;) {
      const end = Math.min(start + SEGMENT_WINDOW_SECONDS, seconds)
      const last = end >= seconds
      const found = (await changesWithin(run, samples, start, end))
        .filter(change => change >= start + SEGMENT_MIN_PIECE_SECONDS && change <= end - (last ? SEGMENT_MIN_PIECE_SECONDS : tuning.segmentationMarginSeconds))

      changes.push(...found)

      if (last)
        return changes

      // Always move forward: a margin as long as the window would otherwise segment the same audio again.
      start = found.at(-1) ?? Math.max(start + SEGMENT_MIN_PIECE_SECONDS, end - tuning.segmentationMarginSeconds)
    }
  }

  /** Whether two people talk at once for long enough, segmenting the utterance in 10 s windows. */
  async function overlapping(run: Segment, samples: Float32Array): Promise<boolean> {
    const window = SEGMENT_WINDOW_SECONDS * SEGMENTATION_SAMPLE_RATE
    let seconds = 0

    for (let start = 0; start + MIN_SEGMENTATION_SAMPLES <= samples.length; start += window)
      seconds += overlapSeconds(decode(await run(samples.subarray(start, start + window))))

    return seconds >= tuning.overlapSeconds
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
    async track(samples, sampleRate) {
      validate(samples, sampleRate)

      const seconds = samples.length / sampleRate
      const run = segmented(sampleRate)
      // Segmentation runs before any state changes, so the rest of the call cannot interleave with another.
      const overlap = run !== undefined && seconds >= MIN_WINDOWED_SECONDS && await overlapping(run, samples)

      validate(samples, sampleRate)

      const index = reported.length

      if (seconds < MIN_WINDOWED_SECONDS) {
        const embedding = seconds >= MIN_EMBEDDED_SECONDS ? embed(samples, sampleRate) : undefined
        const match = embedding && nearest(embedding)
        const id = match && match.best >= nearestThreshold(match.id) ? match.id : previous
        const pending = id >= 0 && !profiles.has(id)
        const value = score({ short: true, seconds, match, share: 1, pending, split: false, consistency: 1 })

        reported.push(undefined)

        return { index, speaker: number(id), score: value, confidence: level(value), pending, mixed: false, overlap, revisions: [] }
      }

      const { added, consistency } = segment(samples, sampleRate, index)

      reported.push(undefined)

      if (!added.length)
        return { index, speaker: number(previous), score: 0, confidence: 'low', pending: false, mixed: false, overlap, revisions: [] }

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

      return { index, speaker: number(id), score: value, confidence: level(value), pending, mixed: share < MIXED_SHARE, overlap, revisions }
    },

    async peek(samples, sampleRate, options = {}) {
      validate(samples, sampleRate)

      const length = Math.round(WINDOW_SECONDS * sampleRate)
      const run = segmented(sampleRate)
      const changes = run ? await segmentChanges(run, samples, options.final ?? false) : []

      validate(samples, sampleRate)

      let before: Float32Array | undefined
      let after: Float32Array | undefined
      let windowChange: number | undefined

      if (samples.length >= 2 * length) {
        // Compare the last two windows without overlap: overlapping windows hide most changes.
        before = embed(samples.subarray(samples.length - 2 * length, samples.length - length), sampleRate)
        after = embed(samples.subarray(samples.length - length), sampleRate)

        if (before && after && dot(before, after) < tuning.changeThreshold)
          windowChange = (samples.length - length) / sampleRate
      }

      // The guess covers the audio after the last change, at most its last 3 s.
      const from = Math.max(
        0,
        samples.length - 2 * length,
        ...changes.map(change => Math.round(change * sampleRate)),
        windowChange === undefined ? 0 : samples.length - length,
      )
      const seconds = (samples.length - from) / sampleRate
      let embedding: Float32Array | undefined

      if (samples.length >= 2 * length && from === samples.length - 2 * length)
        embedding = before && after ? centroid([before, after], [0, 1]) : before ?? after
      else if (windowChange !== undefined && from === samples.length - length)
        embedding = after
      else if (seconds >= MIN_EMBEDDED_SECONDS)
        embedding = embed(samples.subarray(from), sampleRate)

      const match = embedding && nearest(embedding)
      const id = match && match.best >= nearestThreshold(match.id) ? match.id : -1
      // The same model as for short utterances; it was fitted on finished utterances only.
      const value = score({ short: seconds < MIN_WINDOWED_SECONDS, seconds, match, share: 1, pending: false, split: false, consistency: 1 })

      // Reads numbers without assigning new ones: a speaker that `track` has not reported yet stays null.
      return { speaker: numbers.get(id) ?? null, score: value, confidence: level(value), changes, ...(windowChange === undefined ? {} : { windowChange }) }
    },

    enroll(samples, sampleRate) {
      validate(samples, sampleRate)

      if (samples.length < MIN_ENROLL_SECONDS * sampleRate)
        throw new RangeError(`Enrollment needs at least ${MIN_ENROLL_SECONDS} s of speech`)

      // Group the 1.5 s windows by voice. The largest group makes the enrolled embedding.
      const length = Math.round(WINDOW_SECONDS * sampleRate)
      const hop = Math.round(HOP_SECONDS * sampleRate)
      const windows: Float32Array[] = []
      const starts: number[] = []

      for (let start = 0; start + length <= samples.length; start += hop) {
        const window = embed(samples.subarray(start, start + length), sampleRate)

        if (window) {
          windows.push(window)
          starts.push(start)
        }
      }

      if (!windows.length)
        throw new Error('The enrollment audio has no speaker embedding')

      const groups = clusterEmbeddings(windows, { ...clustering, ahcLimit: Number.POSITIVE_INFINITY, ahcThreshold: ENROLL_GROUP_COSINE })
      const sizes = new Map<number, number>()

      groups.forEach(group => sizes.set(group, (sizes.get(group) ?? 0) + 1))

      const [largest, size] = [...sizes].sort((a, b) => b[1] - a[1])[0]!
      const share = size / windows.length

      if (share < MIN_ENROLL_SHARE)
        throw new Error(`The enrollment audio sounds like more than one voice: the main voice is ${Math.round(share * 100)}% of it. Enroll speech of one person only.`)

      // One embedding of the audio that the main voice's windows cover: longer audio gives a steadier
      // embedding than the average of 1.5 s windows.
      const kept = new Uint8Array(samples.length)

      groups.forEach((group, i) => group === largest && kept.fill(1, starts[i]!, starts[i]! + length))

      const main = samples.filter((_, i) => kept[i] === 1)
      const embedding = embed(main, sampleRate) ?? centroid(windows, [...groups.keys()].filter(i => groups[i] === largest))

      const id = nextId++

      anchors.set(id, embedding)
      profiles.set(id, embedding)

      return number(id)!
    },

    async speech(samples, sampleRate) {
      validate(samples, sampleRate)

      const run = segmented(sampleRate)

      if (!run)
        throw new Error(`speech needs the segmentation model and ${SEGMENTATION_SAMPLE_RATE} Hz audio`)

      if (samples.length > SEGMENT_WINDOW_SECONDS * sampleRate)
        throw new RangeError(`speech takes at most ${SEGMENT_WINDOW_SECONDS} s of audio`)

      return samples.length < MIN_SEGMENTATION_SAMPLES ? new Float32Array(0) : decode(await run(samples)).speech
    },

    inspect() {
      const first = Math.max(0, units.length - historyLimit)

      // Reads numbers without assigning new ones, so that inspecting never changes the numbering.
      return {
        units: units.slice(first).map((unit, i) => ({ index: unit.turn, seconds: unit.seconds, speaker: numbers.get(labels[first + i]!) ?? null, embedding: unit.embedding.slice() })),
        speakers: [...profiles.keys()]
          .flatMap(id => (numbers.has(id) ? [{ speaker: numbers.get(id)!, enrolled: anchors.has(id), embedding: reference(id).slice() }] : []))
          .sort((a, b) => a.speaker - b.speaker),
      }
    },

    reset(options = {}) {
      if (disposed)
        throw new Error('Speaker tracker has been disposed')

      reset(options.forgetEnrolled ?? false)
    },

    dispose() {
      disposed = true
    },
  }
}
