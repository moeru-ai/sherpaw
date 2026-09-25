import type { Page } from 'playwright'
import type { ViteDevServer } from 'vite'

import { createChromiumFileMicrophoneArguments } from '@sherpaw/vitest-plugin-fakemic'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer, preview } from 'vite'
import { afterAll, beforeAll, expect, it } from 'vitest'

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

async function load(page: Page) {
  await page.getByRole('button', { name: '加载模型', exact: true }).click()
  await expect.poll(() => page.getByRole('button', { name: '开始监听', exact: true }).isEnabled(), { timeout: 30000 }).toBe(true)
}

async function file(page: Page, filename = 'zh_5.wav') {
  await page.getByLabel('测试音频文件').setInputFiles(resolve(fixtures, filename))
  await expect.poll(() => page.getByRole('status').textContent(), { timeout: 30000 }).toContain('检测完成')
}

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
