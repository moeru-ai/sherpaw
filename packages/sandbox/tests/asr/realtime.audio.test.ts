import type { AudioTestCase, AudioTestTask } from '@sherpaw/vitest-plugin-fakemic'

import { createAudioTestAPI, createAudioTestTask, runAudioTestSession, startFakemicRuntime } from '@sherpaw/vitest-plugin-fakemic'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, inject } from 'vitest'

import type { LiveBackend } from '../../src/features/webgpu-experiment/live-asr'
import type { RealtimeSession } from './prepare'

const { describe, it } = createAudioTestAPI<AudioTestCase, AudioTestTask, { audio: RealtimeSession }>({
  createPlans(name, definition) {
    return [{ name, definition: createAudioTestTask(name, definition), metadata: { input: fileURLToPath(definition.input), runtime: inject('fakemicRuntime').name } }]
  },
  async execute({ plan, task, invokeHandler }) {
    await runAudioTestSession({
      start: () => startFakemicRuntime<RealtimeSession>(fileURLToPath(plan.definition.input)),
      async execute(session) {
        Object.assign(task.context, { audio: session })
        await invokeHandler()
      },
    })
  },
})

const fixture = new URL('./fixtures/generated/realtime.wav', import.meta.url)
const reportDirectory = new URL(process.env.SHERPAW_ASR_REPORT_SUBDIR || 'asr-realtime/', new URL('../../../../docs/research/', import.meta.url))

describe('Continuous real-time ASR with the fakemic plugin', () => {
  for (const backend of ['cpu', 'webgpu', 'webgpu-decoder', 'webgpu-fp32'] satisfies LiveBackend[]) {
    it(`${backend}: process the entire 60-second recording at microphone speed`, { input: fixture }, async ({ audio }) => {
      const manifest = JSON.parse(await readFile(new URL('./fixtures/generated/manifest.json', import.meta.url), 'utf8'))
      await audio.start(backend)
      // The source is paced by Chromium's file microphone, not a JS inference loop.
      // Completion depends on received audio time; early expected words never stop playback.
      await audio.page.waitForFunction(() => {
        const events = window.__asrRealtimeTest.events
        return (events.at(-1)?.snapshot.receivedAudioSeconds ?? 0) >= 60 || document.querySelector('[role=alert]')
      }, undefined, { timeout: 90000 })
      const beforeStop = await audio.snapshot()
      expect(beforeStop.error).toBe('')
      await audio.stop()
      const capture = await audio.snapshot()
      const final = capture.events.at(-1)!
      await mkdir(reportDirectory, { recursive: true })
      await writeFile(new URL(`${backend}.json`, reportDirectory), `${JSON.stringify({ date: new Date().toISOString(), browser: audio.browser, backend, fixture: manifest, ...capture, events: capture.events.filter((event, index, events) => event.kind === 'stopped' || event.text !== events[index - 1]?.text || Math.floor(event.snapshot.receivedAudioSeconds / 5) !== Math.floor((events[index - 1]?.snapshot.receivedAudioSeconds ?? -5) / 5)) }, null, 2)}\n`)
      expect(audio.errors).toEqual([])
      expect(capture.error).toBe('')
      expect(final.kind).toBe('stopped')
      expect(final.snapshot.receivedAudioSeconds).toBeGreaterThanOrEqual(60)
      expect(final.snapshot.processedAudioSeconds).toBeCloseTo(final.snapshot.receivedAudioSeconds, 5)
      // Chrome can omit a render quantum while its fake capture device starts.
      // The fixture reserves its first second for silence. Preserve/report this
      // startup gap, but require uninterrupted delivery during the speech.
      expect(final.snapshot.startupCaptureGapMs).toBeLessThanOrEqual(16.1)
      expect(final.snapshot.captureGapMs - final.snapshot.startupCaptureGapMs).toBeLessThan(1)
      expect(Math.abs(final.snapshot.captureSpanSeconds - final.snapshot.receivedAudioSeconds) * 1000).toBeLessThanOrEqual(final.snapshot.startupCaptureGapMs + 1)
      // Allow scheduling and Stop drain; reject accelerated/offline feeding.
      expect(final.snapshot.elapsedMs).toBeGreaterThan(59000)
      expect(final.snapshot.elapsedMs).toBeLessThan(65000)
      expect(final.snapshot.maxOutstandingSeconds).toBeLessThan(2)
      expect(final.snapshot.gpuDispatches > 0).toBe(backend !== 'cpu')
      expect(final.text).toContain('语音识别测试')
      expect(final.text.length).toBeGreaterThan(50)
      const changes = capture.events.filter((event, index, events) => event.text && event.text !== events[index - 1]?.text)
      expect(changes.some(event => event.snapshot.receivedAudioSeconds > 45)).toBe(true)
      expect(capture.tracks.length).toBeGreaterThan(0)
      expect(capture.tracks.every(state => state === 'ended')).toBe(true)
    })
  }
})
