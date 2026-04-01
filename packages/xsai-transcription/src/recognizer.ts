import type { OnlineRecognizerType } from '@sherpaw/asr'
import type { DataMetadata } from '@sherpaw/preloader'

import { OnlineRecognizerTypes } from '@sherpaw/asr'

interface MetadataFile { filename?: unknown }

export function inferRecognizerType(metadata: DataMetadata | Record<string, unknown> | null | undefined): OnlineRecognizerType | null {
  const files = Array.isArray(metadata?.files) ? metadata.files : []
  const filenames = files
    .map(file => String((file as MetadataFile).filename ?? '').toLowerCase())
    .filter(Boolean)

  if (filenames.some(filename => filename.endsWith('/joiner.onnx') || filename === 'joiner.onnx')) {
    return OnlineRecognizerTypes.Transducer
  }

  if (filenames.some(filename => filename.endsWith('/nemo-ctc.onnx') || filename === 'nemo-ctc.onnx')) {
    return OnlineRecognizerTypes.NemoCTC
  }

  if (filenames.some(filename => filename.endsWith('/tone-ctc.onnx') || filename === 'tone-ctc.onnx')) {
    return OnlineRecognizerTypes.ToneCTC
  }

  if (filenames.some(filename => filename.endsWith('/decoder.onnx') || filename === 'decoder.onnx')) {
    return OnlineRecognizerTypes.Paraformer
  }

  if (filenames.some(filename => filename.endsWith('/encoder.onnx') || filename === 'encoder.onnx')) {
    return OnlineRecognizerTypes.Zipformer2CTC
  }

  return null
}
