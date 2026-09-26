import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const baseURL = process.argv[2] || 'http://127.0.0.1:5187'
const catalog = JSON.parse(await readFile(new URL('../models/asr-catalog.json', import.meta.url), 'utf8'))
const selected = process.env.SHERPAW_ASR_MODELS?.split(',')
const models = catalog.models.filter(model => !selected || selected.includes(model.id))
const fixtures = (process.env.SHERPAW_ASR_FIXTURES || 'chinese,english').split(',')
const directory = new URL(process.env.SHERPAW_ASR_REPORT_SUBDIR || 'asr-models/', new URL('../docs/research/', import.meta.url))
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
let failed = false
try {
  for (const model of models) {
    const results = []
    for (const fixture of fixtures) {
      if (model.id === 'zipformer-zh' && fixture !== 'chinese')
        continue // This model only supports Chinese; bilingual fixtures are not an accuracy gate.
      assert.ok(['chinese', 'english', 'realtime'].includes(fixture))
      const context = await browser.newContext()
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(String(error)))
      await page.exposeFunction('modelProgress', message => console.log(`[${model.id}/${fixture}] ${message}`))
      try {
        await page.goto(`${baseURL}/asr`)
        await page.getByRole('button', { name: 'Start', exact: true }).waitFor()
        await page.waitForLoadState('networkidle')
        const fixturePath = fileURLToPath(new URL(fixture === 'realtime' ? '../packages/sandbox/tests/asr/fixtures/generated/realtime.wav' : `../packages/testing-audio/cases/${fixture}/input.test.wav`, import.meta.url))
        const result = await page.evaluate(async ({ id, fixturePath }) => {
          const { createModelRecognizer } = await import('/src/features/asr-models/recognizer.ts')
          const wav = await (await fetch(`/@fs${fixturePath}`)).arrayBuffer()
          const audio = new AudioContext({ sampleRate: 16000 })
          const decoded = await audio.decodeAudioData(wav)
          const samples = decoded.getChannelData(0).slice()
          await audio.close()
          const start = performance.now()
          const engine = await createModelRecognizer(id, message => window.modelProgress(message))
          const loadMs = performance.now() - start
          let text = ''
          let firstTextMs = null
          const started = performance.now()
          try {
            for (let offset = 0; offset < samples.length; offset += 1600) {
              text = await engine.accept(samples.subarray(offset, offset + 1600))
              if (text && firstTextMs === null)
                firstTextMs = performance.now() - started
            }
            text = await engine.finish()
            const inferenceMs = performance.now() - started
            return { text, loadMs, inferenceMs, firstTextMs, audioSeconds: samples.length / 16000, rtf: inferenceMs / (samples.length / 16), stats: engine.stats() }
          }
          finally { await engine.dispose() }
        }, { id: model.id, fixturePath })
        // Smoke check only: save actual output; this is not a full accuracy benchmark.
        const passed = errors.length === 0 && (fixture === 'chinese'
          ? result.text.includes('语音识别测试')
          : fixture === 'realtime'
            ? (result.text.match(/please say hello/gi)?.length ?? 0) === 2
            : /please say hello/i.test(result.text))
        results.push({ fixture, passed, errors, ...result })
        failed ||= !passed
        console.log(JSON.stringify({ model: model.id, ...results.at(-1) }))
      }
      catch (error) {
        failed = true
        results.push({ fixture, passed: false, errors, error: String(error) })
        console.error(`[${model.id}/${fixture}] ${error}`)
      }
      finally {
        await writeFile(new URL(`${model.id}.json`, directory), `${JSON.stringify({ date: new Date().toISOString(), browser: browser.version(), model, feeding: '100 ms chunks, unpaced; includes final flush, excludes initialization', results }, null, 2)}\n`)
        await context.close()
      }
    }
  }
}
finally { await browser.close() }
if (failed)
  process.exitCode = 1
