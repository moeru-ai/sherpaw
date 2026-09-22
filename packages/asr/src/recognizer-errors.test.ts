import { expect, it } from 'vitest'

import { createOnlineRecognizer, initASRModule, OnlineRecognizerTypes } from './index'

it('rejects a failed native recognizer before it can create a stream', async () => {
  // ROOT CAUSE:
  // A missing model or a wrong recognizer type makes the C API return zero.
  // The wrapper returned that null handle as a usable recognizer. Creating a
  // stream then trapped inside WASM with "null function" instead of a model error.
  const module = await initASRModule()

  expect(() => createOnlineRecognizer(module, {
    type: OnlineRecognizerTypes.Paraformer,
  })).toThrow('Failed to create the online recognizer. Check the model files and recognizer type.')
})
