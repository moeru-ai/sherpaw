import type * as Ort from 'onnxruntime-web/webgpu'

/**
 * Nemotron 3 Diarization (Streaming Sortformer v3) in onnxruntime-web, fed block by block. A port of
 * the research prototype in `.local/scripts/2026-10-02-sortformer`, which follows parakeet-rs
 * `src/sortformer.rs`. Experimental: only the sandbox uses it.
 */

const N_FFT = 512
const WIN_LENGTH = 400
const HOP = 160
const N_MELS = 128
const PREEMPH = 0.97
const LOG_ZERO_GUARD = 5.9604645e-8
const SUBSAMPLING = 8
const UPSAMPLE = 8
const EMB = 512
/** Speaker slots of the model. */
export const SPEAKERS = 8
const SIL_FRAMES_PER_SPK = 1
const PRED_SCORE_THRESHOLD = 0.25
const STRONG_BOOST_RATE = 0.75
const WEAK_BOOST_RATE = 1.5
const MIN_POS_SCORES_RATE = 0.5
const SCORES_BOOST_LATEST = 0.05
const MAX_INDEX = 99999

/** Chunk sizes in 80 ms model frames. `low` decides each frame about 1.04 s after its audio. */
export const profiles = {
  low: { chunk: 9, right: 4, fifo: 264, update: 222, cache: 264 },
  veryLow: { chunk: 6, right: 2, fifo: 264, update: 222, cache: 264 },
}

export type Profile = typeof profiles.low

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

function toBf16(x: number) {
  f32[0] = x
  const bits = u32[0]!

  u32[0] = ((bits + 0x7FFF + ((bits >>> 16) & 1)) & 0xFFFF0000) >>> 0

  return f32[0]!
}

const F_SP = 200 / 3
const MIN_LOG_HZ = 1000
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP
const LOG_STEP = 0.06875177742094912
const hzToMel = (hz: number) => (hz < MIN_LOG_HZ ? hz / F_SP : MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) / LOG_STEP)
const melToHz = (mel: number) => (mel < MIN_LOG_MEL ? mel * F_SP : MIN_LOG_HZ * Math.exp((mel - MIN_LOG_MEL) * LOG_STEP))

function melFilterbank() {
  const bins = N_FFT / 2 + 1
  const melMin = hzToMel(0)
  const melMax = hzToMel(8000)
  const points = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(melMin + (melMax - melMin) * i / (N_MELS + 1)))
  const freqs = Array.from({ length: bins }, (_, k) => k * 16000 / N_FFT)
  const bank = Array.from({ length: N_MELS }, () => new Float32Array(bins))

  for (let i = 0; i < N_MELS; i++) {
    const enorm = 2 / (points[i + 2]! - points[i]!)

    for (let k = 0; k < bins; k++) {
      const lower = (freqs[k]! - points[i]!) / (points[i + 1]! - points[i]!)
      const upper = (points[i + 2]! - freqs[k]!) / (points[i + 2]! - points[i + 1]!)

      bank[i]![k] = toBf16(Math.fround(Math.fround(Math.max(0, Math.min(lower, upper))) * Math.fround(enorm)))
    }
  }

  return bank
}

const hann = (() => {
  const w = new Float32Array(N_FFT)
  const offset = (N_FFT - WIN_LENGTH) / 2

  for (let i = 0; i < WIN_LENGTH; i++)
    w[offset + i] = toBf16(Math.fround(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN_LENGTH - 1))))

  return w
})()
const bank = melFilterbank()

// Iterative radix-2 FFT of N_FFT real samples.
const bitrev = (() => {
  const r = new Uint16Array(N_FFT)
  const bits = Math.log2(N_FFT)

  for (let i = 0; i < N_FFT; i++) {
    let x = i
    let y = 0

    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1)
      x >>= 1
    }

    r[i] = y
  }

  return r
})()
const cosT = Float64Array.from({ length: N_FFT / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / N_FFT))
const sinT = Float64Array.from({ length: N_FFT / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / N_FFT))

/** The power of bins 0..N/2 of one frame. */
function powerSpectrum(frame: Float64Array, out: Float32Array) {
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)

  for (let i = 0; i < N_FFT; i++)
    re[bitrev[i]!] = frame[i]!

  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1
    const step = N_FFT / size

    for (let start = 0; start < N_FFT; start += size) {
      for (let j = 0; j < half; j++) {
        const c = cosT[j * step]!
        const s = sinT[j * step]!
        const a = start + j
        const b = a + half
        const tr = re[b]! * c - im[b]! * s
        const ti = re[b]! * s + im[b]! * c

        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
      }
    }
  }

  for (let k = 0; k <= N_FFT / 2; k++)
    out[k] = Math.fround(re[k]! * re[k]! + im[k]! * im[k]!)
}

/** The custom metadata of an ONNX model (top-level field 14 of ModelProto). */
function onnxMetadata(bytes: Uint8Array) {
  let at = 0
  const varint = () => {
    let result = 0
    let shift = 0

    for (;;) {
      const byte = bytes[at++]!

      result += (byte & 0x7F) * 2 ** shift

      if (!(byte & 0x80))
        return result

      shift += 7
    }
  }
  const text = (from: number, to: number) => new TextDecoder().decode(bytes.subarray(from, to))
  const metadata: Record<string, string> = {}

  while (at < bytes.length) {
    const key = varint()
    const field = Math.floor(key / 8)
    const wire = key & 7

    if (wire === 0) {
      varint()
    }
    else if (wire === 2) {
      const length = varint()
      const end = at + length

      if (field === 14) {
        let k = ''
        let v = ''

        while (at < end) {
          const inner = varint()
          const size = varint()

          if ((inner >> 3) === 1)
            k = text(at, at + size)
          else if ((inner >> 3) === 2)
            v = text(at, at + size)

          at += size
        }

        metadata[k] = v
      }

      at = end
    }
    else if (wire === 1) {
      at += 8
    }
    else if (wire === 5) {
      at += 4
    }
    else {
      throw new Error(`Unexpected protobuf wire type ${wire}`)
    }
  }

  return metadata
}

export interface NemotronStream {
  /** Adds 16 kHz mono PCM. Resolves to the speaker probabilities of the newly decided 10 ms frames, `SPEAKERS` per frame. */
  push: (samples: Float32Array) => Promise<Float32Array>
  /** Decides the rest of the audio. Call `reset` before more audio. */
  flush: () => Promise<Float32Array>
  /** Starts a new recording. */
  reset: () => void
  /** Milliseconds spent in the model so far. */
  readonly computeMs: number
  /** Releases the session. */
  dispose: () => Promise<void>
}

/** Creates the streaming diarizer on an ONNX Runtime module and the model bytes. */
export async function createNemotronStream(ort: typeof Ort, bytes: Uint8Array, { profile = profiles.low, executionProviders = ['webgpu'] }: { profile?: Profile, executionProviders?: string[] } = {}): Promise<NemotronStream> {
  const metadata = onnxMetadata(bytes)
  const silEmb = Float32Array.from((metadata.learnable_sil_emb ?? '').split(',').filter(Boolean).map(Number))

  if (silEmb.length !== EMB)
    throw new Error(`The model has no learnable_sil_emb metadata (${silEmb.length} values)`)

  const session = await ort.InferenceSession.create(bytes, { executionProviders })
  const { chunk: chunkLen, right, fifo: fifoMax, update, cache: cacheMax } = profile
  const stride = chunkLen * SUBSAMPLING
  const feed = (chunkLen + right) * SUBSAMPLING

  // Model state: rows of EMB floats, and rows of SPEAKERS predictions.
  let spkcache: Float32Array[] = []
  let spkcachePreds: Float32Array[] | undefined
  let fifo: Float32Array[] = []
  let fifoPreds: Float32Array[] = []
  let computeMs = 0

  // Feature state. Positions are absolute: samples and 10 ms frames since the start.
  /** Pre-emphasized audio from sample `kept` on. */
  let audio = new Float32Array(0)
  let kept = 0
  let received = 0
  let previous = 0
  /** Log-mel rows from frame `chunkStart` on. */
  let features: Float32Array[] = []
  let nextFrame = 0
  let chunkStart = 0
  let emitted = 0

  function reset() {
    spkcache = []
    spkcachePreds = undefined
    fifo = []
    fifoPreds = []
    audio = new Float32Array(0)
    kept = 0
    received = 0
    previous = 0
    features = []
    nextFrame = 0
    chunkStart = 0
    emitted = 0
  }

  const flat = (rows: Float32Array[], width: number) => {
    const out = new Float32Array(rows.length * width)

    rows.forEach((row, i) => out.set(row, i * width))

    return out
  }

  function logPredScores(preds: Float32Array[]) {
    return preds.map((p) => {
      let log1Sum = 0

      for (let s = 0; s < SPEAKERS; s++)
        log1Sum += Math.log(Math.max(1 - p[s]!, PRED_SCORE_THRESHOLD))

      return Float64Array.from({ length: SPEAKERS }, (_, s) => Math.log(Math.max(p[s]!, PRED_SCORE_THRESHOLD)) - Math.log(Math.max(1 - p[s]!, PRED_SCORE_THRESHOLD)) + log1Sum - Math.log(0.5))
    })
  }

  /** Keeps the most informative `cacheMax` rows of the speaker cache, as in NeMo. */
  function compress() {
    const n = spkcache.length
    const perSpk = cacheMax / SPEAKERS
    const lenPerSpk = perSpk - SIL_FRAMES_PER_SPK
    const strong = Math.floor(lenPerSpk * STRONG_BOOST_RATE)
    const weak = Math.floor(lenPerSpk * WEAK_BOOST_RATE)
    const minPos = Math.floor(lenPerSpk * MIN_POS_SCORES_RATE)
    const preds = spkcachePreds!
    const scores = logPredScores(preds)
    const posCount = Array.from({ length: SPEAKERS }, () => 0)

    for (const row of scores) {
      for (let s = 0; s < SPEAKERS; s++) {
        if (row[s]! > 0)
          posCount[s]!++
      }
    }

    for (let t = 0; t < n; t++) {
      for (let s = 0; s < SPEAKERS; s++) {
        if (preds[t]![s]! <= 0.5 || (scores[t]![s]! <= 0 && posCount[s]! >= minPos))
          scores[t]![s] = -Infinity
      }
    }

    for (let t = Math.min(cacheMax, n); t < n; t++) {
      for (let s = 0; s < SPEAKERS; s++)
        scores[t]![s] = scores[t]![s]! + SCORES_BOOST_LATEST
    }

    for (const [count, scale] of [[strong, 2], [weak, 1]] as const) {
      for (let s = 0; s < SPEAKERS; s++) {
        const order = Array.from({ length: n }, (_, t) => t).sort((a, b) => scores[b]![s]! - scores[a]![s]! || 0)

        for (const t of order.slice(0, count)) {
          if (scores[t]![s] !== -Infinity)
            scores[t]![s] = scores[t]![s]! - scale * Math.log(0.5)
        }
      }
    }

    const total = n + SIL_FRAMES_PER_SPK
    const flatScores: Array<[number, number]> = []

    for (let s = 0; s < SPEAKERS; s++) {
      for (let t = 0; t < total; t++)
        flatScores.push([s * total + t, t < n ? scores[t]![s]! : Infinity])
    }

    flatScores.sort((a, b) => (b[1] === a[1] ? 0 : b[1] > a[1] ? 1 : -1))

    const top = flatScores.slice(0, cacheMax).map(([index, score]) => (score === -Infinity ? MAX_INDEX : index)).sort((a, b) => a - b)
    const newCache: Float32Array[] = []
    const newPreds: Float32Array[] = []

    for (let i = 0; i < cacheMax; i++) {
      const index = top[i]
      const frame = index === undefined || index === MAX_INDEX ? -1 : index % total

      if (frame < 0 || frame >= n) {
        newCache.push(silEmb)
        newPreds.push(new Float32Array(SPEAKERS))
      }
      else {
        newCache.push(spkcache[frame]!)
        newPreds.push(preds[frame]!)
      }
    }

    spkcache = newCache
    spkcachePreds = newPreds
  }

  /** One model step on `length` mel rows from `chunkStart`. Returns the chunk's 10 ms predictions. */
  async function step(length: number) {
    const padded = Math.ceil(length / SUBSAMPLING) * SUBSAMPLING
    const chunk = new Float32Array(padded * N_MELS)

    for (let i = 0; i < length; i++)
      chunk.set(features[i]!, i * N_MELS)

    const nc = spkcache.length
    const nf = fifo.length
    const started = performance.now()
    const out = await session.run({
      chunk: new ort.Tensor('float32', chunk, [1, padded, N_MELS]),
      chunk_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(length)]), [1]),
      spkcache: new ort.Tensor('float32', flat(spkcache, EMB), [1, nc, EMB]),
      spkcache_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(nc)]), [1]),
      fifo: new ort.Tensor('float32', flat(fifo, EMB), [1, nf, EMB]),
      fifo_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(nf)]), [1]),
    })

    computeMs += performance.now() - started

    const diar = out.preds_diar!.data as Float32Array
    const hires = out.preds_hires!.data as Float32Array
    const embs = out.chunk_pre_encode_embs!.data as Float32Array
    const row80 = (t: number) => diar.slice(t * SPEAKERS, (t + 1) * SPEAKERS)
    const keep = Math.min(chunkLen, Math.ceil(length / SUBSAMPLING))
    const newFifoPreds = Array.from({ length: nf }, (_, i) => row80(nc + i))
    const chunkPreds = Array.from({ length: keep }, (_, i) => row80(nc + nf + i))
    const chunkEmbs = Array.from({ length: keep }, (_, i) => embs.slice(i * EMB, (i + 1) * EMB))
    const hiresStart = (nc + nf) * UPSAMPLE

    fifo = [...fifo, ...chunkEmbs]
    fifoPreds = [...newFifoPreds, ...chunkPreds]

    if (fifo.length > fifoMax) {
      const pop = Math.min(Math.max(update, keep + nf - fifoMax), fifo.length)
      const popEmbs = fifo.slice(0, pop)
      const popPreds = fifoPreds.slice(0, pop)

      fifo = fifo.slice(pop)
      fifoPreds = fifoPreds.slice(pop)
      spkcache = [...spkcache, ...popEmbs]

      if (spkcachePreds)
        spkcachePreds = [...spkcachePreds, ...popPreds]

      if (spkcache.length > cacheMax) {
        spkcachePreds ??= [...Array.from({ length: nc }, (_, i) => row80(i)), ...popPreds]
        compress()
      }
    }

    return hires.slice(hiresStart * SPEAKERS, (hiresStart + keep * UPSAMPLE) * SPEAKERS)
  }

  /** Computes the log-mel rows that the audio now covers, or all rows at the end. */
  function computeFeatures(final: boolean) {
    const last = final ? Math.floor(received / HOP) : Math.floor((received - N_FFT / 2) / HOP)
    const frame = new Float64Array(N_FFT)
    const power = new Float32Array(N_FFT / 2 + 1)

    for (; nextFrame <= last; nextFrame++) {
      const start = nextFrame * HOP - N_FFT / 2

      for (let i = 0; i < N_FFT; i++) {
        const at = start + i

        frame[i] = at >= 0 && at < received ? Math.fround(audio[at - kept]! * hann[i]!) : 0
      }

      powerSpectrum(frame, power)

      const row = new Float32Array(N_MELS)

      for (let m = 0; m < N_MELS; m++) {
        const weights = bank[m]!
        let sum = 0

        for (let k = 0; k < power.length; k++)
          sum += weights[k]! * power[k]!

        row[m] = Math.log(Math.fround(sum) + LOG_ZERO_GUARD)
      }

      features.push(row)
    }

    // The next frame reads from half a window before its center.
    const needed = Math.max(0, nextFrame * HOP - N_FFT / 2)

    if (needed > kept) {
      audio = audio.slice(Math.min(needed - kept, audio.length))
      kept = needed
    }
  }

  /** Runs the model on each chunk that the features cover. */
  async function run(final: boolean) {
    const total = Math.floor(received / HOP) + 1
    const parts: Float32Array[] = []

    while (final ? chunkStart < total : nextFrame - chunkStart >= feed) {
      const length = Math.min(chunkStart + feed, final ? total : nextFrame) - chunkStart
      let part = await step(length)

      if (final)
        part = part.subarray(0, Math.max(0, (total - emitted) * SPEAKERS))

      parts.push(part)
      emitted += part.length / SPEAKERS
      features = features.slice(stride)
      chunkStart += stride
    }

    const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))

    let at = 0

    for (const part of parts) {
      out.set(part, at)
      at += part.length
    }

    return out
  }

  return {
    async push(samples) {
      const grown = new Float32Array(audio.length + samples.length)

      grown.set(audio)

      for (let i = 0; i < samples.length; i++) {
        grown[audio.length + i] = received + i === 0 ? samples[i]! : Math.fround(samples[i]! - PREEMPH * previous)
        previous = samples[i]!
      }

      audio = grown
      received += samples.length
      computeFeatures(false)

      return run(false)
    },

    async flush() {
      computeFeatures(true)

      return run(true)
    },

    reset,

    get computeMs() {
      return computeMs
    },

    async dispose() {
      await session.release()
    },
  }
}
