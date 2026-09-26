import { expect, it } from 'vitest'

import { RealtimeMetrics } from '../../src/features/asr/realtime-metrics'

it('includes audio delivered late while the main thread was busy, and excludes non-inference batches from latency percentiles', () => {
  const metrics = new RealtimeMetrics()
  // A 100 ms chunk ended at 1.1 s, but its main-thread callback ran at 1.15 s.
  metrics.receive(1600, 1.1, 1.15, 150)
  metrics.receive(1600, 1.2, 1.3, 300)
  metrics.complete(1600, 1.1, 1.32, 120, true, 'hello', 320)
  metrics.complete(1600, 1.2, 1.33, 1, false, 'hello', 330)
  metrics.finish(20, 'hello', 350)
  const result = metrics.snapshot(350, 123)
  expect(result.firstTextMs).toBeCloseTo(320)
  expect(result.receivedAudioSeconds).toBeCloseTo(0.2)
  expect(result.processedAudioSeconds).toBeCloseTo(0.2)
  expect(result.captureSpanSeconds).toBeCloseTo(0.2)
  expect(result.maxOutstandingSeconds).toBeCloseTo(0.2)
  expect(result.maxDeliveryDelayMs).toBeCloseTo(100)
  expect(result.audioEndToCompletionP95Ms).toBeCloseTo(220)
  expect(result.inferenceBatchP95Ms).toBeCloseTo(120)
  expect(result.inferenceBatches).toBe(1)
  expect(result.captureGapMs).toBeCloseTo(0)
  expect(result.stopDrainMs).toBe(20)
  expect(result.gpuDispatches).toBe(123)
})

it('reports startup capture gaps separately from a later dropped quantum', () => {
  const metrics = new RealtimeMetrics()
  metrics.receive(1600, 1.1, 1.1, 100)
  metrics.receive(1600, 1.208, 1.208, 208)
  metrics.receive(16000, 2.208, 2.208, 1208)
  metrics.receive(1600, 2.316, 2.316, 1316)
  const result = metrics.snapshot(1316, 0)
  expect(result.captureGapMs).toBeCloseTo(16)
  expect(result.startupCaptureGapMs).toBeCloseTo(8)
})
