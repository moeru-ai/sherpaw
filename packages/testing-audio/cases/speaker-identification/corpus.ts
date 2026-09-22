import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import manifest from './fixtures/manifest.json'

export const voices = ['alloy', 'nova'] as const
export const models = [
  '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced',
  '3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common',
] as const
export const fixtureRoot = new URL('./fixtures/', import.meta.url)
export const fixturePath = (file: string) => `/@fs${fileURLToPath(new URL(file, fixtureRoot))}`
export const modelPath = (model: string) => `/@fs${resolve(import.meta.dirname, '../../../../models', model, 'model/normalized/speaker-embedding.onnx')}`

/** Fail on missing or changed fixtures; test execution never regenerates audio. */
export async function verifyCorpus() {
  for (const file of [...manifest.files, ...manifest.unknowns]) {
    const audio = await readFile(new URL(file.file, fixtureRoot))
    const hash = createHash('sha256').update(audio).digest('hex')
    if (hash !== file.sha256)
      throw new Error(`Fixture checksum mismatch: ${file.file}`)
  }
}
