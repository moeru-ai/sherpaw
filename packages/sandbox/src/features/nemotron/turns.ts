// cspell:ignore Nemotron
import { SPEAKERS } from './stream'

const frameSeconds = 0.01
const threshold = 0.5
const minimumFrames = 30
const joinGapFrames = 50
/**
 * A new speaker often starts to talk before they lead above the threshold. Their turn starts where
 * their probability rises above the previous speaker's and is at least `crossingFloor`, at most this
 * many frames earlier. On 26 quick speaker changes in AliMeeting meetings, the first word then went
 * to the previous turn in 1 change instead of 4, without more false cuts.
 */
const crossingFrames = 100
const crossingFloor = 0.1

export interface NemotronTurn {
  start: number
  end: number
  speaker: number
  overlapSeconds: number
}

function speakerAt(probabilities: Float32Array, frame: number) {
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
export function turnsOf(probabilities: Float32Array, frames: number): NemotronTurn[] {
  const labels = Array.from({ length: frames }, (_, frame) => speakerAt(probabilities, frame))
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

  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1]!
    const span = spans[index]!

    if (previous.speaker === span.speaker)
      continue

    const floor = Math.max(previous.start, span.start - crossingFrames)

    while (span.start > floor) {
      const probability = probabilities[(span.start - 1) * SPEAKERS + span.speaker]!

      if (probability < crossingFloor || probability <= probabilities[(span.start - 1) * SPEAKERS + previous.speaker]!)
        break

      span.start--
    }

    previous.end = Math.min(previous.end, span.start)
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
export function activeSpeakers(probabilities: Float32Array, frames: number, lastSeconds: number) {
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
