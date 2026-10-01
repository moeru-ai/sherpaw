import type { SpeakerTrackerTuning } from './types'

/** Tuned with CAM++ on AMI and AliMeeting meetings. */
export const defaultSpeakerTrackerTuning: Readonly<SpeakerTrackerTuning> = Object.freeze({
  clusterThreshold: 0.4,
  mergeThreshold: 0.8,
  matchThreshold: 0.6,
  enrollThreshold: 0.4,
  establishedSeconds: 4,
  borrowThreshold: 0.3,
  nearestThreshold: 0.3,
  changeThreshold: 0.3,
  maxSpeakers: 15,
  segmentationRunSeconds: 0.3,
  segmentationMarginSeconds: 0.5,
  overlapSeconds: 0.5,
})

const cosines = new Set<keyof SpeakerTrackerTuning>(['clusterThreshold', 'mergeThreshold', 'matchThreshold', 'enrollThreshold', 'borrowThreshold', 'nearestThreshold', 'changeThreshold'])

/** Fills in defaults and rejects unknown names and out-of-range values. */
export function resolveTuning(tuning: Partial<SpeakerTrackerTuning> = {}): SpeakerTrackerTuning {
  const resolved = { ...defaultSpeakerTrackerTuning }

  for (const [key, value] of Object.entries(tuning)) {
    if (!(key in defaultSpeakerTrackerTuning))
      throw new TypeError(`Unknown tracker tuning parameter: ${key}`)

    if (value === undefined)
      continue

    const name = key as keyof SpeakerTrackerTuning

    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new TypeError(`${name} must be a finite number`)

    if (cosines.has(name) && (value < -1 || value > 1))
      throw new RangeError(`${name} is a cosine and must be between -1 and 1`)

    if (name === 'maxSpeakers' && (!Number.isInteger(value) || value < 1))
      throw new RangeError('maxSpeakers must be an integer of at least 1')

    if (!cosines.has(name) && value < 0)
      throw new RangeError(`${name} must not be negative`)

    resolved[name] = value
  }

  return resolved
}
