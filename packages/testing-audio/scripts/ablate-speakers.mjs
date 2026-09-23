import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '../../..')
const caseRoot = resolve(import.meta.dirname, '../cases/speaker-identification')
const manifest = JSON.parse(await readFile(resolve(caseRoot, 'fixtures/manifest.json'), 'utf8'))
for (const file of [...manifest.files, ...manifest.unknowns]) {
  const bytes = await readFile(resolve(caseRoot, 'fixtures', file.file))
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
    throw new Error(`Fixture checksum mismatch: ${file.file}`)
}
const server = await createServer({ configFile: false, root: resolve(root, 'packages/sandbox'), server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } } })
const browser = await chromium.launch({ headless: true })
const report = { date: new Date().toISOString(), browser: browser.version(), corpus: { manifest: 'packages/testing-audio/cases/speaker-identification/fixtures/manifest.json', manifestSha256: createHash('sha256').update(await readFile(resolve(caseRoot, 'fixtures/manifest.json'))).digest('hex'), files: manifest.files, unknowns: manifest.unknowns }, models: [] }
try {
  await server.listen()
  for (const model of ['sherpaw-campplus-zh-en-advanced', 'sherpaw-eres2netv2-zh-cn']) {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
    await page.goto(`${server.resolvedUrls.local[0]}tests/speaker-identification/index.html`)
    const path = resolve(root, 'models/huggingface', model, 'install/bin/wasm/preload.data')
    const bytes = await readFile(path)
    const result = await page.evaluate(async ({ script, model, fixtures }) => {
      const { runAblation } = await import(/* @vite-ignore */ script)
      return runAblation(model, fixtures)
    }, { script: `/@fs${caseRoot}/ablation.ts`, model: `/@fs${path}`, fixtures: `/@fs${caseRoot}/fixtures/` })
    report.models.push({ model, modelSha256: createHash('sha256').update(bytes).digest('hex'), ...result })
    console.log(`${model}: ${result.rows.length} comparisons`)
    await page.close()
  }
}
finally {
  await browser.close()
  await server.close()
}
const output = resolve(root, 'docs/research/speaker-identification-ablation')
await writeFile(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`)
const lines = [
  '# Speaker identification: compact regression ablation',
  '',
  `Run: ${report.date}. Chromium ${report.browser}, local CPU / single-thread WASM.`,
  '',
  'Uses eight saved TTS utterances (alloy and nova) plus one upstream natural-speaker negative. Enrollment and query texts are distinct. The JSON contains file/model hashes and every candidate score; original transcripts live only in the fixture manifest.',
  '',
  'The threshold remains 0.6 and was not tuned on these queries. This compact regression fixture does not establish human identification accuracy or mobile performance. See the historical six-voice report for harder open-set failures.',
  '',
  '## Single-factor comparisons',
  '',
  'one-zh uses one Chinese enrollment; two-mixed uses one Chinese and one English enrollment. Query variants keep two-mixed enrollment fixed: first-3-seconds crops without VAD; quiet-0.1 reduces amplitude to one tenth; over-range sets the peak to 1.25 and compares raw input with recording peak adaptation.',
  '',
  '| Model / condition | Chinese correct accepts | English correct accepts | Correct top-1 | Input errors | Natural false accepts |',
  '| --- | --- | --- | --- | --- | --- |',
]
const fraction = (items, predicate) => `${items.filter(predicate).length}/${items.length}`
for (const model of report.models) {
  const label = model.model.includes('campplus') ? 'CAM++' : 'ERes2NetV2'
  for (const condition of [...new Set(model.rows.map(row => row.condition))].filter(name => name !== 'leave-one-voice-out')) {
    const rows = model.rows.filter(row => row.condition === condition)
    const known = rows.filter(row => row.expected)
    const unknown = rows.filter(row => !row.expected)
    const correct = row => row.scores[0]?.name === row.expected && row.scores[0]?.score >= 0.6
    lines.push(`| ${label} / ${condition} | ${fraction(known.filter(row => row.language === 'zh'), correct)} | ${fraction(known.filter(row => row.language === 'en'), correct)} | ${fraction(known, row => row.scores[0]?.name === row.expected)} | ${fraction(known, row => row.error)} | ${unknown.length ? fraction(unknown, row => row.scores[0]?.score >= 0.6) : '—'} |`)
  }
}
lines.push('', '## Thresholds and held-out voices', '', 'Remove each of the two voices in turn and query its Chinese and English recordings as unknown (four queries total). This is a fixed threshold comparison, not calibration. It does not reproduce the historical six-voice confusion cases.', '', '| Model / threshold | Full-library correct accepts | Held-out voice false accepts | Natural false accepts |', '| --- | --- | --- | --- |')
for (const model of report.models) {
  const label = model.model.includes('campplus') ? 'CAM++' : 'ERes2NetV2'
  for (const threshold of [0, 0.6, 0.75, 0.85]) {
    const known = model.rows.filter(row => row.condition === 'two-mixed' && row.expected)
    const unknown = model.rows.filter(row => row.condition === 'leave-one-voice-out')
    const natural = model.rows.filter(row => row.condition === 'two-mixed' && !row.expected)
    lines.push(`| ${label} / ${threshold} | ${fraction(known, row => row.scores[0]?.name === row.expected && row.scores[0]?.score >= threshold)} | ${fraction(unknown, row => row.scores[0]?.score >= threshold)} | ${fraction(natural, row => row.scores[0]?.score >= threshold)} |`)
  }
}
lines.push('', '## Reproduction', '', 'Run `pnpm -F @sherpaw/testing-audio ablate:speakers` to read fixed local audio without TTS calls. Run `pnpm -F @sherpaw/testing-audio test:speakers` for the compact file and fake-microphone regressions through AudioWorklet / Worker / WASM.', '')
await writeFile(`${output}.md`, lines.join('\n'))
console.log(`Report: ${output}.md`)
