import type { TimedToken } from '@sherpaw/asr'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/webworkers/worker'

import type { Recognizer } from './protocol'

import { loadRecognizer } from './load'
import { operation, progress } from './protocol'

const { context } = createContext()
let recognizer: Recognizer | undefined
/** The tokens of the previous reply. */
let replied: readonly TimedToken[] = []

/** The first index where the tokens differ from the previous reply. */
function firstChange(tokens: readonly TimedToken[]) {
  let i = 0
  while (i < tokens.length && i < replied.length && tokens[i]!.text === replied[i]!.text && tokens[i]!.time === replied[i]!.time)
    i++
  return i
}

/** Triggering workflow: createRecognizer invoke -> model adapter -> transcript reply; Eventa propagates errors to the client. */
defineInvokeHandler(context, operation, async (request) => {
  let text = ''
  if (request.kind === 'load') {
    if (recognizer)
      throw new Error('The worker already owns a recording session')
    recognizer = await loadRecognizer(request.options, status => void context.emit(progress, status))
  }
  else {
    if (!recognizer)
      throw new Error('Model is not loaded')
    if (request.kind === 'dispose')
      await recognizer.dispose()
    else
      text = request.kind === 'accept' ? await recognizer.accept(request.samples) : await recognizer.finish()
  }
  const tokens = recognizer?.tokens() ?? []
  const from = firstChange(tokens)
  replied = tokens
  return { text, from, tokens: tokens.slice(from) }
})
