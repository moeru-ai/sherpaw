// cspell:ignore nemotron
import { describe, expect, it } from 'vitest'

import { recommendProfile } from '../../src/features/nemotron/stream'

describe('nemotron speed', () => {
  it('picks the lowest latency under the limit', () => {
    expect(recommendProfile([
      { profile: 'low', latencySeconds: 1.04, stepMs: 100, realTimeFactor: 0.14 },
      { profile: 'veryLow', latencySeconds: 0.64, stepMs: 100, realTimeFactor: 0.21 },
    ])).toBe('veryLow')
  })

  it('skips a faster-latency profile above the limit', () => {
    expect(recommendProfile([
      { profile: 'veryLow', latencySeconds: 0.64, stepMs: 400, realTimeFactor: 0.83 },
      { profile: 'low', latencySeconds: 1.04, stepMs: 300, realTimeFactor: 0.42 },
    ])).toBe('low')
  })

  it('returns undefined when no profile qualifies', () => {
    expect(recommendProfile([
      { profile: 'low', latencySeconds: 1.04, stepMs: 600, realTimeFactor: 0.83 },
      { profile: 'veryLow', latencySeconds: 0.64, stepMs: 400, realTimeFactor: 0.83 },
    ])).toBeUndefined()
  })

  it('respects a custom limit', () => {
    expect(recommendProfile([
      { profile: 'low', latencySeconds: 1.04, stepMs: 300, realTimeFactor: 0.42 },
      { profile: 'veryLow', latencySeconds: 0.64, stepMs: 400, realTimeFactor: 0.83 },
    ], 0.9)).toBe('veryLow')
  })
})
