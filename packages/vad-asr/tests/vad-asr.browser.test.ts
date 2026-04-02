import { loadVirtualData } from '@sherpaw/preloader'
import { expect, it } from 'vitest'

import { CircularBuffer, createVad, createVadAsr, initVadAsrModule, OfflineRecognizer } from '../src'
import { decodeWavPcm16, encodeWavPcm16 } from './helpers/wav'

const vadModelPath = new URL('./models/silero_vad.onnx', import.meta.url)

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url.toString()}: ${res.status} ${res.statusText}`)
  }
  return new Uint8Array(await res.arrayBuffer())
}

function downsampleBuffer(samples: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
  if (outputSampleRate === inputSampleRate) {
    return samples
  }

  const sampleRateRatio = inputSampleRate / outputSampleRate
  const newLength = Math.round(samples.length / sampleRateRatio)
  const result = new Float32Array(newLength)

  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let accum = 0
    let count = 0

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < samples.length; i++) {
      accum += samples[i]
      count += 1
    }

    result[offsetResult] = count === 0 ? 0 : accum / count
    offsetResult += 1
    offsetBuffer = nextOffsetBuffer
  }

  return result
}

it('runs in a browser context', () => {
  expect(window).toBeDefined()
})

it('encodes and decodes wav pcm16 data', () => {
  const sampleRate = 16000
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25, -0.25])
  const buffer = encodeWavPcm16(samples, sampleRate)
  const decoded = decodeWavPcm16(buffer)

  expect(decoded.sampleRate).toBe(sampleRate)
  expect(decoded.samples.length).toBe(samples.length)
  expect(decoded.samples[1]).toBeCloseTo(samples[1], 2)
})

it('transcribes wav samples with the browser vad-asr pipeline', async () => {
  const module = await initVadAsrModule()
  expect(module).toBeDefined()

  const modelName = 'moonshine-tiny-ja-quantized-2026-02-27'

  const [silero, encoder, decoder, tokens, wav] = await Promise.all([
    fetchBytes(vadModelPath),
    fetchBytes(new URL(`./models/${modelName}/encoder_model.ort`, import.meta.url)),
    fetchBytes(new URL(`./models/${modelName}/decoder_model_merged.ort`, import.meta.url)),
    fetchBytes(new URL(`./models/${modelName}/tokens.txt`, import.meta.url)),
    fetchBytes(new URL(`./models/${modelName}/test_wavs/0.wav`, import.meta.url)),
  ])

  const filenames = loadVirtualData({
    module,
    virtualData: {
      'silero_vad.onnx': silero,
      'encoder_model.ort': encoder,
      'decoder_model_merged.ort': decoder,
      'tokens.txt': tokens,
    },
    dependencyId: 'vad-asr-model',
  })

  const recognizer = new OfflineRecognizer({
    modelConfig: {
      tokens: filenames['tokens.txt'],
      moonshine: {
        encoder: filenames['encoder_model.ort'],
        mergedDecoder: filenames['decoder_model_merged.ort'],
      },
    },
  }, module)
  expect(recognizer).toBeDefined()

  const vad = createVad(module)
  const circularBuffer = new CircularBuffer(30 * 16000, module)
  expect(vad).toBeDefined()

  const wavArrayBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
  const wavData = decodeWavPcm16(wavArrayBuffer)
  const samples = downsampleBuffer(wavData.samples, wavData.sampleRate, 16000)
  circularBuffer.push(samples)

  const transcripts: string[] = []
  const windowSize = vad.config.sileroVad.windowSize

  function decodeDetectedSegments() {
    while (!vad.isEmpty()) {
      const segment = vad.front()
      vad.pop()

      const stream = recognizer.createStream()
      stream.acceptWaveform(16000, segment.samples)
      recognizer.decode(stream)

      const result = recognizer.getResult(stream)
      const text = String(result?.text ?? '').trim()
      if (text.length > 0) {
        transcripts.push(text)
      }
      stream.free()
    }
  }

  while (circularBuffer.size() > windowSize) {
    const chunk = circularBuffer.get(circularBuffer.head(), windowSize)
    vad.acceptWaveform(chunk)
    circularBuffer.pop(windowSize)
    decodeDetectedSegments()
  }

  vad.flush()
  decodeDetectedSegments()

  expect(transcripts.length).toBeGreaterThan(0)

  circularBuffer.free()
  vad.free()
  recognizer.free()
}, 120000)

it('transcribes wav samples with createVADASR using hybrid model inputs', async () => {
  const modelName = 'moonshine-tiny-ja-quantized-2026-02-27'

  const [encoder, decoder, tokens, wav] = await Promise.all([
    fetchBytes(new URL(`./models/${modelName}/encoder_model.ort`, import.meta.url)),
    fetchBytes(new URL(`./models/${modelName}/decoder_model_merged.ort`, import.meta.url)),
    fetchBytes(new URL(`./models/${modelName}/tokens.txt`, import.meta.url)),
    fetchBytes(new URL(`./models/${modelName}/test_wavs/0.wav`, import.meta.url)),
  ])

  const session = await createVadAsr({
    models: {
      vad: {
        silero: vadModelPath,
      },
      asr: {
        modelConfig: {
          moonshine: {
            encoder: { filename: 'encoder_model.ort', source: encoder },
            mergedDecoder: { filename: 'decoder_model_merged.ort', source: decoder },
          },
          tokens: { filename: 'tokens.txt', source: tokens },
        },
      },
    },
    runtime: {
      sampleRate: 16000,
    },
  })

  const wavArrayBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
  const wavData = decodeWavPcm16(wavArrayBuffer)
  const samples = downsampleBuffer(wavData.samples, wavData.sampleRate, 16000)

  const segments = await session.transcribe(samples, 16000)
  expect(segments.length).toBeGreaterThan(0)
  expect(segments.some(s => s.text.length > 0)).toBe(true)
  session.close()
}, 120000)

it('requires filename when model data is provided', async () => {
  await expect(createVadAsr({
    models: {
      vad: {
        silero: { data: new Uint8Array([1, 2, 3]) as any, filename: 'silero_vad.onnx' },
      },
      asr: {
        modelConfig: {
          moonshine: {
            encoder: { data: new Uint8Array([1]), filename: 'encoder_model.ort' },
            mergedDecoder: { data: new Uint8Array([1]), filename: 'decoder_model_merged.ort' },
          },
          tokens: { data: new Uint8Array([1]), filename: 'tokens.txt' },
        },
      },
    },
  })).rejects.toThrow('filename')
})

it('supports legacy asr model shape and validates filenames', async () => {
  await expect(createVadAsr({
    models: {
      vad: {
        silero: { data: new Uint8Array([1]), filename: 'silero_vad.onnx' },
      },
      asr: {
        moonshine: {
          encoder: { data: new Uint8Array([1]), filename: 'encoder_model.ort' },
          mergedDecoder: { data: new Uint8Array([1]), filename: 'decoder_model_merged.ort' },
        },
        tokens: { data: new Uint8Array([1]) as any, filename: 'tokens.txt' },
      },
    },
  })).rejects.toThrow('filename')
})
