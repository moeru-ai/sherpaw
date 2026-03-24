import type { ASRModule } from '@sherpaw/asr'

import { initASRModule } from '@sherpaw/asr'
import { loadData } from '@sherpaw/preloader'

import type { InitTranscriptionOptions, RemoteUrlSource } from './types'

import { StreamingTranscriptionSession } from './session'
import { resolveBinary, resolveMetadata } from './stream-transcription/resolve'

export function asRemoteUrl(url: string | URL, init?: RequestInit): RemoteUrlSource {
  return {
    kind: 'remote-url' as const,
    init,
    url,
  }
}

export function pcm16ToFloat32(input: ArrayBuffer | Int16Array): Float32Array {
  const pcm = input instanceof Int16Array ? input : new Int16Array(input)
  const output = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    output[i] = pcm[i]! / 32768
  }
  return output
}

export async function initTranscriptionModule(): Promise<ASRModule> {
  return await initASRModule()
}

export async function loadModelFiles(module: ASRModule, sources: InitTranscriptionOptions): Promise<void> {
  const metadata = await resolveMetadata(sources.metadata)
  const data = await resolveBinary(sources.data)

  loadData({
    module,
    metadata,
    data,
  })
}

export async function createStreamingTranscriptionSession(options: InitTranscriptionOptions): Promise<{ module: ASRModule, session: StreamingTranscriptionSession }> {
  const module = options.module ?? await initTranscriptionModule()

  await loadModelFiles(module, options)

  const session = new StreamingTranscriptionSession(module, {
    recognizerConfig: options.recognizerConfig,
    sampleRate: options.sampleRate,
  })

  return { module, session }
}

export function createSession(module: ASRModule, options?: {
  recognizerConfig?: ConstructorParameters<typeof StreamingTranscriptionSession>[1]['recognizerConfig']
  sampleRate?: number
}): StreamingTranscriptionSession {
  return new StreamingTranscriptionSession(module, options)
}

export async function transcribeOnce(options: {
  module?: ASRModule
  locateFile?: (path: string) => string
  metadata: InitTranscriptionOptions['metadata']
  data: InitTranscriptionOptions['data']
  audio: Float32Array | Int16Array | ArrayBuffer
  sampleRate?: number
  chunkSize?: number
  recognizerConfig?: ConstructorParameters<typeof StreamingTranscriptionSession>[1]['recognizerConfig']
}): Promise<{ text: string, sentences: string[] }> {
  const { session } = await createStreamingTranscriptionSession(options)

  const sentences: string[] = []
  const unsubscribeHandlers = session.on('sentence.end', ({ text }) => {
    sentences.push(text)
  })

  const sampleRate = options.sampleRate ?? 16000
  const chunkSize = options.chunkSize ?? sampleRate / 10
  const samples = options.audio instanceof Float32Array ? options.audio : pcm16ToFloat32(options.audio)

  for (let i = 0; i < samples.length; i += chunkSize) {
    session.pushAudio(samples.subarray(i, i + chunkSize), { sampleRate })
  }

  const finished = session.finish()
  unsubscribeHandlers()
  session.dispose()

  return {
    text: sentences.join(' ').trim() || finished.text,
    sentences,
  }
}
