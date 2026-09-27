import type { Page } from 'playwright/test'

import { resolve } from 'node:path'
import { expect } from 'playwright/test'

const modelPack = resolve(import.meta.dirname, '../../../../models/huggingface/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/install/bin/wasm')
const remoteModel = 'https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/resolve/1770a4b22db32184c110ac43c601db17cc9c93f8/install/bin/wasm/'

export const fixtures = resolve(import.meta.dirname, '../../../kws/tests/models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/test_wavs')

// Route only the two pinned HF URLs; inference still uses the real model bytes.
export async function serveRemoteModel(page: Page) {
  const requests: string[] = []

  for (const name of ['preload.data', 'preload.js.metadata']) {
    await page.context().route(`${remoteModel}${name}`, async (route) => {
      requests.push(name)
      await route.fulfill({
        path: resolve(modelPack, name),
        contentType: name.endsWith('.metadata') ? 'application/json' : 'application/octet-stream',
        headers: { 'access-control-allow-origin': '*' },
      })
    })
  }

  return requests
}

export async function closeSetup(page: Page) {
  if (await page.getByLabel('Model settings').isVisible()) {
    await page.getByRole('button', { name: 'Model setup' }).click()
    await page.getByLabel('Model settings').waitFor({ state: 'hidden' })
  }
}

export async function openKeywords(page: Page) {
  if (!await page.getByLabel('Model settings').isVisible())
    await page.getByRole('button', { name: 'Model setup' }).click()

  const settings = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Keywords' }) })

  if (await settings.getAttribute('open') === null)
    await settings.locator('summary').click()
}

export async function load(page: Page, useFixtureKeywords = true) {
  await openKeywords(page)

  // Upstream audio regression cases have their own vocabulary; they must not
  // dictate the presets shown to people using the playground.
  if (useFixtureKeywords) {
    const keywords = [
      { label: '周望军', tokens: 'zh ōu w àng j ūn' },
      { label: '落实', tokens: 'l uò sh í' },
      { label: 'LIGHT UP', tokens: 'L AY1 T AH1 P' },
    ]

    for (const [index, keyword] of keywords.entries()) {
      await page.getByLabel(`Keyword ${index + 1} label`).fill(keyword.label)
      await page.getByLabel(`Keyword ${index + 1} tokens`).fill(keyword.tokens)
      await page.getByLabel(`Keyword ${index + 1} score`).fill('1')
      await page.getByLabel(`Keyword ${index + 1} threshold`).fill('0.25')
    }
  }

  await page.getByRole('button', { name: 'Initialize', exact: true }).click()

  await expect.poll(() => page.getByRole('button', { name: 'Start', exact: true }).isEnabled(), { timeout: 30000 }).toBe(true)

  await closeSetup(page)
}

export async function file(page: Page, filename = 'zh_5.wav') {
  await closeSetup(page)
  await page.getByLabel('Test audio file').setInputFiles(resolve(fixtures, filename))

  await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('complete')
}
