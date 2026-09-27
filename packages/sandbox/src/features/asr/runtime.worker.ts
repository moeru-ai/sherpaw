import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'

import type { Recognizer } from './protocol'

import { createParaformerRecognizer } from './paraformer'
import { operation, progress } from './protocol'
import { createTransducerRecognizer } from './transducer'

const { context } = createContext()
let recognizer: Recognizer | undefined

/** Triggering workflow: createRecognizer invoke -> model adapter -> transcript/metrics reply; Eventa propagates errors to the client. */
defineInvokeHandler(context, operation, async (request) => {
  let text = ''
  if (request.kind === 'load') {
    if (recognizer)
      throw new Error('The worker already owns a recording session')
    const create = request.options.modelId === 'paraformer' ? createParaformerRecognizer : createTransducerRecognizer
    recognizer = await create(request.options, request.baseUrl, status => void context.emit(progress, status))
  }
  else {
    if (!recognizer)
      throw new Error('Model is not loaded')
    if (request.kind === 'dispose')
      await recognizer.dispose()
    else
      text = request.kind === 'accept' ? await recognizer.accept(request.samples) : await recognizer.finish()
  }
  return { text, decodedChunks: 0, gpuDispatches: 0, ...recognizer.stats?.() }
})
