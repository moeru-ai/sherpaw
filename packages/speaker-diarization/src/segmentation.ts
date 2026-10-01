/**
 * Frame-level speaker changes and overlap from pyannote segmentation-3.0 (the sherpa-onnx export).
 * The model takes 16 kHz mono PCM of any length. Per frame, it returns scores for 7 classes:
 * nobody, one of 3 local speakers, or one of 3 pairs of local speakers.
 */

/** Sample rate that the segmentation model requires. */
export const SEGMENTATION_SAMPLE_RATE = 16000
const FRAME_SHIFT = 270
const RECEPTIVE_FIELD = 991
const CLASSES = 7
/** Shorter input produces no frames. */
export const MIN_SEGMENTATION_SAMPLES = 2 * RECEPTIVE_FIELD
/** Seconds between two frames: 16.875 ms. */
export const FRAME_SECONDS = FRAME_SHIFT / SEGMENTATION_SAMPLE_RATE

/** Runs the model on 16 kHz samples and returns the flat frame-by-class scores. */
export type Segment = (samples: Float32Array) => Promise<Float32Array>

export interface Frames {
  /** Per frame: the local speaker who talks alone (0-2), or -1 for nobody or two people. */
  owner: Int8Array
  /** Per frame: the probability that two local speakers talk at once. */
  overlap: Float32Array
  /** Per frame: the probability that anyone speaks, 1 - p(nobody). */
  speech: Float32Array
}

/** Frame time: the center of the frame's receptive field, in seconds from the start of the input. */
export function frameTime(frame: number): number {
  return (frame * FRAME_SHIFT + RECEPTIVE_FIELD / 2) / SEGMENTATION_SAMPLE_RATE
}

export function decode(scores: Float32Array): Frames {
  const count = Math.floor(scores.length / CLASSES)
  const owner = new Int8Array(count)
  const overlap = new Float32Array(count)
  const speech = new Float32Array(count)

  for (let frame = 0; frame < count; frame++) {
    const row = scores.subarray(frame * CLASSES, (frame + 1) * CLASSES)
    let best = 0
    let max = -Infinity

    for (let k = 0; k < CLASSES; k++) {
      if (row[k]! > max) {
        max = row[k]!
        best = k
      }
    }

    let total = 0
    let pairs = 0
    let nobody = 0

    for (let k = 0; k < CLASSES; k++) {
      const p = Math.exp(row[k]! - max)

      total += p

      if (k === 0)
        nobody = p
      else if (k >= 4)
        pairs += p
    }

    owner[frame] = best >= 1 && best <= 3 ? best - 1 : -1
    overlap[frame] = pairs / total
    speech[frame] = 1 - nobody / total
  }

  return { owner, overlap, speech }
}

/**
 * Speaker changes in one segmentation window, in seconds from its start. Each change is midway
 * between runs of two different local speakers who each talk alone for at least `run` seconds. Shorter runs,
 * silence and overlap between two runs of the same speaker do not break that run.
 */
export function findChanges(frames: Frames, run: number): number[] {
  const { owner } = frames
  const runs: Array<{ speaker: number, start: number, end: number }> = []

  for (let i = 0; i < owner.length;) {
    let j = i

    while (j < owner.length && owner[j] === owner[i])
      j++

    if (owner[i]! >= 0 && (j - i) * FRAME_SECONDS >= run) {
      const last = runs.at(-1)

      if (last?.speaker === owner[i])
        last.end = frameTime(j - 1)
      else
        runs.push({ speaker: owner[i]!, start: frameTime(i), end: frameTime(j - 1) })
    }

    i = j
  }

  return runs.slice(1).map((next, i) => (runs[i]!.end + next.start) / 2)
}

/** Seconds in which two people talk at once with probability above `threshold`. */
export function overlapSeconds(frames: Frames, threshold = 0.5): number {
  return frames.overlap.reduce((sum, p) => sum + (p > threshold ? FRAME_SECONDS : 0), 0)
}
