import type { Recognizer, RecognizerReply, RecognizerRequest } from './types'

import { createParaformerRecognizer } from './paraformer'
import { createTransducerRecognizer } from './transducer'

let recognizer: Recognizer | undefined

function reply(message: RecognizerReply) {
  globalThis.postMessage(message)
}

/** Triggering workflow: createRecognizer RPC -> selected model adapter -> transcript and metrics reply. */
globalThis.onmessage = async (event: MessageEvent<RecognizerRequest>) => {
  const request = event.data
  try {
    let text = ''
    if (request.kind === 'load') {
      if (recognizer)
        throw new Error('The worker already owns a recording session')
      const create = request.options.modelId === 'paraformer' ? createParaformerRecognizer : createTransducerRecognizer
      recognizer = await create(request.options, request.baseUrl, status => reply({ id: request.id, status }))
    }
    else {
      if (!recognizer)
        throw new Error('Model is not loaded')
      if (request.kind === 'dispose')
        await recognizer.dispose()
      else
        text = request.kind === 'accept' ? await recognizer.accept(request.samples) : await recognizer.finish()
    }
    reply({ id: request.id, snapshot: { text, decodedChunks: 0, gpuDispatches: 0, ...recognizer.stats?.() } })
  }
  catch (error) {
    // The client terminates this worker on an error, releasing native and GPU state.
    reply({ id: request.id, error: String(error) })
  }
}
