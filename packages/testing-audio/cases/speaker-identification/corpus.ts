import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import manifest from './fixtures/manifest.json'

export const voices = ['alloy', 'nova'] as const
export const models = [
  'sherpaw-campplus-zh-en-advanced',
  'sherpaw-eres2netv2-zh-cn',
] as const
export const fixtureRoot = new URL('./fixtures/', import.meta.url)
export const fixturePath = (file: string) => `/@fs${fileURLToPath(new URL(file, fixtureRoot))}`
export const modelPath = (model: string) => `/@fs${resolve(import.meta.dirname, '../../../../models/huggingface', model, 'install/bin/wasm/preload.data')}`

/** Fail on missing or changed fixtures; test execution never regenerates audio. */
export async function verifyCorpus() {
  for (const file of [...manifest.files, ...manifest.unknowns]) {
    const audio = await readFile(new URL(file.file, fixtureRoot))
    const hash = createHash('sha256').update(audio).digest('hex')
    if (hash !== file.sha256)
      throw new Error(`Fixture checksum mismatch: ${file.file}`)
  }
}
