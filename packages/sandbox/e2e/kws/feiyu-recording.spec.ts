import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from 'playwright/test'

import { decodeWavPcm16, encodeWavPcm16 } from '../../../asr/tests/helpers/wav'
import { microphoneArguments } from '../microphone'
import { closeSetup, file, fixtures, load, openKeywords } from './helpers'

// Private recordings stay outside the repository and are supplied explicitly.
const chineseRecording = process.env.SHERPAW_KWS_TEST_CHINESE_RECORDING
const naturalRecording = process.env.SHERPAW_KWS_TEST_NATURAL_RECORDING

test.use({ launchOptions: { args: microphoneArguments(chineseRecording ?? resolve(fixtures, 'zh_5.wav')) } })

test('recovers Chinese preset phrases in a local recording and rejects the standalone name', async ({ page }) => {
  test.skip(!chineseRecording, 'Requires a private recording supplied through the environment.')

  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('chinese')
  await load(page, false)
  await file(page, chineseRecording!)

  // Six of eight phrases are recovered; the last two repeated-name phrases
  // remain missed. The accidental standalone 肥鱼 is not a positive example.
  const expected = ['大肥鱼', '你好肥鱼', '大肥鱼', '大肥鱼', '肥鱼肥鱼', '肥鱼肥鱼']

  expect(await page.locator('.hit strong').allTextContents()).toEqual(expected)

  await closeSetup(page)
  await page.getByRole('button', { name: 'Clear detections' }).click()

  const { samples, sampleRate } = decodeWavPcm16(Uint8Array.from(await readFile(chineseRecording!)).buffer)
  const buffer = Buffer.from(encodeWavPcm16(samples.slice(Math.round(16.6 * sampleRate), Math.round(17.8 * sampleRate)), sampleRate))

  await page.getByLabel('Test audio file').setInputFiles({ name: 'single-name.wav', mimeType: 'audio/wav', buffer })

  await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('single-name.wav complete')
  expect(await page.locator('.hit').count()).toBe(0)

  await closeSetup(page)
  await page.getByRole('button', { name: 'Start' }).click()

  // Live capture changes frame alignment. Require at least the previous
  // three-hit floor and only correctly ordered labels from the full recording.
  await expect.poll(async () => Number.parseFloat((await page.locator('.time').textContent()) ?? '0'), { timeout: 35000 }).toBeGreaterThanOrEqual(26)

  await closeSetup(page)
  await page.getByRole('button', { name: 'Stop listening' }).click()

  const hits = await page.locator('.hit strong').allTextContents()

  expect(hits.length).toBeGreaterThanOrEqual(3)

  const fullSequence = ['肥鱼肥鱼', '大肥鱼', '肥鱼肥鱼', '你好肥鱼', '大肥鱼', '大肥鱼', '肥鱼肥鱼', '肥鱼肥鱼']

  expect(hits.length).toBeLessThanOrEqual(fullSequence.length)

  // Every returned label must remain in the expected order, with no extras.
  let position = 0

  for (const hit of hits) {
    position = fullSequence.indexOf(hit, position)

    expect(position).toBeGreaterThanOrEqual(0)

    position++
  }

  expect(await page.getByRole('alert').count()).toBe(0)
})

test('retains the repeated-name prefix while competing keywords are active', async ({ page }) => {
  test.skip(!naturalRecording, 'Requires a private recording supplied through the environment.')

  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('chinese')
  await load(page, false)

  // Keep the original leading audio and frame alignment. The 16-path preset
  // detected the first attempt, then discarded the second attempt's prefix.
  const { samples, sampleRate } = decodeWavPcm16(Uint8Array.from(await readFile(naturalRecording!)).buffer)
  const buffer = Buffer.from(encodeWavPcm16(samples.slice(0, Math.round(9.5 * sampleRate)), sampleRate))

  await page.getByLabel('Test audio file').setInputFiles({ name: 'repeated-prefix.wav', mimeType: 'audio/wav', buffer })

  await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('repeated-prefix.wav complete')
  expect(await page.locator('.hit strong').allTextContents()).toEqual(['肥鱼肥鱼', '肥鱼肥鱼'])
})

// Intentionally red: retain the seven-utterance target despite the partial fix.
test('detects all seven natural repeated-name utterances (known failure)', async ({ page }) => {
  test.skip(!naturalRecording, 'Requires a private recording supplied through the environment.')

  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await page.getByLabel('Preset', { exact: true }).selectOption('chinese')
  await load(page, false)
  await file(page, naturalRecording!)

  expect(await page.getByRole('alert').count()).toBe(0)
  expect(await page.locator('.hit strong').allTextContents()).toEqual(Array.from({ length: 7 }, () => '肥鱼肥鱼'))
})
