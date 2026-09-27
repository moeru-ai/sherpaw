import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const destination = new URL('../packages/sandbox/tests/asr/fixtures/generated/', import.meta.url)
const sampleRate = 16000
for (const chineseOnly of [false, true]) {
  const chunks = [Buffer.alloc(sampleRate * 2)]
  const segments = []
  let samples = sampleRate
  for (const name of chineseOnly ? Array.from({ length: 8 }).fill('chinese') : ['chinese', 'english', 'chinese', 'english']) {
    const wav = await readFile(new URL(`../packages/testing-audio/cases/${name}/input.test.wav`, import.meta.url))
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
    let data
    let validFormat = false
    for (let offset = 12; offset + 8 <= wav.length;) {
      const id = wav.toString('ascii', offset, offset + 4)
      const size = wav.readUInt32LE(offset + 4)
      const body = offset + 8
      if (id === 'fmt ') {
        assert.equal(wav.readUInt16LE(body), 1)
        assert.equal(wav.readUInt16LE(body + 2), 1)
        assert.equal(wav.readUInt32LE(body + 4), sampleRate)
        assert.equal(wav.readUInt16LE(body + 14), 16)
        validFormat = true
      }
      if (id === 'data')
        data = wav.subarray(body, body + size)
      offset = body + size + size % 2
    }
    assert.ok(validFormat && data)
    segments.push({ source: `${name}/input.test.wav`, startSeconds: samples / sampleRate, endSeconds: (samples + data.length / 2) / sampleRate })
    chunks.push(data, Buffer.alloc(sampleRate)) // Half a second of silence between utterances.
    samples += data.length / 2 + sampleRate / 2
  }
  const totalSamples = sampleRate * 60
  assert.ok(samples < totalSamples)
  chunks.push(Buffer.alloc((totalSamples - samples) * 2))
  const pcm = Buffer.concat(chunks)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  const wav = Buffer.concat([header, pcm])
  await mkdir(destination, { recursive: true })
  await writeFile(new URL(chineseOnly ? 'realtime-chinese.wav' : 'realtime.wav', destination), wav)
  await writeFile(new URL(chineseOnly ? 'manifest-chinese.json' : 'manifest.json', destination), `${JSON.stringify({ sampleRate, durationSeconds: 60, sha256: createHash('sha256').update(wav).digest('hex'), segments }, null, 2)}\n`)
}
