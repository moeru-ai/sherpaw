<script setup lang="ts">
import type { TranscriptionResult } from '@sherpaw/xsai-transcription'
import type { AudioProcessorMessage } from './audio-processor.protocol'

import { errorMessageFrom } from '@moeru/std'
import { createSherpawProvider, streamTranscription } from '@sherpaw/xsai-transcription'
import sherpawWorkerUrl from '@sherpaw/xsai-transcription/worker?worker&url'
import { useDevicesList, useUserMedia } from '@vueuse/core'
import { nanoid } from 'nanoid/non-secure'
import { computed, onBeforeUnmount, ref, shallowRef, toRaw, useTemplateRef, watch } from 'vue'

import audioProcessor from './audio-processor.worklet?url'
import Button from './components/Button.vue'
import ModelSetup from './components/ModelSetup.vue'

const transcriptionsDisplayRef = useTemplateRef<HTMLDivElement>('transcriptionsDisplay')

const SAMPLE_RATE = 16000
type MetadataJson = Record<string, unknown>
const sherpawProvider = createSherpawProvider({ workerURL: sherpawWorkerUrl })

let audioCtx: AudioContext | null = null
let mediaStreamSource: MediaStreamAudioSourceNode | null = null
let workletNode: AudioWorkletNode | null = null

const streamResultsControllers = shallowRef<TranscriptionResult | null>(null)
let controllerReaders: ReadableStreamDefaultReader[] = []
let inputWriter: WritableStreamDefaultWriter<Float32Array> | null = null
let pushQueue = Promise.resolve()

const metadata = ref<MetadataJson | null>(null)
const data = ref<ArrayBuffer | null>(null)
const initializing = ref(false)
const errorMessage = ref('')

const previousTranscriptions = ref<{ id: string, text: string }[]>([])
const liveTranscription = ref<{ id: string, text: string }>()

const isReady = computed(() => !!streamResultsControllers.value)
const isRecording = ref(false)
const selectedAudioInputId = ref<string>()

const mediaDevicesSupported = computed(() => !!navigator.mediaDevices?.getUserMedia)
const { audioInputs, ensurePermissions } = useDevicesList({ requestPermissions: false })

const { stream, start: startUserMedia, stop: stopUserMedia } = useUserMedia({
  enabled: false,
  constraints: computed<MediaStreamConstraints>(() => ({
    video: false,
    audio: selectedAudioInputId.value
      ? { deviceId: { exact: selectedAudioInputId.value } }
      : true,
  })),
})

const transcriptions = computed(() => {
  return [
    ...previousTranscriptions.value,
    ...(liveTranscription.value ? [liveTranscription.value] : []),
  ]
})

watch(audioInputs, (inputs) => {
  if (inputs.length === 0) {
    selectedAudioInputId.value = undefined
    return
  }

  if (!selectedAudioInputId.value || !inputs.some(input => input.deviceId === selectedAudioInputId.value)) {
    selectedAudioInputId.value = inputs[0]?.deviceId
  }
}, { immediate: true })

function clearControllerListeners() {
  for (const reader of controllerReaders) {
    void reader.cancel()
  }
  controllerReaders = []
}

function attachControllerListeners(target: TranscriptionResult) {
  clearControllerListeners()

  const partialReader = target.streams.partials.getReader()
  controllerReaders.push(partialReader)
  void (async () => {
    while (true) {
      const { done, value } = await partialReader.read()
      if (done) {
        break
      }

      if (!liveTranscription.value) {
        liveTranscription.value = { id: nanoid(), text: value.text }
      }
      else {
        liveTranscription.value.text = value.text
      }

      if (transcriptionsDisplayRef.value) {
        transcriptionsDisplayRef.value.scrollTop = transcriptionsDisplayRef.value.scrollHeight
      }
    }
  })()

  const sentenceReader = target.streams.sentences.getReader()
  controllerReaders.push(sentenceReader)
  void (async () => {
    while (true) {
      const { done, value } = await sentenceReader.read()
      if (done) {
        break
      }

      if (!liveTranscription.value) {
        liveTranscription.value = { id: nanoid(), text: value.text }
      }
      else {
        liveTranscription.value.text = value.text
      }

      if (liveTranscription.value.text.length > 0) {
        previousTranscriptions.value.push(liveTranscription.value)
        liveTranscription.value = { id: nanoid(), text: '' }
      }

      if (transcriptionsDisplayRef.value) {
        transcriptionsDisplayRef.value.scrollTop = transcriptionsDisplayRef.value.scrollHeight
      }
    }
  })()
}

async function stopRecording() {
  if (workletNode && mediaStreamSource && audioCtx) {
    try {
      workletNode.disconnect(audioCtx.destination)
      mediaStreamSource.disconnect(workletNode)
    }
    catch {
      // ignore if already disconnected
    }
  }

  mediaStreamSource = null
  stopUserMedia()

  if (inputWriter && isRecording.value) {
    await inputWriter.close()
    inputWriter = null
  }

  if (streamResultsControllers.value && isRecording.value) {
    await streamResultsControllers.value.done
  }

  isRecording.value = false
}

async function initializeSession() {
  if (!metadata.value || !data.value)
    return

  await stopRecording()

  if (streamResultsControllers.value) {
    await streamResultsControllers.value.dispose()
    streamResultsControllers.value = null
  }

  clearControllerListeners()
  previousTranscriptions.value = []
  liveTranscription.value = undefined
  errorMessage.value = ''
  initializing.value = true

  try {
    const nextController = streamTranscription({
      ...sherpawProvider.speech({
        metadata: toRaw(metadata.value) as any,
        data: toRaw(data.value),
        sampleRate: SAMPLE_RATE,
      }),
      inputSampleRate: SAMPLE_RATE,
    })

    attachControllerListeners(nextController)
    inputWriter = nextController.input.getWriter()
    streamResultsControllers.value = nextController
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) || 'An unknown error occurred during initialization.'
  }
  finally {
    initializing.value = false
  }
}

function processAudioData(samples: Float32Array, sampleRate: number) {
  if (sampleRate !== SAMPLE_RATE) {
    console.warn(`Expected sample rate: ${SAMPLE_RATE}Hz, but actually received: ${sampleRate}Hz`)
  }

  if (!streamResultsControllers.value) {
    return
  }

  pushQueue = pushQueue
    .then(async () => {
      if (!inputWriter)
        return

      await inputWriter.write(samples)
    })
    .catch((error) => {
      errorMessage.value = errorMessageFrom(error) || 'An unknown error occurred while processing audio data.'
    })
}

async function setupRecorder(audioContext: AudioContext, stream: MediaStream) {
  audioCtx = audioContext

  if (mediaStreamSource) {
    try {
      mediaStreamSource.disconnect()
    }
    catch {
      // ignore if already disconnected
    }
  }

  mediaStreamSource = audioCtx.createMediaStreamSource(stream)

  try {
    if (!workletNode) {
      await audioCtx.audioWorklet.addModule(audioProcessor)
      workletNode = new AudioWorkletNode(audioCtx, 'audio-processor')

      workletNode.port.onmessage = (event) => {
        const message: AudioProcessorMessage = event.data
        if (message.type === 'data') {
          processAudioData(new Float32Array(message.data), message.sampleRate)
        }
      }
    }
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) || 'An unknown error occurred while setting up the audio processor.'
  }
}

async function requestMicrophone() {
  if (!mediaDevicesSupported.value) {
    errorMessage.value = 'getUserMedia not supported on your browser.'
    return
  }

  await ensurePermissions()
  await startUserMedia()
}

async function startRecording() {
  if (isRecording.value)
    return

  if (!isReady.value) {
    errorMessage.value = 'Initialize the model first from Model setup.'
    return
  }

  errorMessage.value = ''

  try {
    await requestMicrophone()
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) || 'An unknown error occurred while accessing the microphone.'
    return
  }

  const currentStream = stream.value
  if (!currentStream) {
    errorMessage.value = 'Unable to access microphone stream.'
    return
  }

  if (!audioCtx) {
    await setupRecorder(new AudioContext({ sampleRate: SAMPLE_RATE }), currentStream)
  }
  else {
    await setupRecorder(audioCtx, currentStream)
  }

  if (!mediaStreamSource || !workletNode || !audioCtx)
    return

  await audioCtx.resume()
  mediaStreamSource.connect(workletNode)
  workletNode.connect(audioCtx.destination)
  isRecording.value = true
}

async function disposeAll() {
  await stopRecording()

  if (streamResultsControllers.value) {
    await streamResultsControllers.value.dispose()
    streamResultsControllers.value = null
  }
  inputWriter = null

  clearControllerListeners()

  if (audioCtx) {
    try {
      await audioCtx.close()
    }
    catch {
      // noop
    }
    audioCtx = null
  }
}

onBeforeUnmount(() => {
  void disposeAll()
})
</script>

<template>
  <div
    h-dvh w-full font-sans
    flex="~ col items-center justify-start"
  >
    <div
      p-6 w-full font-sans
      flex="~ col md:row items-center justify-between gap-4 shrink-0"
    >
      <div flex="~ col items-center md:items-start">
        <div text-xl md:text-3xl font-black>
          Sherpa-ONNX WASM
        </div>
        <div font-semibold>
          XSAI Transcription Playground
        </div>
      </div>

      <details rounded-2xl p-2 border="1 neutral-200" bg="neutral-50" max-w-full>
        <summary cursor-pointer uppercase text-sm lg:text-base>
          Model setup
        </summary>
        <div mt-2 w="min(100dvw-3rem,560px)">
          <ModelSetup
            v-model:metadata="metadata"
            v-model:data="data"
            :initializing="initializing"
            @initialize="initializeSession"
          />
        </div>
      </details>
    </div>

    <div
      v-if="errorMessage"
      w-full px-6
      text-red-600 text-sm
    >
      {{ errorMessage }}
    </div>

    <div
      p-4 w-full relative
      flex="~ col items-center justify-center gap-4 grow-1"
    >
      <div
        v-if="!isRecording"
        flex="~ col items-center gap-6" w-full p-4
      >
        <div text-4xl md:text-6xl lg:text-8xl font-semibold>
          Transcription
        </div>

        <label
          flex="~ col gap-2 items-center"
          w-full max-w="480px"
        >
          <span text-sm font-semibold uppercase>Microphone</span>
          <select
            v-model="selectedAudioInputId"
            w-full p-2 rounded-lg
            border="1 neutral-300"
            :disabled="audioInputs.length === 0"
          >
            <option
              v-for="input in audioInputs"
              :key="input.deviceId"
              :value="input.deviceId"
            >
              {{ input.label || `Microphone ${input.deviceId}` }}
            </option>
          </select>
        </label>

        <Button
          :disabled="!isReady"
          @click="startRecording()"
        >
          Start
        </Button>
      </div>

      <div
        v-if="isRecording"
        flex="~ col items-center justify-end gap-6"
        w-full absolute h-full
        p-6
      >
        <div
          v-if="transcriptions.length > 0"
          ref="transcriptionsDisplayRef"
          w-full
          flex="~ col items-center justify-center gap-6 grow-1"
          overflow-auto
        >
          <div
            v-for="transcription in transcriptions"
            :key="transcription.id"
            text-center
            transition="all 300"
            :class="{
              'text-3xl op-70': transcription.id !== (liveTranscription && liveTranscription.id),
              'text-4xl font-bold': transcription.id === (liveTranscription && liveTranscription.id),
            }"
          >
            {{ transcription.text }}
            <span
              v-if="transcription.id === (liveTranscription && liveTranscription.id)"
              font-normal
              animate-pulse
            >|</span>
          </div>
        </div>

        <div flex="~ col shrink-0">
          <Button @click="stopRecording()">
            Stop transcription
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
