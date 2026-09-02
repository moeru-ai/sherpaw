import { loadVirtualData } from '@sherpaw/preloader'
import { expect, it } from 'vitest'

import { createOnlineRecognizer, initASRModule } from '../src'
import { decodeWavPcm16, encodeWavPcm16 } from './helpers/wav'

async function fetchBytes(url: URL): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url.toString()}: ${res.status} ${res.statusText}`)
  }
  return new Uint8Array(await res.arrayBuffer())
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

it('transcribes wav samples with the browser asr pipeline', async () => {
  const wav = await fetchBytes(new URL('./fixtures/0.wav', import.meta.url))
  const wavBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
  const wavData = decodeWavPcm16(wavBuffer)

  const asrModule = await initASRModule()
  if (!asrModule?.addRunDependency) {
    throw new Error('ASR module failed to initialize for browser test')
  }
  expect((asrModule as any)._SherpaOnnxCreateOfflineRecognizer).toBeTypeOf('function')
  expect((asrModule as any)._SherpaOnnxOnlineStreamGetOption).toBeTypeOf('function')
  expect((asrModule as any)._SherpaOnnxOfflineStreamGetOption).toBeTypeOf('function')

  const [encoder, decoder, tokens] = await Promise.all([
    fetchBytes(new URL('./model/encoder.onnx', import.meta.url)),
    fetchBytes(new URL('./model/decoder.onnx', import.meta.url)),
    fetchBytes(new URL('./model/tokens.txt', import.meta.url)),
  ])

  const filenames = loadVirtualData({
    module: asrModule,
    virtualData: {
      'encoder.onnx': encoder,
      'decoder.onnx': decoder,
      'tokens.txt': tokens,
    },
    dependencyId: 'asr-model',
  })

  const recognizer = createOnlineRecognizer(asrModule, {
    type: 1,
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      paraformer: {
        encoder: filenames['encoder.onnx'],
        decoder: filenames['decoder.onnx'],
      },
      tokens: filenames['tokens.txt'],
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      modelType: '',
      modelingUnit: 'cjkchar',
      bpeVocab: '',
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
    hotwordsFile: '',
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: {
      graph: '',
      maxActive: 3000,
    },
    ruleFsts: '',
    ruleFars: '',
  })

  const stream = recognizer.createStream()
  stream.setOption('is_final', '1')
  expect(stream.getOption('is_final')).toBe('1')
  stream.acceptWaveform(wavData.sampleRate, wavData.samples)
  stream.inputFinished()

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream)
  }

  const result = recognizer.getResult(stream)
  const text = String(result?.text ?? '').trim()
  expect(text.length).toBeGreaterThan(0)
}, 120000)
