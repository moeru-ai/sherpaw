import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from 'playwright/test'

import { decodeWavPcm16, encodeWavPcm16 } from '../../../asr/tests/helpers/wav'
import { microphoneArguments } from '../microphone'
import { closeSetup, file, fixtures, load, openKeywords } from './helpers'

// Private recordings stay outside the repository and are supplied explicitly.
const recording = process.env.SHERPAW_KWS_TEST_RECORDING
const repeatedRecording = process.env.SHERPAW_KWS_TEST_REPEATED_RECORDING

test.use({ launchOptions: { args: microphoneArguments(recording ?? resolve(fixtures, 'zh_5.wav')) } })

test('detects all Iru phrases in a local recording through file and microphone input', async ({ page }) => {
  test.skip(!recording, 'Requires a private recording supplied through the environment.')

  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await load(page, false)
  await file(page, recording!)

  const expected = ['Iru Iru', 'Hello Iru', 'Hey Iru']

  expect(await page.locator('.hit strong').allTextContents()).toEqual(expected)

  const { samples, sampleRate } = decodeWavPcm16(Uint8Array.from(await readFile(recording!)).buffer)

  // These frame offsets exposed misses despite the unmodified file passing.
  for (const paddingMs of [160, 480]) {
    await closeSetup(page)
    await page.getByRole('button', { name: 'Clear detections' }).click()

    const padded = new Float32Array(samples.length + Math.round(sampleRate * paddingMs / 1000))

    padded.set(samples, padded.length - samples.length)

    const name = `offset-${paddingMs}.wav`

    await page.getByLabel('Test audio file').setInputFiles({ name, mimeType: 'audio/wav', buffer: Buffer.from(encodeWavPcm16(padded, sampleRate)) })

    await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain(`${name} complete`)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(expected)
  }

  // A complete phrase is required: neither one name, the greeting alone,
  // nor a final syllable may become a hit after candidate expansion.
  for (const [name, start, end] of [['single-iru', 8.45, 9.04], ['hello-only', 5.10, 5.95], ['final-syllable', 3.70, 4.35]] as const) {
    if (await page.locator('.hit').count()) {
      await closeSetup(page)
      await page.getByRole('button', { name: 'Clear detections' }).click()
    }

    const crop = samples.slice(Math.round(start * sampleRate), Math.round(end * sampleRate))
    const padded = new Float32Array(sampleRate + crop.length)

    padded.set(crop, sampleRate)
    await page.getByLabel('Test audio file').setInputFiles({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: Buffer.from(encodeWavPcm16(padded, sampleRate)) })

    await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain(`${name}.wav complete`)
    expect(await page.locator('.hit').count()).toBe(0)
  }

  await closeSetup(page)
  await page.getByRole('button', { name: 'Start' }).click()

  await expect.poll(() => page.locator('.hit strong').allTextContents(), { timeout: 20000 }).toEqual(expected)

  await closeSetup(page)
  await page.getByRole('button', { name: 'Stop listening' }).click()

  expect(await page.getByRole('alert').count()).toBe(0)
})

test('detects mixed-language Hello Iru pronunciations in a local repeated-phrase recording', async ({ page }) => {
  test.skip(!repeatedRecording, 'Requires a private recording supplied through the environment.')

  await page.goto('/kws', { waitUntil: 'domcontentloaded' })
  await openKeywords(page)
  await load(page, false)
  await file(page, repeatedRecording!)

  // This 27-second recording has five Hello Iru attempts. Three are recovered
  // in continuous replay; the misses around 16 and 18 seconds remain open.
  expect(await page.locator('.hit strong').allTextContents()).toEqual([
    'Hello Iru',
    'Hello Iru',
    'Iru Iru',
    'Hello Iru',
    'Hey Iru',
  ])

  const { samples, sampleRate } = decodeWavPcm16(Uint8Array.from(await readFile(repeatedRecording!)).buffer)

  // Retain the previously passing shifted alignment as a separate check.
  await closeSetup(page)
  await page.getByRole('button', { name: 'Clear detections' }).click()

  const padded = new Float32Array(samples.length + Math.round(sampleRate * 0.16))

  padded.set(samples, padded.length - samples.length)
  await page.getByLabel('Test audio file').setInputFiles({ name: 'repeated-offset.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWavPcm16(padded, sampleRate)) })

  await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('repeated-offset.wav complete')
  expect(await page.locator('.hit strong').allTextContents()).toEqual([
    'Hello Iru',
    'Hello Iru',
    'Hello Iru',
    'Hello Iru',
    'Iru Iru',
    'Hello Iru',
    'Hey Iru',
  ])

  // Fresh stream state must also detect each complete Hello phrase.
  for (const [start, end] of [[5.5, 8.3], [12, 14.5], [14.7, 16.8], [17, 19.5], [19.7, 22]] as const) {
    await closeSetup(page)
    await page.getByRole('button', { name: 'Clear detections' }).click()

    const name = `hello-${start}.wav`
    const buffer = Buffer.from(encodeWavPcm16(samples.slice(Math.round(start * sampleRate), Math.round(end * sampleRate)), sampleRate))

    await page.getByLabel('Test audio file').setInputFiles({ name, mimeType: 'audio/wav', buffer })

    await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain(`${name} complete`)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['Hello Iru'])
  }
})
