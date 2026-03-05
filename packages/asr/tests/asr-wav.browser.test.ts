import { loadVirtualData } from '@sherpaw/preloader'
import { expect, it } from 'vitest'
import { createOnlineRecognizer, initASRModule } from '../src'
import { decodeWavPcm16, encodeWavPcm16 } from './helpers/wav'

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
  const mp3Url = new URL('./fixtures/en-IE-EmilyNeural.mp3', import.meta.url)
  const mp3Buffer = await (await fetch(mp3Url)).arrayBuffer()
  const audioContext = new AudioContext()
  const decoded = await audioContext.decodeAudioData(mp3Buffer.slice(0))

  let pcmSamples = decoded.getChannelData(0)
  if (decoded.sampleRate !== 16000) {
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    pcmSamples = rendered.getChannelData(0)
  }
  await audioContext.close()

  const wavBuffer = encodeWavPcm16(pcmSamples, 16000)
  const wavData = decodeWavPcm16(wavBuffer)

  const asrModule = await initASRModule()
  if (!asrModule?.addRunDependency) {
    throw new Error('ASR module failed to initialize for browser test')
  }

  const [encoder, decoder, tokens] = await Promise.all([
    fetch(new URL('./model/encoder.onnx', import.meta.url)).then(r => r.arrayBuffer()),
    fetch(new URL('./model/decoder.onnx', import.meta.url)).then(r => r.arrayBuffer()),
    fetch(new URL('./model/tokens.txt', import.meta.url)).then(r => r.arrayBuffer()),
  ])

  loadVirtualData({
    module: asrModule,
    virtualData: {
      files: [
        { filename: 'encoder.onnx', data: new Uint8Array(encoder) },
        { filename: 'decoder.onnx', data: new Uint8Array(decoder) },
        { filename: 'tokens.txt', data: new Uint8Array(tokens) },
      ],
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
        encoder: './encoder.onnx',
        decoder: './decoder.onnx',
      },
      tokens: './tokens.txt',
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
  stream.acceptWaveform(wavData.sampleRate, wavData.samples)
  stream.inputFinished()

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream)
  }

  const result = recognizer.getResult(stream)
  const text = String(result?.text ?? '').trim()
  expect(text.length).toBeGreaterThan(0)
}, 120000)
