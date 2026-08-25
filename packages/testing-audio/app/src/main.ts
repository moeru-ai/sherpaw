import type { TranscriptionResult } from '@sherpaw/xsai-transcription'

import { errorMessageFrom } from '@moeru/std'
import { createOnlineRecognizerConfig, OnlineRecognizerTypes } from '@sherpaw/asr'
import { asRemoteUrl, createSherpawProvider, streamTranscription } from '@sherpaw/xsai-transcription'
import transcriptionWorkerURL from '@sherpaw/xsai-transcription/worker?worker&url'

import type { SherpawAudioModel } from '../../src/models'

import { sherpawAudioModels } from '../../src/models'
import audioProcessorURL from './audio-processor.worklet?worker&url'

const sampleRate = 16000
const modelRoutePrefix = '/__sherpaw-models'

const state: SherpawAudioTestSnapshot = {
  error: '',
  status: 'idle',
  transcription: '',
}

let audioContext: AudioContext | undefined
let mediaStream: MediaStream | undefined
let mediaSource: MediaStreamAudioSourceNode | undefined
let worklet: AudioWorkletNode | undefined
let transcription: TranscriptionResult | undefined
let writer: WritableStreamDefaultWriter<Float32Array> | undefined
let writeQueue = Promise.resolve()

const statusElement = document.querySelector('#status')
const transcriptElement = document.querySelector('#transcript')
const errorElement = document.querySelector('#error')

function displayState() {
  if (statusElement)
    statusElement.textContent = state.status
  if (transcriptElement)
    transcriptElement.textContent = state.transcription
  if (errorElement)
    errorElement.textContent = state.error
}

async function readTranscriptionText(stream: ReadableStream<string>) {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done)
        return

      state.transcription += value
      displayState()
    }
  }
  finally {
    reader.releaseLock()
  }
}

async function loadAudioWorklet() {
  const context = new AudioContext({ sampleRate })
  try {
    await context.audioWorklet.addModule(audioProcessorURL)
  }
  finally {
    await context.close()
  }
}

async function start(model: SherpawAudioModel) {
  if (state.status === 'loading-model' || state.status === 'recording')
    return

  state.error = ''
  state.transcription = ''
  state.status = 'loading-model'
  displayState()

  try {
    const modelRoot = `${modelRoutePrefix}/${model.id}`
    const recognizerType = model.recognizer === 'paraformer'
      ? OnlineRecognizerTypes.Paraformer
      : OnlineRecognizerTypes.Transducer
    const provider = createSherpawProvider({ workerURL: transcriptionWorkerURL })
    transcription = streamTranscription({
      ...provider.speech({
        metadata: asRemoteUrl(`${modelRoot}/preload.js.metadata`),
        data: asRemoteUrl(`${modelRoot}/preload.data`),
        sampleRate,
        recognizerConfig: createOnlineRecognizerConfig(recognizerType, {
          featConfig: { sampleRate },
          modelConfig: { debug: 0 },
        }),
      }),
      inputSampleRate: sampleRate,
    })
    writer = transcription.input.getWriter()
    void readTranscriptionText(transcription.textStream)

    // The file-backed microphone starts when getUserMedia resolves. Load the
    // model first so that the recognizer receives the complete WAV fixture.
    await writer.ready

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    audioContext = new AudioContext({ sampleRate })
    await audioContext.audioWorklet.addModule(audioProcessorURL)
    mediaSource = audioContext.createMediaStreamSource(mediaStream)
    worklet = new AudioWorkletNode(audioContext, 'sherpaw-testing-audio-processor')
    worklet.port.onmessage = (event: MessageEvent<{ type: string, sampleRate: number, data: ArrayBufferLike }>) => {
      if (event.data.type !== 'data' || event.data.sampleRate !== sampleRate || !writer)
        return

      const samples = new Float32Array(event.data.data)
      writeQueue = writeQueue.then(() => writer?.write(samples))
    }

    mediaSource.connect(worklet)
    worklet.connect(audioContext.destination)
    await audioContext.resume()
    state.status = 'recording'
    displayState()
  }
  catch (error) {
    state.error = errorMessageFrom(error) ?? 'Unknown audio test error.'
    state.status = 'stopped'
    displayState()
    throw error
  }
}

async function stop() {
  worklet?.disconnect()
  mediaSource?.disconnect()
  for (const track of mediaStream?.getTracks() ?? [])
    track.stop()

  await writeQueue
  if (writer) {
    await writer.close()
    if (transcription)
      state.transcription = await transcription.text
    writer.releaseLock()
  }
  await audioContext?.close()

  audioContext = undefined
  mediaStream = undefined
  mediaSource = undefined
  worklet = undefined
  transcription = undefined
  writer = undefined
  state.status = 'stopped'
  displayState()
}

window.__sherpawAudioTest = {
  loadAudioWorklet,
  snapshot: () => ({ ...state }),
  start,
  stop,
}

document.querySelector('#start')?.addEventListener('click', () => {
  void start(sherpawAudioModels[0])
})

displayState()
