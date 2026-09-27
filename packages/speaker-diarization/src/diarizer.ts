import type { Clustering, DiarizationModel, SegmentationOptions, SpeakerSegment } from './types'
import type { SpeakerDiarizationModule } from './wasm'

export interface NativeDiarizerConfig extends SegmentationOptions {
  model: DiarizationModel
  clustering: Clustering
}

export interface NativeDiarizer {
  readonly sampleRate: number
  /** Processes one complete recording synchronously on the calling thread. */
  diarize: (samples: Float32Array, sampleRate: number, clustering?: Clustering) => SpeakerSegment[]
  /** Releases the native diarizer, leaving model files available for reuse. */
  dispose: () => void
}

// WASM32 layout of SherpaOnnxOfflineSpeakerDiarizationConfig in c-api.h, in 4-byte words:
//   0 segmentation model     5 embedding model        9 num_clusters
//   1 window_shift_ratio     6 embedding num_threads 10 threshold
//   2 num_threads            7 embedding debug       11 min_duration_on
//   3 debug                  8 embedding provider    12 min_duration_off
//   4 provider
const CONFIG_BYTES = 13 * 4

function validatePositive(value: number, name: string, max = Number.POSITIVE_INFINITY): void {
  // The C API replaces 0 with its own default, so only positive values reach native code unchanged.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max)
    throw new RangeError(`${name} must be a finite number greater than 0${Number.isFinite(max) ? ` and at most ${max}` : ''}`)
}

function validateClustering(clustering: Clustering): void {
  if (typeof clustering !== 'object' || clustering === null || (clustering.numSpeakers === undefined) === (clustering.distanceThreshold === undefined))
    throw new TypeError('clustering must set exactly one of numSpeakers or distanceThreshold')

  if (clustering.numSpeakers !== undefined && (!Number.isInteger(clustering.numSpeakers) || clustering.numSpeakers < 1))
    throw new RangeError('numSpeakers must be a positive integer')

  if (clustering.distanceThreshold !== undefined)
    validatePositive(clustering.distanceThreshold, 'distanceThreshold')
}

/** Owns the native diarizer and temporary allocations, but not model files. */
export function createDiarizer(module: SpeakerDiarizationModule, config: NativeDiarizerConfig): NativeDiarizer {
  const windowShiftRatio = config.windowShiftRatio ?? 0.1
  const minDurationOn = config.minDurationOn ?? 0.2
  const minDurationOff = config.minDurationOff ?? 0.5

  validatePositive(windowShiftRatio, 'windowShiftRatio', 1)
  validatePositive(minDurationOn, 'minDurationOn')
  validatePositive(minDurationOff, 'minDurationOff')
  validateClustering(config.clustering)

  // Snapshot paths so caller mutation cannot alter the native configuration.
  const paths = [config.model.segmentation, config.model.embedding]

  for (const path of paths) {
    if (typeof path !== 'string' || !path.trim() || path.includes('\0'))
      throw new TypeError('Model paths must be nonempty strings without NUL')
  }

  function writeClustering(ptr: number, clustering: Clustering): void {
    // num_clusters > 0 ignores the threshold; -1 selects threshold clustering.
    module.HEAP32[ptr / 4 + 9] = clustering.numSpeakers ?? -1
    module.HEAPF32[ptr / 4 + 10] = clustering.distanceThreshold ?? 0.5
  }

  const pointers: number[] = []
  let diarizer = 0

  try {
    for (const text of [...paths, 'cpu']) {
      const size = module.lengthBytesUTF8(text) + 1
      const ptr = module._malloc(size)

      if (!ptr)
        throw new Error('Unable to allocate diarization configuration')

      pointers.push(ptr)
      module.stringToUTF8(text, ptr, size)
    }

    const ptr = module._malloc(CONFIG_BYTES)

    if (!ptr)
      throw new Error('Unable to allocate diarization configuration')

    pointers.push(ptr)

    const word = ptr / 4
    const [segmentation, embedding, provider] = pointers

    module.HEAPU32[word] = segmentation
    module.HEAPF32[word + 1] = windowShiftRatio
    module.HEAP32[word + 2] = 1 // The shipped runtime uses one inference thread.
    module.HEAP32[word + 3] = 0
    module.HEAPU32[word + 4] = provider
    module.HEAPU32[word + 5] = embedding
    module.HEAP32[word + 6] = 1
    module.HEAP32[word + 7] = 0
    module.HEAPU32[word + 8] = provider
    writeClustering(ptr, config.clustering)
    module.HEAPF32[word + 11] = minDurationOn
    module.HEAPF32[word + 12] = minDurationOff
    diarizer = module._SherpaOnnxCreateOfflineSpeakerDiarization(ptr)

    // The C API returns null when a model file is missing or invalid.
    if (!diarizer)
      throw new Error('Unable to create speaker diarizer; check that both model files are loaded')
  }
  finally {
    for (const ptr of pointers)
      module._free(ptr)
  }

  const sampleRate = module._SherpaOnnxOfflineSpeakerDiarizationGetSampleRate(diarizer)
  let applied = config.clustering
  let disposed = false

  function requireLive(): void {
    if (disposed)
      throw new Error('Speaker diarizer has been disposed')
  }

  function applyClustering(clustering: Clustering): void {
    if (clustering.numSpeakers === applied.numSpeakers && clustering.distanceThreshold === applied.distanceThreshold)
      return

    const ptr = module._malloc(CONFIG_BYTES)

    if (!ptr)
      throw new Error('Unable to allocate diarization configuration')

    try {
      // SetConfig reads only the clustering fields.
      module.HEAPU8.fill(0, ptr, ptr + CONFIG_BYTES)
      writeClustering(ptr, clustering)
      module._SherpaOnnxOfflineSpeakerDiarizationSetConfig(diarizer, ptr)
      applied = clustering
    }
    finally {
      module._free(ptr)
    }
  }

  function process(samples: Float32Array): number {
    const ptr = module._malloc(samples.byteLength)

    if (!ptr)
      throw new Error('Unable to allocate diarization audio buffer')

    try {
      module.HEAPF32.set(samples, ptr / 4)

      return module._SherpaOnnxOfflineSpeakerDiarizationProcess(diarizer, ptr, samples.length)
    }
    catch (error) {
      // C++ exceptions cannot be caught in this build and reach JavaScript as a pointer.
      if (typeof error === 'number')
        throw new Error('Native speaker diarization threw a C++ exception; create a new diarizer before retrying')

      throw error
    }
    finally {
      module._free(ptr)
    }
  }

  function readSegments(result: number): SpeakerSegment[] {
    const count = module._SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(result)

    if (!count)
      return []

    const ptr = module._SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(result)

    if (!ptr)
      throw new Error('Unable to read speaker diarization segments')

    try {
      // Upstream labels are cluster indices and can skip values. Renumber them by first appearance.
      const labels = new Map<number, number>()
      const segments: SpeakerSegment[] = []

      for (let i = 0; i < count; i++) {
        const word = ptr / 4 + i * 3
        const cluster = module.HEAP32[word + 2]

        if (!labels.has(cluster))
          labels.set(cluster, labels.size)

        segments.push({ start: module.HEAPF32[word], end: module.HEAPF32[word + 1], speaker: labels.get(cluster)! })
      }

      return segments
    }
    finally {
      module._SherpaOnnxOfflineSpeakerDiarizationDestroySegment(ptr)
    }
  }

  return {
    sampleRate,

    diarize(samples, inputSampleRate, clustering = config.clustering) {
      requireLive()

      if (inputSampleRate !== sampleRate)
        throw new RangeError(`sampleRate must be ${sampleRate} Hz; resample the audio first`)

      if (!(samples instanceof Float32Array) || !samples.length)
        throw new TypeError('samples must be a nonempty Float32Array')

      for (const sample of samples) {
        if (!Number.isFinite(sample) || Math.abs(sample) > 1)
          throw new RangeError('PCM samples must be finite and between -1 and 1')
      }

      validateClustering(clustering)
      applyClustering(clustering)

      const result = process(samples)

      if (!result)
        throw new Error('Speaker diarization failed')

      try {
        return readSegments(result)
      }
      finally {
        module._SherpaOnnxOfflineSpeakerDiarizationDestroyResult(result)
      }
    },

    dispose() {
      if (disposed)
        return

      disposed = true
      module._SherpaOnnxDestroyOfflineSpeakerDiarization(diarizer)
    },
  }
}
