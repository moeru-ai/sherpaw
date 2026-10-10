import { SPEAKERS } from './stream'

const frameSeconds = 0.01

export interface SortformerTurn {
  start: number
  end: number
  speaker: number
  overlapSeconds: number
}

export interface TurnOptions {
  /** A speaker talks in a frame above this probability, and the most likely one leads. Default: 0.5, NeMo's value for this model. */
  threshold?: number
  /** Shorter runs of one leading speaker are dropped. Default: 0.3 s, not tuned. */
  minTurnSeconds?: number
  /** One speaker's runs join across shorter gaps, like the 0.5 s VAD silence of the CAM++ tracker. Default: 0.5 s, not tuned. */
  joinGapSeconds?: number
  /**
   * A new speaker often talks before they lead. Their turn starts where their probability rises above
   * the previous speaker's and is at least `floor`, at most `maxSeconds` earlier. On 26 quick speaker
   * changes in AliMeeting meetings at 1.04 s latency, the first word then went to the previous turn in
   * 1 change instead of 4, without more false cuts. `false` starts the turn where the speaker leads.
   * Default: `{ floor: 0.1, maxSeconds: 1 }`.
   */
  crossing?: { floor?: number, maxSeconds?: number } | false
}

/** The values that `turnsOf` uses for missing options. */
export const defaultTurnOptions: Readonly<Required<Omit<TurnOptions, 'crossing'>> & { crossing: Readonly<{ floor: number, maxSeconds: number }> }> = Object.freeze({
  threshold: 0.5,
  minTurnSeconds: 0.3,
  joinGapSeconds: 0.5,
  crossing: Object.freeze({ floor: 0.1, maxSeconds: 1 }),
})

type ResolvedTurnOptions = Required<Omit<TurnOptions, 'crossing'>> & { crossing: Readonly<{ floor: number, maxSeconds: number }> | false }

function resolveOptions(options: TurnOptions = {}): ResolvedTurnOptions {
  const resolved: ResolvedTurnOptions = { ...defaultTurnOptions, crossing: defaultTurnOptions.crossing }

  for (const [key, value] of Object.entries(options)) {
    if (!['threshold', 'minTurnSeconds', 'joinGapSeconds', 'crossing'].includes(key))
      throw new TypeError(`Unknown turn option: ${key}`)

    if (value === undefined)
      continue

    if (key === 'crossing') {
      if (value === false) {
        resolved.crossing = false
        continue
      }

      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new TypeError('crossing must be false or an options object')

      const crossing = { ...defaultTurnOptions.crossing }

      for (const [crossingKey, crossingValue] of Object.entries(value)) {
        if (crossingKey !== 'floor' && crossingKey !== 'maxSeconds')
          throw new TypeError(`Unknown crossing option: ${crossingKey}`)

        if (crossingValue === undefined)
          continue

        if (typeof crossingValue !== 'number' || !Number.isFinite(crossingValue))
          throw new TypeError(`crossing.${crossingKey} must be a finite number`)

        if (crossingKey === 'floor' && (crossingValue < 0 || crossingValue > 1))
          throw new RangeError('crossing.floor must be between 0 and 1')

        if (crossingKey === 'maxSeconds' && crossingValue < 0)
          throw new RangeError('crossing.maxSeconds must not be negative')

        crossing[crossingKey] = crossingValue
      }

      resolved.crossing = crossing
      continue
    }

    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new TypeError(`${key} must be a finite number`)

    if (key === 'threshold' && (value < 0 || value > 1))
      throw new RangeError('threshold must be between 0 and 1')

    if (key !== 'threshold' && value < 0)
      throw new RangeError(`${key} must not be negative`)

    if (key === 'threshold')
      resolved.threshold = value
    else if (key === 'minTurnSeconds')
      resolved.minTurnSeconds = value
    else
      resolved.joinGapSeconds = value
  }

  return resolved
}

// The values come from the model, so only the length is checked: callers run this on the whole session often.
function validateTimeline(probabilities: Float32Array, frames: number) {
  if (!Number.isInteger(frames) || frames < 0)
    throw new RangeError('frames must be a non-negative integer')

  if (probabilities.length < frames * SPEAKERS)
    throw new RangeError('probabilities do not contain every frame')
}

function speakerAt(probabilities: Float32Array, frame: number, threshold: number) {
  let speaker: number | undefined
  let best = threshold

  for (let index = 0; index < SPEAKERS; index++) {
    const probability = probabilities[frame * SPEAKERS + index]!

    if (probability > best) {
      best = probability
      speaker = index
    }
  }

  return speaker
}

/** Returns the dominant-speaker turns in a 10 ms probability timeline. */
export function turnsOf(probabilities: Float32Array, frames: number, options?: TurnOptions): SortformerTurn[] {
  const { threshold, minTurnSeconds, joinGapSeconds, crossing } = resolveOptions(options)
  validateTimeline(probabilities, frames)
  const minimumFrames = Math.round(minTurnSeconds / frameSeconds)
  const joinGapFrames = Math.round(joinGapSeconds / frameSeconds)
  const labels = Array.from({ length: frames }, (_, frame) => speakerAt(probabilities, frame, threshold))
  let start = 0

  while (start < frames) {
    const speaker = labels[start]
    let end = start + 1

    while (end < frames && labels[end] === speaker)
      end++

    if (speaker !== undefined && end - start < minimumFrames)
      labels.fill(undefined, start, end)

    start = end
  }

  const spans: Array<{ start: number, end: number, speaker: number }> = []
  let frame = 0

  while (frame < frames) {
    const speaker = labels[frame]

    if (speaker === undefined) {
      frame++
      continue
    }

    const startFrame = frame
    let endFrame = frame + 1

    while (endFrame < frames) {
      if (labels[endFrame] === speaker) {
        endFrame++
        continue
      }

      if (labels[endFrame] !== undefined)
        break

      const gapStart = endFrame

      while (endFrame < frames && labels[endFrame] === undefined)
        endFrame++

      if (endFrame - gapStart >= joinGapFrames || labels[endFrame] !== speaker) {
        endFrame = gapStart
        break
      }
    }

    spans.push({ start: startFrame, end: endFrame, speaker })
    frame = endFrame
  }

  if (crossing) {
    for (let index = 1; index < spans.length; index++) {
      const previous = spans[index - 1]!
      const span = spans[index]!

      if (previous.speaker === span.speaker)
        continue

      const floor = Math.max(previous.start, span.start - Math.round(crossing.maxSeconds / frameSeconds))

      while (span.start > floor) {
        const probability = probabilities[(span.start - 1) * SPEAKERS + span.speaker]!

        if (probability < crossing.floor || probability <= probabilities[(span.start - 1) * SPEAKERS + previous.speaker]!)
          break

        span.start--
      }

      previous.end = Math.min(previous.end, span.start)
    }
  }

  return spans.map(({ start, end, speaker }) => {
    let overlapFrames = 0

    for (let current = start; current < end; current++) {
      for (let other = 0; other < SPEAKERS; other++) {
        if (other !== speaker && probabilities[current * SPEAKERS + other]! > threshold) {
          overlapFrames++
          break
        }
      }
    }

    return { start: start * frameSeconds, end: end * frameSeconds, speaker, overlapSeconds: overlapFrames * frameSeconds }
  })
}

/** Returns speakers above the threshold in the most recent probability frames. */
export function activeSpeakers(probabilities: Float32Array, frames: number, lastSeconds: number, threshold = 0.5) {
  validateTimeline(probabilities, frames)

  if (typeof lastSeconds !== 'number' || !Number.isFinite(lastSeconds))
    throw new TypeError('lastSeconds must be a finite number')

  if (lastSeconds < 0)
    throw new RangeError('lastSeconds must not be negative')

  if (typeof threshold !== 'number' || !Number.isFinite(threshold))
    throw new TypeError('threshold must be a finite number')

  if (threshold < 0 || threshold > 1)
    throw new RangeError('threshold must be between 0 and 1')
  const active = new Set<number>()
  const first = Math.max(0, frames - Math.ceil(lastSeconds / frameSeconds))

  for (let frame = first; frame < frames; frame++) {
    for (let speaker = 0; speaker < SPEAKERS; speaker++) {
      if (probabilities[frame * SPEAKERS + speaker]! > threshold)
        active.add(speaker)
    }
  }

  return [...active]
}
