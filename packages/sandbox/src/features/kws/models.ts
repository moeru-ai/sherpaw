import type { KWSModel } from '@sherpaw/kws'

// Prepared by @sherpaw/kws test:prepare. Vite serves these as separate assets.
export const modelURLs: KWSModel = {
  encoder: new URL('../../../../kws/tests/models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/encoder-epoch-13-avg-2-chunk-16-left-64.onnx', import.meta.url).href,
  decoder: new URL('../../../../kws/tests/models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/decoder-epoch-13-avg-2-chunk-16-left-64.onnx', import.meta.url).href,
  joiner: new URL('../../../../kws/tests/models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/joiner-epoch-13-avg-2-chunk-16-left-64.onnx', import.meta.url).href,
  tokens: new URL('../../../../kws/tests/models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/tokens.txt', import.meta.url).href,
}
