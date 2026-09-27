import { expect, test } from 'playwright/test'

import { closeSetup, file, load, openKeywords, serveRemoteModel } from './helpers'

test('activates selected presets immediately with the real model and keeps manual edits explicit', async ({ page }, testInfo) => {
  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)

  const labels = () => page.locator('.keyword-row > label:first-child input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))
  const english = ['Hey Iru', 'Hello Iru', 'Iru Iru']
  const chinese = ['你好肥鱼', '大肥鱼', '肥鱼肥鱼']

  await expect.poll(labels).toEqual(english)

  await load(page, false)

  expect(await page.locator('.active-words .word').allTextContents()).toEqual(english)

  // Check the more sensitive English preset against unrelated speech.
  for (const filename of ['en_0.wav', 'en_1.wav', 'zh_0.wav', 'zh_1.wav', 'zh_2.wav', 'zh_3.wav', 'zh_4.wav', 'zh_5.wav', 'zh_6.wav']) {
    await file(page, filename)

    expect(await page.locator('.hit').count()).toBe(0)
  }

  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('chinese')

  expect(await labels()).toEqual(chinese)
  await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(chinese)
  expect(await page.getByRole('alert').count()).toBe(0)

  for (const filename of ['en_0.wav', 'en_1.wav', 'zh_0.wav', 'zh_1.wav', 'zh_2.wav', 'zh_3.wav', 'zh_4.wav', 'zh_5.wav', 'zh_6.wav']) {
    await file(page, filename)

    expect(await page.locator('.hit').count()).toBe(0)
  }

  // Editing a preset must not modify its definition when selected again.
  await openKeywords(page)
  await page.getByLabel('Keyword 1 label').fill('edited')

  expect(await page.locator('.active-words .word').allTextContents()).toEqual(chinese)

  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('english')

  await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(english)
  expect(await labels()).toEqual(english)

  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('chinese')

  await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(chinese)
  expect(await labels()).toEqual(chinese)

  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('english')

  await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(english)

  await page.screenshot({ path: testInfo.outputPath('sherpaw-kws-presets.png'), fullPage: true })
})

test('keeps the active detector when a preset changes search settings but its tokens are invalid', async ({ page }) => {
  let modelRequests = 0
  const remoteRequests = await serveRemoteModel(page)

  page.on('request', (request) => {
    if (request.url().includes('preload.data'))
      modelRequests++
  })
  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await load(page)
  // Corrupt the next preset message to exercise failed reconstruction at a
  // different candidate count, rather than only setKeywords validation.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage

    Worker.prototype.postMessage = function (message, transfer) {
      if (message.request?.type === 'keywords') {
        Worker.prototype.postMessage = post
        message.request.keywords[0].matches[0].tokens = ['NOT_A_MODEL_TOKEN']
      }

      return post.call(this, message, transfer as StructuredSerializeOptions)
    }
  })
  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('chinese')

  await expect.poll(() => page.getByRole('alert').textContent()).toContain('token')

  await file(page)

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实', '周望军'])

  await openKeywords(page)
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(['你好肥鱼', '大肥鱼', '肥鱼肥鱼'])

  await closeSetup(page)
  await page.getByRole('button', { name: 'Clear detections' }).click()
  await file(page)

  expect(await page.locator('.hit').count()).toBe(0)

  expect(modelRequests).toBe(1)
  expect(remoteRequests).toEqual([])
})

test('uses the real Worker for files, replaces keywords atomically, pauses and resumes', async ({ page }, testInfo) => {
  const exceptions: string[] = []

  page.on('pageerror', error => exceptions.push(error.message))
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Keyword spotting' }).click()
  await load(page)
  await file(page)

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实', '周望军'])

  await page.locator('.hit').first().getByText('Token timestamps').click()

  expect(await page.locator('.token-times span').count()).toBeGreaterThan(0)

  await page.screenshot({ path: testInfo.outputPath('sherpaw-kws-playground.png'), fullPage: true })

  await closeSetup(page)
  await page.getByRole('button', { name: 'Clear detections' }).click()
  await file(page, 'en_0.wav')

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['LIGHT UP'])

  await openKeywords(page)
  await page.getByRole('button', { name: 'Remove keyword 3' }).click()
  await openKeywords(page)
  await page.getByRole('button', { name: 'Remove keyword 1' }).click()
  await openKeywords(page)
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(['落实'])

  await closeSetup(page)
  await page.getByRole('button', { name: 'Clear detections' }).click()
  await file(page)

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实'])

  await openKeywords(page)
  await page.getByLabel('Keyword 1 tokens').fill('NOT_A_MODEL_TOKEN')
  await openKeywords(page)
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect.poll(() => page.getByRole('alert').textContent()).toContain('unknown keyword token')
  expect(await page.locator('.active-words .word').allTextContents()).toEqual(['落实'])

  await closeSetup(page)
  await page.getByRole('button', { name: 'Clear detections' }).click()
  await file(page)

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实'])

  await openKeywords(page)
  await page.getByRole('button', { name: 'Pause detection' }).click()

  await expect.poll(() => page.getByLabel('Test audio file').isDisabled()).toBe(true)
  await expect.poll(() => page.locator('.active-words .word').count()).toBe(0)

  await openKeywords(page)
  await page.getByLabel('Keyword 1 tokens').fill('l uò sh í')
  await openKeywords(page)
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect.poll(() => page.getByLabel('Test audio file').isEnabled()).toBe(true)

  await closeSetup(page)
  await page.getByRole('button', { name: 'Clear detections' }).click()
  await file(page)

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实'])
  expect(exceptions).toEqual([])

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('sherpaw-kws-playground-mobile.png'), fullPage: true })

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('streams fake microphone audio and releases capture and Worker when leaving the route', async ({ page }) => {
  let closedWorkers = 0

  page.on('worker', worker => worker.on('close', () => closedWorkers++))
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const tracks: MediaStreamTrack[] = []

    Object.assign(window, { kwsTestTracks: tracks })
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints)

      tracks.push(...stream.getTracks())

      return stream
    }
  })
  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await load(page)
  await closeSetup(page)
  await page.getByRole('button', { name: 'Start' }).click()

  await expect.poll(() => page.locator('.hit strong').allTextContents(), { timeout: 30000 }).toContain('周望军')

  await openKeywords(page)
  await page.getByRole('button', { name: 'Pause detection' }).click()

  await expect.poll(() => page.locator('.active-words .word').count()).toBe(0)

  await closeSetup(page)

  expect(await page.getByRole('button', { name: 'Stop listening' }).isVisible()).toBe(true)

  await openKeywords(page)
  await page.getByRole('button', { name: 'Apply' }).click()

  await expect.poll(() => page.locator('.active-words .word').count()).toBe(3)

  await page.getByRole('link', { name: '← Sandbox' }).click()
  await page.waitForURL('/')

  await expect.poll(() => closedWorkers).toBe(1)
  expect(await page.evaluate(() => (window as unknown as { kwsTestTracks: MediaStreamTrack[] }).kwsTestTracks.map(track => track.readyState))).toEqual(['ended'])

  await page.getByRole('link', { name: 'Keyword spotting' }).click()

  expect(await page.locator('.hit').count()).toBe(0)

  await closeSetup(page)

  expect(await page.getByRole('button', { name: 'Start' }).isDisabled()).toBe(true)
})

test('falls back to the pinned HF pack when a local model is missing', async ({ page }) => {
  await page.context().route('**/__local-models/**', route => route.fulfill({ status: 404, body: 'Missing' }))

  const remoteRequests = await serveRemoteModel(page)

  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await load(page)

  expect(remoteRequests.sort()).toEqual(['preload.data', 'preload.js.metadata'])

  await file(page, 'en_0.wav')

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['LIGHT UP'])
})

test('recovers from failed model loading and microphone permission denial', async ({ page }) => {
  await page.context().route('**/*preload*.data*', route => route.abort())
  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await page.getByRole('button', { name: 'Initialize', exact: true }).click()

  await expect.poll(() => page.getByRole('alert').count(), { timeout: 30000 }).toBe(1)

  await closeSetup(page)

  expect(await page.getByRole('button', { name: 'Start' }).isDisabled()).toBe(true)

  await page.getByRole('button', { name: 'Model setup' }).click()
  await page.context().unroute('**/*preload*.data*')
  await load(page)
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Permission denied', 'NotAllowedError')
    }
  })
  await closeSetup(page)
  await page.getByRole('button', { name: 'Start' }).click()

  await expect.poll(() => page.getByRole('alert').textContent()).toContain('Permission denied')

  await closeSetup(page)

  expect(await page.getByRole('button', { name: 'Start' }).isEnabled()).toBe(true)

  await file(page)

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实', '周望军'])
})
