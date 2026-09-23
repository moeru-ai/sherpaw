import type { InMemoryDB, InMemoryDBConfig, SpeakerIdentificationModule, SpeakerMatch } from './types'

import { validateEmbedding, validateName } from './validation'
import { createWasmMemory } from './wasm-memory'

function validateThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1)
    throw new RangeError('Similarity threshold must be between -1 and 1')
}

/**
 * Owns a native cosine-search database. No model or extractor is created here.
 * Enrollments live until removal or disposal; persistence belongs to the caller.
 */
export function createInMemoryDB(module: SpeakerIdentificationModule, config: InMemoryDBConfig): InMemoryDB {
  const { dimension } = config
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 0x7FFFFFFF)
    throw new RangeError('dimension must be a positive int32')
  const { withMemory, withString } = createWasmMemory(module)
  const manager = module._SherpaOnnxCreateSpeakerEmbeddingManager(dimension)
  if (!manager)
    throw new Error('Unable to create speaker embedding manager')
  let disposed = false

  function requireLive(): void {
    if (disposed)
      throw new Error('In-memory speaker database has been disposed')
  }

  function withEmbedding<T>(embedding: Float32Array, use: (ptr: number) => T): T {
    validateEmbedding(embedding, dimension)
    return withMemory(embedding.byteLength, (ptr) => {
      module.HEAPF32.set(embedding, ptr / 4)
      return use(ptr)
    })
  }

  function matches(embedding: Float32Array, threshold: number, count: number): SpeakerMatch[] {
    requireLive()
    validateThreshold(threshold)
    if (!Number.isInteger(count) || count < 1 || count > 0x7FFFFFFF)
      throw new RangeError('Match count must be a positive int32')
    return withEmbedding(embedding, (ptr) => {
      const result = module._SherpaOnnxSpeakerEmbeddingManagerGetBestMatches(manager, ptr, threshold, count)
      if (!result)
        return []
      try {
        // WASM32: result = { matches*, int32 count }; match = { float score, name* }.
        const base = module.HEAPU32[result / 4]
        const length = module.HEAP32[result / 4 + 1]
        return Array.from({ length }, (_, index) => ({
          score: module.HEAPF32[base / 4 + index * 2],
          name: module.UTF8ToString(module.HEAPU32[base / 4 + index * 2 + 1]),
        }))
      }
      finally {
        module._SherpaOnnxSpeakerEmbeddingManagerFreeBestMatches(result)
      }
    })
  }

  return {
    dimension,
    get speakers() {
      requireLive()
      const names = module._SherpaOnnxSpeakerEmbeddingManagerGetAllSpeakers(manager)
      if (!names)
        return []
      try {
        const result: string[] = []
        for (let offset = names / 4; module.HEAPU32[offset]; offset++)
          result.push(module.UTF8ToString(module.HEAPU32[offset]))
        return result
      }
      finally {
        module._SherpaOnnxSpeakerEmbeddingManagerFreeAllSpeakers(names)
      }
    },
    enroll(name, embeddings) {
      requireLive()
      validateName(name)
      if (!embeddings.length)
        throw new Error('Provide at least one enrollment embedding')
      for (const embedding of embeddings)
        validateEmbedding(embedding, dimension)
      // Reject cancelling vectors before upstream normalizes their sum.
      const sum = new Float32Array(dimension)
      for (const embedding of embeddings) {
        for (let i = 0; i < dimension; i++)
          sum[i] += embedding[i]
      }
      validateEmbedding(sum, dimension)
      return withString(name, namePtr => withMemory(embeddings.length * dimension * 4, (ptr) => {
        for (let i = 0; i < embeddings.length; i++)
          module.HEAPF32.set(embeddings[i], ptr / 4 + i * dimension)
        return Boolean(module._SherpaOnnxSpeakerEmbeddingManagerAddListFlattened(manager, namePtr, ptr, embeddings.length))
      }))
    },
    matches,
    identify: (embedding, threshold) => matches(embedding, threshold, 1)[0] ?? null,
    verify(name, embedding, threshold) {
      requireLive()
      validateName(name)
      validateThreshold(threshold)
      return withString(name, namePtr => withEmbedding(embedding, ptr => Boolean(module._SherpaOnnxSpeakerEmbeddingManagerVerify(manager, namePtr, ptr, threshold))))
    },
    contains(name) {
      requireLive()
      validateName(name)
      return withString(name, ptr => Boolean(module._SherpaOnnxSpeakerEmbeddingManagerContains(manager, ptr)))
    },
    remove(name) {
      requireLive()
      validateName(name)
      return withString(name, ptr => Boolean(module._SherpaOnnxSpeakerEmbeddingManagerRemove(manager, ptr)))
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      module._SherpaOnnxDestroySpeakerEmbeddingManager(manager)
    },
  }
}
