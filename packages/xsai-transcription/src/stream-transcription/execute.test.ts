import { expect, it } from 'vitest'

import type { RuntimeTranscriptionEvent } from './types'

import { streamTranscription } from './execute'

function createEventStream(events: RuntimeTranscriptionEvent[]): ReadableStream<RuntimeTranscriptionEvent> {
  return new ReadableStream<RuntimeTranscriptionEvent>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(event)
      }
      controller.close()
    },
  })
}

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const values: T[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    values.push(value)
  }

  return values
}

it('exposes xsai-compatible transcription delta streams from cumulative partial events', async () => {
  const result = streamTranscription({
    events: createEventStream([
      { type: 'transcription.started' },
      { type: 'transcription.partial', index: 1, text: 'hello' },
      { type: 'transcription.partial', index: 1, text: 'hello world' },
      { type: 'transcription.completed' },
    ]),
    load: async () => {},
    push: async () => {},
    finish: async () => ({ text: 'hello world', sentenceCount: 1 }),
    dispose: async () => {},
  })

  const writer = result.input.getWriter()
  await writer.close()

  expect('streams' in result).toBe(false)
  await expect(readAll(result.fullStream)).resolves.toEqual([
    { type: 'transcript.text.delta', delta: 'hello' },
    { type: 'transcript.text.delta', delta: ' world' },
    { type: 'transcript.text.done', delta: '' },
  ])
  await expect(readAll(result.textStream)).resolves.toEqual(['hello', ' world'])
  await expect(result.text).resolves.toBe('hello world')
})

it('falls back to finish text when no partial deltas were emitted', async () => {
  const result = streamTranscription({
    events: createEventStream([
      { type: 'transcription.started' },
      { type: 'transcription.completed' },
    ]),
    load: async () => {},
    push: async () => {},
    finish: async () => ({ text: 'final only', sentenceCount: 1 }),
    dispose: async () => {},
  })

  const writer = result.input.getWriter()
  await writer.close()

  await expect(result.text).resolves.toBe('final only')
})
