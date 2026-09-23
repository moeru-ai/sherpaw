import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'

const { values } = parseArgs({ options: { 'env-file': { type: 'string' } } })
const environment = values['env-file'] ? parseEnv(await readFile(values['env-file'], 'utf8')) : {}
const apiKey = process.env.AIHUBMIX_API_KEY ?? environment.AIHUBMIX_API_KEY

const root = new URL('../cases/speaker-identification/fixtures/', import.meta.url)
await mkdir(root, { recursive: true })
const previous = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
const texts = previous.texts
const manifest = { provider: 'AIHubMix', model: 'tts-1', format: 'mono PCM16 WAV, 16000 Hz', texts, unknowns: previous.unknowns, files: [] }
for (const { voice, kind, file } of previous.files) {
  const input = texts[kind]
  const path = new URL(file, root)
  let audio = await readFile(path).catch(() => undefined)
  if (!audio) {
    if (!apiKey)
      throw new Error('Set AIHUBMIX_API_KEY or pass --env-file to explicitly generate missing fixtures')
    const response = await fetch('https://aihubmix.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'tts-1', voice, input, response_format: 'wav' }),
      signal: AbortSignal.timeout(120000),
    })
    if (!response.ok)
      throw new Error(`TTS failed: HTTP ${response.status}, voice=${voice}, kind=${kind}`)
    const raw = new URL(`${file}.raw`, root)
    try {
      await writeFile(raw, new Uint8Array(await response.arrayBuffer()))
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fileURLToPath(raw), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', fileURLToPath(path)])
    }
    finally {
      await rm(raw, { force: true })
    }
    audio = await readFile(path)
  }
  const sha256 = createHash('sha256').update(audio).digest('hex')
  const saved = previous.files.find(entry => entry.file === file)
  if (saved && saved.sha256 !== sha256)
    throw new Error(`Review regenerated fixture and update its manifest hash: ${file}`)
  manifest.files.push({ voice, kind, file, sha256 })
  console.log(`${voice}/${kind}: ${audio.byteLength} bytes`)
}
await writeFile(new URL('manifest.json', root), `${JSON.stringify(manifest, null, 2)}\n`)
