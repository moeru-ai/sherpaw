import type { ViteDevServer } from 'vite'

import { createChromiumFileMicrophoneArguments } from '@sherpaw/vitest-plugin-fakemic'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

let server: ViteDevServer
let url: string

beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, '../..'),
    configFile: resolve(import.meta.dirname, '../../vite.config.ts'),
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [resolve(import.meta.dirname, '../../../..')] } },
  })
  await server.listen()
  url = server.resolvedUrls!.local[0]
})

afterAll(async () => {
  await server?.close()
})

it('loads without example audio and allows typing a speaker name in a short viewport', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 577 } })
    const exampleRequests: string[] = []
    page.on('request', (request) => {
      if (/-enroll-\d\.wav/.test(request.url()))
        exampleRequests.push(request.url())
    })
    await page.goto(`${url}speaker-identification`)
    await page.addScriptTag({ type: 'module', url: `${url}tests/speaker-identification/api.ts` })
    await page.waitForFunction(() => Boolean(window.speakerTest))
    await page.locator('.model-setup > summary').click()
    await page.getByRole('button', { name: '加载模型', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#enroll')!.disabled)
    expect(exampleRequests).toEqual([])
    expect(await page.locator('#voices').textContent()).toBe('')
    const input = page.getByRole('textbox', { name: '声线名字' })
    expect(await input.isEnabled()).toBe(true)
    await input.scrollIntoViewIfNeeded()
    const box = (await input.boundingBox())!
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // Exercise a real pointer hit, rather than fill(), which can bypass overlays.
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point)).toBe('speaker-name')
    await page.mouse.click(point.x, point.y)
    await page.keyboard.type('Neko')
    expect(await input.inputValue()).toBe('Neko')
  }
  finally {
    await browser.close()
  }
})

it('registers multiple manual recordings and keeps independent query results without blocking new recordings', async () => {
  const browser = await chromium.launch({
    headless: true,
    args: createChromiumFileMicrophoneArguments(resolve(import.meta.dirname, '../../../speaker-identification/tests/fixtures/fangjun-sr-1.wav')),
  })
  try {
    const page = await browser.newPage({ permissions: ['microphone'] })
    await page.goto(`${url}speaker-identification`)
    await page.addScriptTag({ type: 'module', url: `${url}tests/speaker-identification/api.ts` })
    await page.waitForFunction(() => Boolean(window.speakerTest))
    await page.locator('.model-setup > summary').click()
    await page.getByRole('button', { name: '加载模型', exact: true }).click()
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#enroll')!.disabled)
    for (const name of ['Neko', 'Second voice']) {
      await page.getByRole('textbox', { name: '声线名字' }).fill(name)
      await page.getByRole('button', { name: '开始录制', exact: true }).click()
      const row = page.locator('.voice-item').last()
      await page.waitForFunction(() => Number.parseFloat(Array.from(document.querySelectorAll('.voice-item .row-duration')).at(-1)!.textContent!) >= 3)
      await row.getByRole('button', { name: '停止录制' }).click()
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.voice-item')).at(-1)?.getAttribute('data-state') === 'done')
    }
    expect(await page.locator('.voice-item[data-state="done"]').count()).toBe(2)
    await page.getByRole('button', { name: '给 Neko 追加录音' }).click()
    const firstSpeaker = page.locator('.speaker-group').first()
    await page.waitForFunction(() => Number.parseFloat(document.querySelector('.speaker-group .voice-item:last-child .row-duration')!.textContent!) >= 3)
    await firstSpeaker.locator('.voice-item').last().getByRole('button', { name: '停止录制' }).click()
    await page.waitForFunction(() => document.querySelector('.sample-count')?.textContent === '2 段录音')
    expect(await page.locator('.speaker-group').count()).toBe(2)
    expect(await firstSpeaker.locator('.voice-item[data-state="done"]').count()).toBe(2)

    // Observe whether the actual next-recording button is enabled while a row is still queued/processing.
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        const processing = document.querySelector('.record-item[data-state="queued"], .record-item[data-state="processing"]')
        if (processing && !document.querySelector<HTMLButtonElement>('#record')!.disabled)
          document.body.dataset.allowedWhileProcessing = 'true'
      })
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled', 'data-state'] })
    })
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: '＋ 创建录制' }).click()
      expect(await page.locator('.record-item').first().locator('.remove-record').isDisabled()).toBe(true)
      await page.waitForFunction(() => Number.parseFloat(document.querySelector('.record-item:first-child .row-duration')!.textContent!) >= 2)
      await page.locator('.record-item').first().getByRole('button', { name: '停止录制' }).click()
      await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#record')!.disabled)
    }
    await page.waitForFunction(() => document.querySelectorAll('.record-item[data-state="done"]').length === 2)
    expect(await page.locator('body').getAttribute('data-allowed-while-processing')).toBe('true')
    // Both registrations use the same fake microphone here; model discrimination is tested separately below.
    for (const name of await page.locator('.record-item .match-name').allTextContents())
      expect(['Neko', 'Second voice']).toContain(name)
    expect(await page.locator('.record-item .score').count()).toBe(4)
    expect((await page.locator('.record-item').first().boundingBox())!.height).toBeLessThan(75)
    expect(await page.locator('.record-item').first().locator('.scores').isVisible()).toBe(true)
    expect(await page.locator('.record-item .scores progress').count()).toBe(4)

    // A failed short clip stays in its own row and does not remove previous results or lock the recorder.
    await page.getByRole('button', { name: '＋ 创建录制' }).click()
    await page.locator('.record-item').first().getByRole('button', { name: '停止录制' }).click()
    await page.waitForFunction(() => document.querySelector('.record-item')?.getAttribute('data-state') === 'error')
    expect(await page.locator('.record-item[data-state="done"]').count()).toBe(2)
    expect(await page.locator('#record').isEnabled()).toBe(true)

    await firstSpeaker.getByRole('button', { name: '删除样本 1', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.sample-count')?.textContent === '1 段录音')
    expect(await firstSpeaker.locator('.voice-item').count()).toBe(1)
    await firstSpeaker.locator('.speaker-menu summary').click()
    await firstSpeaker.getByRole('button', { name: '重命名', exact: true }).click()
    await firstSpeaker.getByRole('textbox', { name: '新的声线名字' }).fill('Second voice')
    await firstSpeaker.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.group-message')?.textContent?.includes('名字已存在'))
    await firstSpeaker.getByRole('textbox', { name: '新的声线名字' }).fill('Renamed')
    await firstSpeaker.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.speaker-title')?.textContent === 'Renamed')
    expect(await firstSpeaker.getByRole('button', { name: '给 Renamed 追加录音' }).isEnabled()).toBe(true)
    const renamedQuery = await page.evaluate(() => window.speakerTest.file('fangjun-test-sr-1'))
    expect(renamedQuery.scores.map(match => match.name).sort()).toEqual(['Renamed', 'Second voice'])

    const secondSpeaker = page.locator('.speaker-group').last()
    await secondSpeaker.locator('.speaker-menu summary').click()
    await secondSpeaker.getByRole('button', { name: '删除声线', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.speaker-group').length === 1)
    await firstSpeaker.getByRole('button', { name: '删除样本 2', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.speaker-group').length === 0)
    expect(await page.locator('#record').isEnabled()).toBe(false)
    expect(await page.locator('.record-item[data-state="done"]').count()).toBe(2)
    expect((await page.evaluate(() => window.speakerTest.file('fangjun-test-sr-1'))).scores).toEqual([])

    // Removing failed or completed query rows only changes history, and preserves the other rows.
    await page.getByRole('button', { name: '删除录制 03', exact: true }).click()
    expect(await page.locator('#record-count').textContent()).toBe('2')
    expect(await page.locator('.record-item[data-state="done"]').count()).toBe(2)
    await page.getByRole('button', { name: '删除录制 01', exact: true }).click()
    expect(await page.locator('#record-count').textContent()).toBe('1')
    expect(await page.locator('.record-item .row-name').textContent()).toBe('录制 02')
    await page.getByRole('button', { name: '删除录制 02', exact: true }).click()
    expect(await page.locator('#record-count').textContent()).toBe('0')
    expect(await page.locator('#recording-empty').isVisible()).toBe(true)
  }
  finally {
    await browser.close()
  }
})

it('appends recordings to one speaker using every saved embedding', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${url}speaker-identification`)
    await page.addScriptTag({ type: 'module', url: `${url}tests/speaker-identification/api.ts` })
    await page.waitForFunction(() => Boolean(window.speakerTest))
    const result = await page.evaluate(async () => {
      await window.speakerTest.init()
      const first = await window.speakerTest.enrollFiles('incremental', ['fangjun-sr-1'])
      const second = await window.speakerTest.enrollFiles('incremental', ['fangjun-sr-2'])
      await window.speakerTest.enrollFiles('together', ['fangjun-sr-1', 'fangjun-sr-2'])
      const query = await window.speakerTest.file('fangjun-test-sr-1')
      return { first, second, query }
    })
    expect(result.first.sampleCount).toBe(1)
    expect(result.second.sampleCount).toBe(2)
    const scores = new Map(result.query.scores.map(match => [match.name, match.score]))
    expect(scores.size).toBe(2)
    expect(scores.get('incremental')).toBeCloseTo(scores.get('together')!, 6)
    expect(scores.get('incremental')).toBeGreaterThan(0.6)
  }
  finally {
    await browser.close()
  }
})

it('renames and removes speakers and rebuilds the centroid when a sample is deleted', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${url}speaker-identification`)
    await page.addScriptTag({ type: 'module', url: `${url}tests/speaker-identification/api.ts` })
    await page.waitForFunction(() => Boolean(window.speakerTest))
    const result = await page.evaluate(async () => {
      const api = window.speakerTest
      await api.init()
      const original = await api.enrollFiles('original', ['fangjun-sr-1', 'fangjun-sr-2'])
      await api.enrollFiles('reference', ['fangjun-sr-1'])
      await api.enrollFiles('other', ['leijun-sr-1'])
      const renamed = await api.rename('original', 'renamed')
      let duplicateRejected = false
      try {
        await api.rename('renamed', 'other')
      }
      catch {
        duplicateRejected = true
      }
      const reduced = await api.removeSample('renamed', original.sampleIds[1])
      const query = await api.file('fangjun-test-sr-1')
      await api.removeSpeaker('other')
      const removed = await api.removeSample('renamed', original.sampleIds[0])
      const after = await api.file('fangjun-test-sr-1')
      return { original, renamed, duplicateRejected, reduced, query, removed, after }
    })
    expect(result.renamed.sampleIds).toEqual(result.original.sampleIds)
    expect(result.duplicateRejected).toBe(true)
    expect(result.reduced.sampleCount).toBe(1)
    const scores = new Map(result.query.scores.map(match => [match.name, match.score]))
    expect(scores.has('original')).toBe(false)
    expect(scores.has('other')).toBe(true)
    expect(scores.get('renamed')).toBeCloseTo(scores.get('reference')!, 6)
    expect(result.removed.sampleCount).toBe(0)
    expect(result.after.scores.map(match => match.name)).toEqual(['reference'])
  }
  finally {
    await browser.close()
  }
})

it('releases the microphone and Worker when leaving the route and starts a fresh session on return', async () => {
  const browser = await chromium.launch({
    headless: true,
    args: createChromiumFileMicrophoneArguments(resolve(import.meta.dirname, '../../../speaker-identification/tests/fixtures/fangjun-sr-1.wav')),
  })
  try {
    const page = await browser.newPage({ permissions: ['microphone'] })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      const tracks: MediaStreamTrack[] = []
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await getUserMedia(constraints)
        tracks.push(...stream.getTracks())
        return stream
      }
      Object.defineProperty(window, 'speakerTracksStopped', { get: () => tracks.length > 0 && tracks.every(track => track.readyState === 'ended') })
      const NativeWorker = window.Worker
      let activeWorkers = 0
      window.Worker = class extends NativeWorker {
        constructor(script: string | URL, options?: WorkerOptions) {
          super(script, options)
          activeWorkers++
        }

        terminate() {
          activeWorkers--
          super.terminate()
        }
      }
      Object.defineProperty(window, 'speakerWorkers', { get: () => activeWorkers })
    })
    await page.goto(url)
    const homeLinkSize = await page.getByRole('link', { name: 'ASR', exact: true }).evaluate(element => getComputedStyle(element).fontSize)
    await page.getByRole('link', { name: 'Speaker identification', exact: true }).click()
    await page.locator('.model-setup > summary').click()
    await page.locator('#load').click()
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#enroll')!.disabled)
    await page.locator('#speaker-name').fill('Leaving route')
    await page.locator('#enroll').click()
    await page.waitForFunction(() => document.querySelector('.voice-item')?.getAttribute('data-state') === 'recording')
    await page.getByRole('link', { name: '← Sandbox' }).click()
    await page.waitForFunction('window.speakerTracksStopped && window.speakerWorkers === 0')
    expect(await page.getByRole('link', { name: 'ASR', exact: true }).evaluate(element => getComputedStyle(element).fontSize)).toBe(homeLinkSize)
    await page.getByRole('link', { name: 'Speaker identification', exact: true }).click()
    expect(await page.locator('.voice-item').count()).toBe(0)
    expect(await page.locator('#enroll').isDisabled()).toBe(true)
    await page.locator('.model-setup > summary').click()
    await page.locator('#load').click()
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#enroll')!.disabled)
    await page.getByRole('link', { name: '← Sandbox' }).click()
    await page.waitForFunction('window.speakerWorkers === 0')
    expect(errors).toEqual([])
  }
  finally {
    await browser.close()
  }
})
