import type { Page } from 'playwright'
import type { ViteDevServer } from 'vite'

import { createChromiumFileMicrophoneArguments } from '@sherpaw/vitest-plugin-fakemic'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer, preview } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { decodeWavPcm16, encodeWavPcm16 } from '../../../asr/tests/helpers/wav'

const fixtures = resolve(import.meta.dirname, '../../../kws/tests/models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/test_wavs')
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

async function load(page: Page, useFixtureKeywords = true) {
  // Upstream audio regression cases have their own vocabulary; they must not
  // dictate the presets shown to people using the playground.
  if (useFixtureKeywords) {
    const keywords = [
      { label: '周望军', tokens: 'zh ōu w àng j ūn' },
      { label: '落实', tokens: 'l uò sh í' },
      { label: 'LIGHT UP', tokens: 'L AY1 T AH1 P' },
    ]
    for (const [index, keyword] of keywords.entries()) {
      await page.getByLabel(`关键词 ${index + 1} 名称`).fill(keyword.label)
      await page.getByLabel(`关键词 ${index + 1} tokens`).fill(keyword.tokens)
      await page.getByLabel(`关键词 ${index + 1} 分数`).fill('1')
      await page.getByLabel(`关键词 ${index + 1} 阈值`).fill('0.25')
    }
  }
  await page.getByRole('button', { name: '加载模型', exact: true }).click()
  await expect.poll(() => page.getByRole('button', { name: '开始监听', exact: true }).isEnabled(), { timeout: 30000 }).toBe(true)
}

it('activates selected presets immediately with the real model and keeps manual edits explicit', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    await page.goto(`${url}kws`)
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

    await page.getByRole('button', { name: '肥鱼 · 中文' }).click()
    expect(await labels()).toEqual(chinese)
    await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(chinese)
    expect(await page.getByRole('alert').count()).toBe(0)
    for (const filename of ['en_0.wav', 'en_1.wav', 'zh_0.wav', 'zh_1.wav', 'zh_2.wav', 'zh_3.wav', 'zh_4.wav', 'zh_5.wav', 'zh_6.wav']) {
      await file(page, filename)
      expect(await page.locator('.hit').count()).toBe(0)
    }

    // Editing a preset must not modify its definition when selected again.
    await page.getByLabel('关键词 1 名称').fill('edited')
    expect(await page.locator('.active-words .word').allTextContents()).toEqual(chinese)
    await page.getByRole('button', { name: 'Iru · English' }).click()
    await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(english)
    expect(await labels()).toEqual(english)
    await page.getByRole('button', { name: '肥鱼 · 中文' }).click()
    await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(chinese)
    expect(await labels()).toEqual(chinese)
    await page.getByRole('button', { name: 'Iru · English' }).click()
    await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(english)
    await page.screenshot({ path: '/tmp/sherpaw-kws-presets.png', fullPage: true })
  }
  finally {
    await browser.close()
  }
})

async function file(page: Page, filename = 'zh_5.wav') {
  await page.getByLabel('测试音频文件').setInputFiles(resolve(fixtures, filename))
  await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('检测完成')
}

// Private recordings stay outside the repository and are supplied explicitly.
const recording = process.env.SHERPAW_KWS_TEST_RECORDING
it.skipIf(!recording)('detects all Iru phrases in a local recording through file and microphone input', async () => {
  const browser = await chromium.launch({ headless: true, args: createChromiumFileMicrophoneArguments(recording!) })
  try {
    const page = await browser.newPage({ permissions: ['microphone'] })
    await page.goto(`${url}kws`)
    await load(page, false)
    await file(page, recording!)
    const expected = ['Iru Iru', 'Hello Iru', 'Hey Iru']
    expect(await page.locator('.hit strong').allTextContents()).toEqual(expected)
    const { samples, sampleRate } = decodeWavPcm16(Uint8Array.from(await readFile(recording!)).buffer)
    // These frame offsets exposed misses despite the unmodified file passing.
    for (const paddingMs of [160, 480]) {
      await page.getByRole('button', { name: '清空记录' }).click()
      const padded = new Float32Array(samples.length + Math.round(sampleRate * paddingMs / 1000))
      padded.set(samples, padded.length - samples.length)
      const name = `offset-${paddingMs}.wav`
      await page.getByLabel('测试音频文件').setInputFiles({ name, mimeType: 'audio/wav', buffer: Buffer.from(encodeWavPcm16(padded, sampleRate)) })
      await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain(`${name} 检测完成`)
      expect(await page.locator('.hit strong').allTextContents()).toEqual(expected)
    }
    await page.getByRole('button', { name: '清空记录' }).click()
    await page.getByRole('button', { name: '开始监听' }).click()
    await expect.poll(() => page.locator('.hit strong').allTextContents(), { timeout: 20000 }).toEqual(expected)
    await page.getByRole('button', { name: '停止监听' }).click()
    expect(await page.getByRole('alert').count()).toBe(0)
  }
  finally {
    await browser.close()
  }
})

const repeatedRecording = process.env.SHERPAW_KWS_TEST_REPEATED_RECORDING
it.skipIf(!repeatedRecording)('detects mixed-language Hello Iru pronunciations in a local repeated-phrase recording', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${url}kws`)
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
    // A 160 ms shift recovers all five Hellos in continuous replay. Keep both
    // results visible instead of treating one successful alignment as reliable.
    await page.getByRole('button', { name: '清空记录' }).click()
    const padded = new Float32Array(samples.length + Math.round(sampleRate * 0.16))
    padded.set(samples, padded.length - samples.length)
    await page.getByLabel('测试音频文件').setInputFiles({ name: 'repeated-offset.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWavPcm16(padded, sampleRate)) })
    await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('repeated-offset.wav 检测完成')
    expect(await page.locator('.hit strong').allTextContents()).toEqual([
      'Hello Iru',
      'Hello Iru',
      'Hello Iru',
      'Hello Iru',
      'Iru Iru',
      'Hello Iru',
      'Hey Iru',
    ])
    // Each complete Hello phrase is detectable with fresh stream state and its
    // own frame alignment, including the two continuous-replay misses.
    for (const [start, end] of [[5.5, 8.3], [12, 14.5], [14.7, 16.8], [17, 19.5], [19.7, 22]] as const) {
      await page.getByRole('button', { name: '清空记录' }).click()
      const name = `hello-${start}.wav`
      const buffer = Buffer.from(encodeWavPcm16(samples.slice(Math.round(start * sampleRate), Math.round(end * sampleRate)), sampleRate))
      await page.getByLabel('测试音频文件').setInputFiles({ name, mimeType: 'audio/wav', buffer })
      await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain(`${name} 检测完成`)
      expect(await page.locator('.hit strong').allTextContents()).toEqual(['Hello Iru'])
    }
  }
  finally {
    await browser.close()
  }
})

const chineseRecording = process.env.SHERPAW_KWS_TEST_CHINESE_RECORDING
it.skipIf(!chineseRecording)('recovers Chinese preset phrases in a local recording and rejects the standalone name', async () => {
  const browser = await chromium.launch({ headless: true, args: createChromiumFileMicrophoneArguments(chineseRecording!) })
  try {
    const page = await browser.newPage({ permissions: ['microphone'] })
    await page.goto(`${url}kws`)
    await page.getByRole('button', { name: '肥鱼 · 中文' }).click()
    await load(page, false)
    await file(page, chineseRecording!)
    // Five of eight full phrases are recovered; three repeated-name phrases
    // remain missed. The accidental standalone 肥鱼 is not a positive example.
    const expected = ['大肥鱼', '你好肥鱼', '大肥鱼', '大肥鱼', '肥鱼肥鱼']
    expect(await page.locator('.hit strong').allTextContents()).toEqual(expected)

    await page.getByRole('button', { name: '清空记录' }).click()
    const { samples, sampleRate } = decodeWavPcm16(Uint8Array.from(await readFile(chineseRecording!)).buffer)
    const buffer = Buffer.from(encodeWavPcm16(samples.slice(Math.round(16.6 * sampleRate), Math.round(17.8 * sampleRate)), sampleRate))
    await page.getByLabel('测试音频文件').setInputFiles({ name: 'single-name.wav', mimeType: 'audio/wav', buffer })
    await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('single-name.wav 检测完成')
    expect(await page.locator('.hit').count()).toBe(0)

    await page.getByRole('button', { name: '开始监听' }).click()
    // Live capture changes frame alignment. The recording currently yields
    // three to five hits across start positions, so do not require file parity.
    await expect.poll(async () => Number.parseFloat((await page.locator('.time').textContent()) ?? '0'), { timeout: 35000 }).toBeGreaterThanOrEqual(26)
    await page.getByRole('button', { name: '停止监听' }).click()
    const hits = await page.locator('.hit strong').allTextContents()
    expect(hits.length).toBeGreaterThanOrEqual(3)
    expect(hits.length).toBeLessThanOrEqual(5)
    // Every returned label must remain in the expected order, with no extras.
    let position = 0
    for (const hit of hits) {
      position = expected.indexOf(hit, position)
      expect(position).toBeGreaterThanOrEqual(0)
      position++
    }
    expect(await page.getByRole('alert').count()).toBe(0)
  }
  finally {
    await browser.close()
  }
})

// Intentionally red when the fourth private fixture is supplied: this captures
// the user's seven-utterance target rather than accepting the current three hits.
const naturalRecording = process.env.SHERPAW_KWS_TEST_NATURAL_RECORDING
it.skipIf(!naturalRecording)('detects all seven natural repeated-name utterances (known failure)', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(`${url}kws`)
    await page.getByRole('button', { name: '肥鱼 · 中文' }).click()
    await load(page, false)
    await file(page, naturalRecording!)
    expect(await page.getByRole('alert').count()).toBe(0)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(Array.from({ length: 7 }, () => '肥鱼肥鱼'))
  }
  finally {
    await browser.close()
  }
})

it('uses the real Worker for files, replaces keywords atomically, pauses and resumes', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    const exceptions: string[] = []
    page.on('pageerror', error => exceptions.push(error.message))
    await page.goto(url)
    await page.getByRole('link', { name: 'Keyword spotting' }).click()
    await load(page)
    await file(page)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实', '周望军'])
    await page.locator('.hit').first().getByText('Token 时间戳').click()
    expect(await page.locator('.token-times span').count()).toBeGreaterThan(0)
    await page.screenshot({ path: '/tmp/sherpaw-kws-playground.png', fullPage: true })

    await page.getByRole('button', { name: '清空记录' }).click()
    await file(page, 'en_0.wav')
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['LIGHT UP'])

    await page.getByRole('button', { name: '删除关键词 3' }).click()
    await page.getByRole('button', { name: '删除关键词 1' }).click()
    await page.getByRole('button', { name: '应用词表' }).click()
    await expect.poll(() => page.locator('.active-words .word').allTextContents()).toEqual(['落实'])
    await page.getByRole('button', { name: '清空记录' }).click()
    await file(page)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实'])

    await page.getByLabel('关键词 1 tokens').fill('NOT_A_MODEL_TOKEN')
    await page.getByRole('button', { name: '应用词表' }).click()
    await expect.poll(() => page.getByRole('alert').textContent()).toContain('unknown keyword token')
    expect(await page.locator('.active-words .word').allTextContents()).toEqual(['落实'])
    await page.getByRole('button', { name: '清空记录' }).click()
    await file(page)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实'])

    await page.getByRole('button', { name: '暂停检测' }).click()
    await expect.poll(() => page.getByLabel('测试音频文件').isDisabled()).toBe(true)
    await expect.poll(() => page.locator('.active-words .word').count()).toBe(0)
    await page.getByLabel('关键词 1 tokens').fill('l uò sh í')
    await page.getByRole('button', { name: '应用词表' }).click()
    await expect.poll(() => page.getByLabel('测试音频文件').isEnabled()).toBe(true)
    await page.getByRole('button', { name: '清空记录' }).click()
    await file(page)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实'])
    expect(exceptions).toEqual([])

    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: '/tmp/sherpaw-kws-playground-mobile.png', fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  finally {
    await browser.close()
  }
})

it('streams fake microphone audio and releases capture and Worker when leaving the route', async () => {
  const browser = await chromium.launch({ headless: true, args: createChromiumFileMicrophoneArguments(resolve(fixtures, 'zh_5.wav')) })
  try {
    const page = await browser.newPage({ permissions: ['microphone'] })
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
    await page.goto(`${url}kws`)
    await load(page)
    await page.getByRole('button', { name: '开始监听' }).click()
    await expect.poll(() => page.locator('.hit strong').allTextContents(), { timeout: 30000 }).toContain('周望军')
    await page.getByRole('button', { name: '暂停检测' }).click()
    await expect.poll(() => page.locator('.active-words .word').count()).toBe(0)
    expect(await page.getByRole('button', { name: '停止监听' }).isVisible()).toBe(true)
    await page.getByRole('button', { name: '应用词表' }).click()
    await expect.poll(() => page.locator('.active-words .word').count()).toBe(3)
    await page.getByRole('link', { name: '← Sandbox' }).click()
    await expect.poll(() => closedWorkers).toBe(1)
    expect(await page.evaluate(() => (window as unknown as { kwsTestTracks: MediaStreamTrack[] }).kwsTestTracks.map(track => track.readyState))).toEqual(['ended'])
    await page.getByRole('link', { name: 'Keyword spotting' }).click()
    expect(await page.locator('.hit').count()).toBe(0)
    expect(await page.getByRole('button', { name: '开始监听' }).isDisabled()).toBe(true)
  }
  finally {
    await browser.close()
  }
})

it('recovers from failed model loading and microphone permission denial', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*encoder*.onnx*', route => route.abort())
    await page.goto(`${url}kws`)
    await page.getByRole('button', { name: '加载模型', exact: true }).click()
    await expect.poll(() => page.getByRole('alert').count(), { timeout: 30000 }).toBe(1)
    expect(await page.getByRole('button', { name: '开始监听' }).isDisabled()).toBe(true)
    await page.unroute('**/*encoder*.onnx*')
    await load(page)
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('Permission denied', 'NotAllowedError')
      }
    })
    await page.getByRole('button', { name: '开始监听' }).click()
    await expect.poll(() => page.getByRole('alert').textContent()).toContain('Permission denied')
    expect(await page.getByRole('button', { name: '开始监听' }).isEnabled()).toBe(true)
    await file(page)
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['落实', '周望军'])
  }
  finally {
    await browser.close()
  }
})

it('loads the production Worker, WASM, models and microphone worklet', async () => {
  const built = await preview({
    root: resolve(import.meta.dirname, '../..'),
    configFile: resolve(import.meta.dirname, '../../vite.config.ts'),
    preview: { host: '127.0.0.1', port: 0 },
  })
  const browser = await chromium.launch({ headless: true, args: createChromiumFileMicrophoneArguments(resolve(fixtures, 'zh_5.wav')) })
  try {
    const page = await browser.newPage({ permissions: ['microphone'] })
    await page.goto(`${built.resolvedUrls!.local[0]}kws`)
    await load(page)
    await file(page, 'en_0.wav')
    expect(await page.locator('.hit strong').allTextContents()).toEqual(['LIGHT UP'])
    await page.getByRole('button', { name: '开始监听' }).click()
    await expect.poll(() => page.locator('.hit strong').allTextContents(), { timeout: 30000 }).toContain('周望军')
    await page.getByRole('button', { name: '停止监听' }).click()
    expect(await page.getByRole('button', { name: '开始监听' }).isEnabled()).toBe(true)
  }
  finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => built.httpServer.close(error => error ? reject(error) : resolve()))
  }
})
