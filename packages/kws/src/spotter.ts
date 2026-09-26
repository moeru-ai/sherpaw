import type { Detection, KeywordSpotter, KeywordSpotterConfig, KWSModule } from './types'

import { encodeKeywords, readTokens } from './keywords'

interface NativeState {
  spotter: number
  stream: number
  labels: Map<string, string>
  sampleRate?: number
}

/** Owns the native detector, stream and temporary allocations, but not model files. */
export function createKeywordSpotter(module: KWSModule, config: KeywordSpotterConfig): KeywordSpotter {
  const maxActivePaths = config.maxActivePaths ?? 4
  if (!Number.isInteger(maxActivePaths) || maxActivePaths < 1 || maxActivePaths > 2147483647)
    throw new RangeError('maxActivePaths must be a positive int32 integer')
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

  function create(encoded: ReturnType<typeof encodeKeywords>): NativeState {
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
      spotter = module._SherpawCreateKeywordSpotter(pointers[0], pointers[1], pointers[2], pointers[3], pointers[4], maxActivePaths)
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

  let current: NativeState | undefined = create(initial)
  let disposed = false
  let queue = Promise.resolve()

  function requireLive(): void {
    if (disposed)
      throw new Error('Keyword spotter has been disposed')
  }

  return {
    setKeywords(entries) {
      // Encode now, before yielding, to snapshot mutable caller input.
      let encoded: ReturnType<typeof encodeKeywords>
      try {
        requireLive()
        encoded = encodeKeywords(entries, vocabulary)
      }
      catch (error) {
        return Promise.reject(error)
      }
      const update = queue.then(() => {
        requireLive()
        const next = encoded.labels.size ? create(encoded) : undefined
        const previous = current
        current = next
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
        throw new RangeError('sampleRate must stay constant until setKeywords creates a new stream')
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
    dispose() {
      if (disposed)
        return
      disposed = true
      release(current)
      current = undefined
    },
  }
}
