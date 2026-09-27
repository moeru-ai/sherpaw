import { expect, test } from 'playwright/test'

import { closeSetup, file, load, serveRemoteModel } from './helpers'

test('loads the production Worker, WASM, models and microphone worklet', async ({ page }) => {
  const remoteRequests = await serveRemoteModel(page)
  const localRequests: string[] = []

  page.on('request', (request) => {
    if (request.url().includes('/__local-models/'))
      localRequests.push(request.url())
  })
  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await load(page)

  expect(remoteRequests.sort()).toEqual(['preload.data', 'preload.js.metadata'])
  expect(localRequests).toEqual([])

  await file(page, 'en_0.wav')

  expect(await page.locator('.hit strong').allTextContents()).toEqual(['LIGHT UP'])

  await closeSetup(page)
  await page.getByRole('button', { name: 'Start' }).click()

  await expect.poll(() => page.locator('.hit strong').allTextContents(), { timeout: 30000 }).toContain('周望军')

  await closeSetup(page)
  await page.getByRole('button', { name: 'Stop listening' }).click()
  await closeSetup(page)

  expect(await page.getByRole('button', { name: 'Start' }).isEnabled()).toBe(true)
})
