import type { AudioTestCase, AudioTestTask } from '@sherpaw/vitest-plugin-fakemic'

import { createAudioTestAPI, createAudioTestTask, runAudioTestSession, startFakemicRuntime } from '@sherpaw/vitest-plugin-fakemic'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expect, inject } from 'vitest'

import type { RealtimeSession } from './prepare'

import { asrModels } from '../../src/features/asr-models/catalog'

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

const reportDirectory = new URL('../../../../docs/research/asr-models-realtime/', import.meta.url)

describe('Model selector and continuous microphone input', () => {
  for (const model of asrModels.filter(model => !process.env.SHERPAW_ASR_MODELS || process.env.SHERPAW_ASR_MODELS.split(',').includes(model.id))) {
    const chineseOnly = model.id === 'zipformer-zh'
    const fixture = new URL(`./fixtures/generated/${chineseOnly ? 'realtime-chinese' : 'realtime'}.wav`, import.meta.url)
    it(`${model.id}: load and transcribe the 60-second recording`, { input: fixture }, async ({ audio }) => {
      const fixtureManifest = JSON.parse(await readFile(new URL(`./fixtures/generated/${chineseOnly ? 'manifest-chinese' : 'manifest'}.json`, import.meta.url), 'utf8'))
      let failure: unknown
      try {
        // Exercise preloading via the visible selector, with no microphone opened.
        await audio.page.getByLabel('ASR model', { exact: true }).selectOption(model.id)
        await audio.page.getByRole('button', { name: 'Load model', exact: true }).click()
        await audio.page.waitForFunction(() => document.querySelector('[role=alert]') || document.querySelector('[role=status]')?.textContent?.includes('Ready ·'), undefined, { timeout: 180000 })
        expect((await audio.snapshot()).error).toBe('')
        expect((await audio.snapshot()).tracks).toEqual([])
        // Do not reselect a model: Start must reuse the preloaded worker.
        await audio.page.getByRole('button', { name: 'Start', exact: true }).click()
        await audio.page.getByRole('button', { name: 'Stop transcription' }).waitFor({ timeout: 180000 })
        await audio.page.waitForFunction(() => (window.__asrRealtimeTest.events.at(-1)?.snapshot.receivedAudioSeconds ?? 0) >= 60 || document.querySelector('[role=alert]'), undefined, { timeout: 100000 })
        if (await audio.page.getByRole('button', { name: 'Stop transcription' }).count())
          await audio.stop()
        else
          await audio.page.getByRole('button', { name: 'Start', exact: true }).waitFor({ timeout: 180000 })
        const capture = await audio.snapshot()
        const final = capture.events.at(-1)!
        expect(capture.error).toBe('')
        expect(audio.errors).toEqual([])
        expect(final.kind).toBe('stopped')
        expect(final.model).toBe(model.id)
        expect(final.snapshot.receivedAudioSeconds).toBeGreaterThanOrEqual(60)
        expect(final.snapshot.receivedAudioSeconds).toBeLessThan(60.5)
        expect(final.snapshot.processedAudioSeconds).toBeCloseTo(final.snapshot.receivedAudioSeconds, 5)
        expect(final.snapshot.elapsedMs).toBeGreaterThan(59000)
        expect(final.snapshot.captureGapMs - final.snapshot.startupCaptureGapMs).toBeLessThan(1)
        expect(final.snapshot.gpuDispatches).toBe(0)
        expect(final.text).toContain('语音识别测试')
        if (chineseOnly)
          expect(final.text.match(/语音识别测试/g)!.length).toBeGreaterThanOrEqual(2)
        else
          expect(final.text).toMatch(/please say hello/i)
        expect(capture.events.some((event, index, events) => event.snapshot.receivedAudioSeconds > 45 && event.text.length > 50 && event.text !== events[index - 1]?.text)).toBe(true)
        expect(capture.tracks.length).toBeGreaterThan(0)
        expect(capture.tracks.every(state => state === 'ended')).toBe(true)
        await expect.poll(() => audio.page.workers().length).toBe(0)
      }
      catch (error) { failure = error }
      finally {
        const capture = await audio.snapshot()
        await mkdir(reportDirectory, { recursive: true })
        const events = capture.events.filter((event, index, all) => event.kind === 'stopped' || event.text !== all[index - 1]?.text || Math.floor(event.snapshot.receivedAudioSeconds / 5) !== Math.floor((all[index - 1]?.snapshot.receivedAudioSeconds ?? -5) / 5))
        await writeFile(new URL(`${model.id}.json`, reportDirectory), `${JSON.stringify({ date: new Date().toISOString(), browser: audio.browser, model, fixture: fixtureManifest, passed: !failure, failure: failure ? String(failure) : undefined, errors: audio.errors, ...capture, events }, null, 2)}\n`)
      }
      if (failure)
        throw failure
    })
  }
})
