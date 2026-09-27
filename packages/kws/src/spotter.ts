import type { Detection, KeywordEntry, KeywordSpotter, KeywordUpdateOptions, KWSModel } from './types'
import type { KWSModule } from './wasm'

import { encodeKeywords, readTokens } from './keywords'

export interface NativeKeywordSpotterConfig extends KeywordUpdateOptions {
  model: KWSModel
  /** Must contain at least one entry at creation. */
  keywords: readonly KeywordEntry[]
}

export interface NativeKeywordSpotter extends Omit<KeywordSpotter, 'processAudio' | 'reset'> {
  /** Consume mono PCM and decode synchronously on the calling thread. */
  processAudio: (samples: Float32Array, sampleRate: number) => Detection[]
  /** Discard buffered audio and reset sample-rate tracking. */
  reset: () => void
  /** Releases the native detector and stream, leaving model files available for reuse. */
  dispose: () => void
}

interface NativeState {
  spotter: number
  stream: number
  labels: Map<string, string>
  sampleRate?: number
}

function validateSearchBeam(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647)
    throw new RangeError('maxActivePaths must be a positive int32 integer')
}

/** Owns the native detector, stream and temporary allocations, but not model files. */
export function createKeywordSpotter(module: KWSModule, config: NativeKeywordSpotterConfig): NativeKeywordSpotter {
  let maxActivePaths = config.maxActivePaths ?? 4

  validateSearchBeam(maxActivePaths)

  // Snapshot paths so caller mutation cannot alter a queued replacement.
  const paths = [config.model.encoder, config.model.decoder, config.model.joiner, config.model.tokens]

  for (const path of paths) {
    if (typeof path !== 'string' || !path.trim() || path.includes('\0'))
      throw new TypeError('Model paths must be nonempty strings without NUL')

    if (!module.FS.analyzePath(path).exists || !module.FS.isFile(module.FS.stat(path).mode) || !module.FS.stat(path).size)
      throw new Error(`Model file is not loaded or is empty: ${path}`)
  }

  const vocabulary = readTokens(module.FS.readFile(paths[3], { encoding: 'utf8' }))
  const initial = encodeKeywords(config.keywords, vocabulary)

  if (!initial.labels.size)
    throw new Error('Initial keywords must contain at least one entry')

  function release(state: NativeState | undefined): void {
    if (!state)
      return

    module._SherpaOnnxDestroyOnlineStream(state.stream)
    module._SherpaOnnxDestroyKeywordSpotter(state.spotter)
  }

  function create(encoded: ReturnType<typeof encodeKeywords>, searchBeam: number): NativeState {
    const pointers: number[] = []
    let spotter = 0

    try {
      for (const text of [...paths, encoded.text]) {
        const size = module.lengthBytesUTF8(text) + 1
        const ptr = module._malloc(size)

        if (!ptr)
          throw new Error('Unable to allocate KWS configuration')

        pointers.push(ptr)
        module.stringToUTF8(text, ptr, size)
      }

      spotter = module._SherpawCreateKeywordSpotter(pointers[0], pointers[1], pointers[2], pointers[3], pointers[4], searchBeam)

      if (!spotter)
        throw new Error('Unable to create keyword spotter; check the KWS transducer model')

      const stream = module._SherpaOnnxCreateKeywordStream(spotter)

      if (!stream)
        throw new Error('Unable to create keyword stream')

      return { spotter, stream, labels: encoded.labels }
    }
    catch (error) {
      if (spotter)
        module._SherpaOnnxDestroyKeywordSpotter(spotter)

      throw error
    }
    finally {
      for (const ptr of pointers)
        module._free(ptr)
    }
  }

  let current: NativeState | undefined = create(initial, maxActivePaths)
  let disposed = false
  let queue = Promise.resolve()

  function requireLive(): void {
    if (disposed)
      throw new Error('Keyword spotter has been disposed')
  }

  return {
    setKeywords(entries, options) {
      const requestedSearchBeam = options?.maxActivePaths

      // Encode now, before yielding, to snapshot mutable caller input.
      let encoded: ReturnType<typeof encodeKeywords>

      try {
        requireLive()

        if (requestedSearchBeam !== undefined)
          validateSearchBeam(requestedSearchBeam)

        encoded = encodeKeywords(entries, vocabulary)
      }
      catch (error) {
        return Promise.reject(error)
      }

      const update = queue.then(() => {
        requireLive()

        const searchBeam = requestedSearchBeam ?? maxActivePaths
        const next = encoded.labels.size ? create(encoded, searchBeam) : undefined
        const previous = current

        current = next
        maxActivePaths = searchBeam
        release(previous)
      })

      // A failed rebuild must not poison later queued requests.
      queue = update.catch(() => {})

      return update
    },

    processAudio(samples, sampleRate) {
      requireLive()

      if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
        throw new RangeError('sampleRate must be an integer between 8000 and 192000 Hz')

      if (!(samples instanceof Float32Array))
        throw new TypeError('samples must be a Float32Array')

      for (const sample of samples) {
        if (!Number.isFinite(sample) || Math.abs(sample) > 1)
          throw new RangeError('PCM samples must be finite and between -1 and 1')
      }

      if (!current || !samples.length)
        return []

      if (current.sampleRate !== undefined && current.sampleRate !== sampleRate)
        throw new RangeError('sampleRate must stay constant within an audio stream')

      const { spotter, stream, labels } = current
      const ptr = module._malloc(samples.byteLength)

      if (!ptr)
        throw new Error('Unable to allocate KWS audio buffer')

      try {
        module.HEAPF32.set(samples, ptr / 4)
        module._SherpaOnnxOnlineStreamAcceptWaveform(stream, sampleRate, ptr, samples.length)
        current.sampleRate = sampleRate
      }
      finally {
        module._free(ptr)
      }

      const detections: Detection[] = []

      while (module._SherpaOnnxIsKeywordStreamReady(spotter, stream)) {
        module._SherpaOnnxDecodeKeywordStream(spotter, stream)

        const resultPtr = module._SherpaOnnxGetKeywordResult(spotter, stream)

        if (!resultPtr)
          throw new Error('Unable to read keyword result')

        try {
          const keyword = module.UTF8ToString(module._SherpawKeywordResultKeyword(resultPtr))

          if (keyword) {
            const label = labels.get(keyword)

            if (label === undefined)
              throw new Error(`Unexpected keyword identifier: ${keyword}`)

            const count = module._SherpawKeywordResultCount(resultPtr)
            const tokens: string[] = []
            const timestamps: number[] = []

            for (let i = 0; i < count; i++) {
              tokens.push(module.UTF8ToString(module._SherpawKeywordResultToken(resultPtr, i)))
              timestamps.push(module._SherpawKeywordResultTimestamp(resultPtr, i))
            }

            detections.push({ label, startTime: module._SherpawKeywordResultStartTime(resultPtr), timestamps, tokens })
            module._SherpaOnnxResetKeywordStream(spotter, stream)
          }
        }
        finally {
          module._SherpaOnnxDestroyKeywordResult(resultPtr)
        }
      }

      return detections
    },

    reset() {
      requireLive()

      if (!current)
        return

      const stream = module._SherpaOnnxCreateKeywordStream(current.spotter)

      if (!stream)
        throw new Error('Unable to create keyword stream')

      module._SherpaOnnxDestroyOnlineStream(current.stream)
      current.stream = stream
      current.sampleRate = undefined
    },

    dispose() {
      if (disposed)
        return

      disposed = true
      release(current)
      current = undefined
    },
  }
}
