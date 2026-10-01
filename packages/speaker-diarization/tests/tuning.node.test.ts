import { describe, expect, it } from 'vitest'

import { defaultSpeakerTrackerTuning, resolveTuning } from '../src/tuning'

describe('speaker tracker tuning', () => {
  it('fills in the defaults', () => {
    expect(resolveTuning()).toEqual(defaultSpeakerTrackerTuning)
    expect(resolveTuning({ clusterThreshold: 0.5 })).toMatchObject({ clusterThreshold: 0.5, matchThreshold: 0.6 })
  })

  it('rejects unknown names and out-of-range values', () => {
    expect(() => resolveTuning({ clusterLimit: 0.5 } as never)).toThrow('Unknown tracker tuning parameter: clusterLimit')
    expect(() => resolveTuning({ matchThreshold: 2 })).toThrow('between -1 and 1')
    expect(() => resolveTuning({ establishedSeconds: -1 })).toThrow('must not be negative')
    expect(() => resolveTuning({ maxSpeakers: 1.5 })).toThrow('integer')
    expect(() => resolveTuning({ borrowThreshold: Number.NaN })).toThrow('finite')
  })
})
