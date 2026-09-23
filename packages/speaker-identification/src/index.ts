import type { SpeakerIdentificationModule } from './types'

export type { Extractor, ExtractorConfig, InMemoryDB, InMemoryDBConfig, SpeakerIdentificationModule, SpeakerMatch } from './types'

export { createExtractor } from './extractor'
export { createInMemoryDB } from './in-memory-db'

export async function initSpeakerIdentificationModule(): Promise<SpeakerIdentificationModule> {
  const { default: init } = await import('./prebuilt/speaker-embedding.js')
  const wasmUrl = new URL('./prebuilt/speaker-embedding.wasm', import.meta.url).toString()
  return init({ locateFile: () => wasmUrl })
}
