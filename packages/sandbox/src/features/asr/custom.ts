import type { ASRModule } from '@sherpaw/asr'

import { createOnlineRecognizer } from '@sherpaw/asr'

import type { Recognizer } from './types'

/** Legacy model setup supplies a live WASM module, which must stay in its original realm. */
export function createCustomRecognizer(module: ASRModule | undefined): Recognizer {
  if (!module)
    throw new Error('Load and initialize your model in Model setup first.')
  const recognizer = createOnlineRecognizer(module)
  const stream = recognizer.createStream()
  const completed: string[] = []
  function decode() {
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    const text = recognizer.getResult(stream).text
    const result = [...completed, text].join(' ')
    if (recognizer.isEndpoint(stream)) {
      if (text)
        completed.push(text)
      recognizer.reset(stream)
    }
    return result
  }
  return {
    /** Triggering workflow: microphone pump -> custom Sherpa stream -> partial transcript. */
    async accept(samples) {
      stream.acceptWaveform(16000, samples)
      return decode()
    },
    /** Triggering workflow: Stop -> mark final input -> drain the custom Sherpa stream. */
    async finish() {
      stream.setOption('is_final', '1')
      stream.inputFinished()
      return decode()
    },
    /** Triggering workflow: page release -> free the custom stream and recognizer. */
    async dispose() {
      stream.free()
      recognizer.free()
    },
  }
}
