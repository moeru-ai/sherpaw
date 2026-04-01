import { expect, it } from 'vitest'

import {
  createOnlineRecognizerConfig,
  OnlineRecognizerTypes,
} from './index'

it('createOnlineRecognizerConfig creates transducer defaults', () => {
  const config = createOnlineRecognizerConfig(OnlineRecognizerTypes.Transducer)

  expect(config.type).toBe(OnlineRecognizerTypes.Transducer)
  expect(config.featConfig.sampleRate).toBe(16000)
  expect(config.featConfig.featureDim).toBe(80)
  expect(config.modelConfig.tokens).toBe('./tokens.txt')
  expect(config.modelConfig.transducer).toEqual({
    encoder: './encoder.onnx',
    decoder: './decoder.onnx',
    joiner: './joiner.onnx',
  })
})

it('createOnlineRecognizerConfig creates per-recognizer model defaults', () => {
  expect(
    createOnlineRecognizerConfig(OnlineRecognizerTypes.Paraformer).modelConfig.paraformer,
  ).toEqual({
    encoder: './encoder.onnx',
    decoder: './decoder.onnx',
  })

  expect(
    createOnlineRecognizerConfig(OnlineRecognizerTypes.Zipformer2CTC).modelConfig.zipformer2Ctc,
  ).toEqual({
    model: './encoder.onnx',
  })

  expect(
    createOnlineRecognizerConfig(OnlineRecognizerTypes.NemoCTC).modelConfig.nemoCtc,
  ).toEqual({
    model: './nemo-ctc.onnx',
  })

  expect(
    createOnlineRecognizerConfig(OnlineRecognizerTypes.ToneCTC).modelConfig.toneCtc,
  ).toEqual({
    model: './tone-ctc.onnx',
  })
})

it('createOnlineRecognizerConfig merges overrides without dropping defaults', () => {
  const config = createOnlineRecognizerConfig(OnlineRecognizerTypes.Paraformer, {
    featConfig: {
      sampleRate: 22050,
    },
    modelConfig: {
      debug: 0,
      paraformer: {
        decoder: './custom-decoder.onnx',
      },
    },
    ctcFstDecoderConfig: {
      maxActive: 1024,
    },
  })

  expect(config.type).toBe(OnlineRecognizerTypes.Paraformer)
  expect(config.featConfig).toEqual({
    sampleRate: 22050,
    featureDim: 80,
  })
  expect(config.modelConfig.debug).toBe(0)
  expect(config.modelConfig.tokens).toBe('./tokens.txt')
  expect(config.modelConfig.paraformer).toEqual({
    encoder: './encoder.onnx',
    decoder: './custom-decoder.onnx',
  })
  expect(config.ctcFstDecoderConfig).toEqual({
    graph: '',
    maxActive: 1024,
  })
})
