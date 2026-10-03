// cspell:ignore Nemotron
import { SPEAKERS } from './stream'

const frameSeconds = 0.01
const threshold = 0.5
const minimumFrames = 30
const joinGapFrames = 50

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

  const turns: NemotronTurn[] = []
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

    let overlapFrames = 0

    for (let current = startFrame; current < endFrame; current++) {
      for (let other = 0; other < SPEAKERS; other++) {
        if (other !== speaker && probabilities[current * SPEAKERS + other]! > threshold) {
          overlapFrames++
          break
        }
      }
    }

    turns.push({ start: startFrame * frameSeconds, end: endFrame * frameSeconds, speaker, overlapSeconds: overlapFrames * frameSeconds })
    frame = endFrame
  }

  return turns
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
