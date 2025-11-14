<script setup lang="ts">
import type { AudioProcessorMessage } from './audio-processor.protocol'
import { createOnlineRecognizer } from '@sherpa-onnx-wasm/asr'
import { PopoverArrow, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import audioProcessor from './audio-processor.worklet?url'
import Button from './components/Button.vue'
import ModelSetup from './components/ModelSetup.vue'
import { provideASRStore } from './store'

const transcriptionsDisplayRef = useTemplateRef<HTMLDivElement>('transcriptionsDisplay')

const SAMPLE_RATE = 16000

let audioCtx: AudioContext | null = null
let mediaStreamSource: MediaStreamAudioSourceNode | null = null
let workletNode: AudioWorkletNode | null = null

const recognizerRef: { value: any | null } = { value: null }
let recognizerStream: any = null

const previousTranscriptions = ref<{ id: string, text: string }[]>([])
const liveTranscription = ref<{ id: string, text: string }>()

const { asrModule } = provideASRStore()

const transcriptions = computed(() => {
  return [
    ...previousTranscriptions.value,
    ...(liveTranscription.value ? [liveTranscription.value] : []),
  ]
})

function processAudioData(samples: Float32Array, sampleRate: number) {
  if (sampleRate !== SAMPLE_RATE) {
    console.warn(`Expected sample rate: ${SAMPLE_RATE}Hz, but actually received: ${sampleRate}Hz`)
  }

  if (recognizerRef.value) {
    if (recognizerStream == null)
      recognizerStream = recognizerRef.value.createStream()
    recognizerStream.acceptWaveform(SAMPLE_RATE, samples)
    while (recognizerRef.value.isReady(recognizerStream)) {
      recognizerRef.value.decode(recognizerStream)
    }

    const isEndpoint = recognizerRef.value.isEndpoint(recognizerStream)
    let result = recognizerRef.value.getResult(recognizerStream).text

    if (recognizerRef.value.config?.modelConfig?.paraformer?.encoder !== '') {
      const tailPaddings = new Float32Array(SAMPLE_RATE)
      recognizerStream.acceptWaveform(SAMPLE_RATE, tailPaddings)
      while (recognizerRef.value.isReady(recognizerStream)) {
        recognizerRef.value.decode(recognizerStream)
      }
      result = recognizerRef.value.getResult(recognizerStream).text
    }

    if (result.length > 0 && (!liveTranscription.value || liveTranscription.value.text !== result)) {
      if (!liveTranscription.value) {
        liveTranscription.value = { id: crypto.randomUUID(), text: '' }
      }
      else {
        liveTranscription.value.text = result
      }
    }
    if (isEndpoint) {
      if (liveTranscription.value && liveTranscription.value.text.length > 0) {
        previousTranscriptions.value.push(liveTranscription.value)
        liveTranscription.value = { id: crypto.randomUUID(), text: '' }
      }
      recognizerRef.value.reset(recognizerStream)
    }
  }

  if (transcriptionsDisplayRef.value) {
    transcriptionsDisplayRef.value.scrollTop = transcriptionsDisplayRef.value.scrollHeight
  }
}

async function setupRecorder(audioContext: AudioContext, stream: MediaStream) {
  if (audioCtx)
    return
  audioCtx = audioContext
  mediaStreamSource = audioCtx.createMediaStreamSource(stream)

  // Load and setup AudioWorklet
  try {
    await audioCtx.audioWorklet.addModule(audioProcessor)
    workletNode = new AudioWorkletNode(audioCtx, 'audio-processor')

    workletNode.port.onmessage = (event) => {
      const message: AudioProcessorMessage = event.data
      switch (message.type) {
        case 'data':
          processAudioData(new Float32Array(message.data), message.sampleRate)
          break
      }
    }
  }
  catch (error) {
    console.error('Failed to load audio worklet:', error)
  }
}

watch(asrModule, (newModule) => {
  if (newModule) {
    recognizerRef.value = createOnlineRecognizer(newModule)
  }
})

async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('getUserMedia not supported on your browser!')
    return
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  if (!audioCtx)
    await setupRecorder(new AudioContext({ sampleRate: SAMPLE_RATE }), stream)
}

const isRecording = ref(false)

async function startRecording() {
  await requestMicrophone()

  if (!mediaStreamSource || !workletNode || !audioCtx)
    return
  mediaStreamSource.connect(workletNode)
  workletNode.connect(audioCtx.destination)
  isRecording.value = true
}

function stopRecording() {
  if (workletNode && mediaStreamSource && audioCtx) {
    try {
      workletNode.disconnect(audioCtx.destination)
      mediaStreamSource.disconnect(workletNode)
    }
    catch {
      // ignore if already disconnected
    }
  }
  isRecording.value = false
  previousTranscriptions.value = []
  liveTranscription.value = undefined
}

onBeforeUnmount(() => {
  if (audioCtx) {
    try {
      audioCtx.close()
    }
    catch {}
  }
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
          ASR Sandbox
        </div>
      </div>

      <PopoverRoot>
        <PopoverTrigger
          flex="~ row items-center gap-2"
          bg="transparent hover:neutral/10"
          rounded-2xl p-2 md:p-4
          transition="background-color 300"
          text-sm lg:text-base
        >
          <div uppercase>
            Model setup
          </div>
          <div i-ri:ai-generate-3d-line text-xl :class="{ 'op-50': !asrModule }" />
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            side="bottom"
            :side-offset="0"
            rounded-lg
            bg-white shadow-sm b m-4
            class="max-w-[calc(100dvw-var(--spacing)*4*2)] w-[460px] will-change-[transform,opacity]
              data-[state=open]:animate-[fade-in_150ms_linear_1]
              data-[state=closed]:animate-[fade-out_150ms_linear_1]"
          >
            <ModelSetup />
            <PopoverArrow class="fill-white stroke-gray-200" />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
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

        <Button
          @click="startRecording()"
        >
          Start transcription
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
