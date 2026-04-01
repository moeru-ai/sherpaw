import { expect, it } from 'vitest'

import { OnlineRecognizerTypes } from '@sherpaw/asr'

import { inferRecognizerType } from './recognizer'

function createMetadata(...filenames: string[]) {
  return {
    files: filenames.map(filename => ({ filename })),
  }
}

it('inferRecognizerType detects transducer metadata', () => {
  expect(
    inferRecognizerType(createMetadata('encoder.onnx', 'decoder.onnx', 'joiner.onnx')),
  ).toBe(OnlineRecognizerTypes.Transducer)
})

it('inferRecognizerType detects specialized ctc models before generic encoder matches', () => {
  expect(
    inferRecognizerType(createMetadata('encoder.onnx', 'nemo-ctc.onnx')),
  ).toBe(OnlineRecognizerTypes.NemoCTC)
  expect(
    inferRecognizerType(createMetadata('encoder.onnx', 'tone-ctc.onnx')),
  ).toBe(OnlineRecognizerTypes.ToneCTC)
})

it('inferRecognizerType detects paraformer and zipformer2ctc metadata', () => {
  expect(
    inferRecognizerType(createMetadata('encoder.onnx', 'decoder.onnx')),
  ).toBe(OnlineRecognizerTypes.Paraformer)
  expect(
    inferRecognizerType(createMetadata('encoder.onnx')),
  ).toBe(OnlineRecognizerTypes.Zipformer2CTC)
})

it('inferRecognizerType supports nested filenames and unknown metadata', () => {
  expect(
    inferRecognizerType(createMetadata('models/subdir/joiner.onnx')),
  ).toBe(OnlineRecognizerTypes.Transducer)
  expect(inferRecognizerType(createMetadata('tokens.txt', 'metadata.json'))).toBeNull()
  expect(inferRecognizerType(null)).toBeNull()
})
