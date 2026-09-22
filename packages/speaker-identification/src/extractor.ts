import type { Extractor, ExtractorConfig, SpeakerIdentificationModule } from './types'

import { validateEmbedding, validateName } from './validation'
import { createWasmMemory } from './wasm-memory'

/**
 * Owns only a native extractor. Each extract call owns a fresh stream, and
 * returned embeddings are copies that remain valid after disposal.
 */
export function createExtractor(module: SpeakerIdentificationModule, config: ExtractorConfig): Extractor {
  validateName(config.model)
  const minDuration = config.minDurationSeconds ?? 1
  if (!Number.isFinite(minDuration) || minDuration <= 0)
    throw new RangeError('minDurationSeconds must be positive')

  const { withMemory, withString } = createWasmMemory(module)

  const extractor = withString(config.model, model => withString('cpu', provider => withMemory(16, (ptr) => {
    if (!module._SherpaOnnxFileExists(model))
      throw new Error(`Speaker model is not loaded: ${config.model}`)
    // WASM32 layout of SherpaOnnxSpeakerEmbeddingExtractorConfig in c-api.h.
    module.HEAPU32[ptr / 4] = model
    module.HEAP32[ptr / 4 + 1] = 1 // The shipped runtime uses one inference thread.
    module.HEAP32[ptr / 4 + 2] = Number(config.debug ?? false)
    module.HEAPU32[ptr / 4 + 3] = provider
    return module._SherpaOnnxCreateSpeakerEmbeddingExtractor(ptr)
  })))
  if (!extractor)
    throw new Error('Unable to create speaker embedding extractor')

  const dimension = module._SherpaOnnxSpeakerEmbeddingExtractorDim(extractor)
  let disposed = false

  function requireLive(): void {
    if (disposed)
      throw new Error('Speaker embedding extractor has been disposed')
  }

  return {
    dimension,
    extract(samples, sampleRate) {
      requireLive()
      if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
        throw new RangeError('sampleRate must be an integer between 8000 and 192000 Hz')
      if (!(samples instanceof Float32Array) || samples.length < minDuration * sampleRate)
        throw new RangeError(`Provide at least ${minDuration} seconds of mono PCM`)
      let peak = 0
      for (const value of samples) {
        if (!Number.isFinite(value) || Math.abs(value) > 1)
          throw new RangeError('PCM samples must be finite and between -1 and 1')
        peak = Math.max(peak, Math.abs(value))
      }
      if (peak === 0)
        throw new Error('Cannot extract an embedding from digital silence')
      const stream = module._SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractor)
      if (!stream)
        throw new Error('Unable to create speaker embedding stream')
      try {
        withMemory(samples.byteLength, (ptr) => {
          module.HEAPF32.set(samples, ptr / 4)
          module._SherpaOnnxOnlineStreamAcceptWaveform(stream, sampleRate, ptr, samples.length)
        })
        module._SherpaOnnxOnlineStreamInputFinished(stream)
        if (!module._SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractor, stream))
          throw new Error('Not enough audio features to extract an embedding')
        const ptr = module._SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractor, stream)
        if (!ptr)
          throw new Error('Speaker embedding extraction failed')
        try {
          const embedding = module.HEAPF32.slice(ptr / 4, ptr / 4 + dimension)
          validateEmbedding(embedding, dimension)
          return embedding
        }
        finally {
          module._SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(ptr)
        }
      }
      finally {
        module._SherpaOnnxDestroyOnlineStream(stream)
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      module._SherpaOnnxDestroySpeakerEmbeddingExtractor(extractor)
    },
  }
}
