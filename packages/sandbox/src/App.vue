<script setup lang="ts">
import type { MainModule } from '@sherpa-onnx-wasm/asr'
import type { Metadata } from '@sherpa-onnx-wasm/preloader'
import type { AudioProcessorMessage } from './audio-processor.protocol'
import { createOnlineRecognizer, initASRModule } from '@sherpa-onnx-wasm/asr'
import wasmUrl from '@sherpa-onnx-wasm/asr/module.wasm?url'
import { loadData } from '@sherpa-onnx-wasm/preloader'
import { useDropZone } from '@vueuse/core'
import prettyBytes from 'pretty-bytes'
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef } from 'vue'
import audioProcessor from './audio-processor.worklet?url'
import Button from './components/Button.vue'
import Card from './components/Card.vue'
import { readFileAsArrayBuffer, readFileAsText } from './helpers'

const metadata = shallowRef<Metadata>()
const metadataStringified = computed(() => JSON.stringify(metadata.value, null, 2))
const data = shallowRef<ArrayBuffer>()

const metadataDropZoneRef = useTemplateRef<HTMLDivElement>('metadataDropZone')
const dataDropZoneRef = useTemplateRef<HTMLDivElement>('dataDropZone')

const metadataFileInputRef = useTemplateRef('metadataFileInput')
const dataFileInputRef = useTemplateRef('dataFileInput')

const transcriptionsDisplayRef = useTemplateRef<HTMLDivElement>('transcriptionsDisplay')

const asrModule = shallowRef<MainModule>()

async function readMetadataFile(file: File) {
  const text = await readFileAsText(file)
  metadata.value = JSON.parse(text)
}

async function readDataFile(file: File) {
  const arrayBuffer = await readFileAsArrayBuffer(file)
  data.value = arrayBuffer
}

function handleMetadataFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  readMetadataFile(file)
}

function handleDataFileInput(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return
  readDataFile(file)
}

const { isOverDropZone: isOverMetadataDropZone } = useDropZone(metadataDropZoneRef, {
  onDrop: (files: File[] | null) => {
    if (!files || files.length === 0 || !files[0])
      return

    readMetadataFile(files[0])
  },
  multiple: false,
  preventDefaultForUnhandled: false,
})

const { isOverDropZone: isOverDataDropZone } = useDropZone(dataDropZoneRef, {
  onDrop: (files: File[] | null) => {
    if (!files || files.length === 0 || !files[0])
      return

    readDataFile(files[0])
  },
  multiple: false,
  preventDefaultForUnhandled: false,
})

const textAreaRef = ref<HTMLTextAreaElement | null>(null)
const SAMPLE_RATE = 16000

let audioCtx: AudioContext | null = null
let mediaStreamSource: MediaStreamAudioSourceNode | null = null
let workletNode: AudioWorkletNode | null = null

const recognizerRef: { value: any | null } = { value: null }
let recognizerStream: any = null

const previousTranscriptions = ref<{ id: string, text: string }[]>([])
const liveTranscription = ref<{ id: string, text: string }>()

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

async function handleInitASRModule() {
  if (!metadata.value || !data.value)
    return

  asrModule.value = await initASRModule({
    locateFile() {
      return wasmUrl
    },
  })

  loadData(asrModule.value, metadata.value, data.value, 'streaming-zipformer-bilingual-zh-en-2023-02-20')
  recognizerRef.value = createOnlineRecognizer(asrModule.value)
}

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
    p-4 max-w-screen-md mx-auto font-sans mt-4
    flex="~ col items-center gap-4"
  >
    <div text-center>
      <div text-3xl font-black>
        Sherpa-ONNX WASM
      </div>
      <div font-semibold>
        ASR Sandbox
      </div>
    </div>
  </div>

  <div
    p-4 max-w-screen-xl mx-auto font-sans
    flex="~ col items-center gap-4"
  >
    <Card>
      <template #title>
        Transcription
      </template>

      <div flex="~ col items-start gap-2" w-full>
        <div
          ref="transcriptionsDisplayRef" w-full max-h-96
          overflow-auto
        >
          <div
            v-for="transcription in transcriptions"
            :key="transcription.id"
            transition="all 300"
            :class="{
              'text-base op-50': transcription.id !== (liveTranscription && liveTranscription.id),
              'text-xl font-semibold': transcription.id === (liveTranscription && liveTranscription.id),
            }"
          >
            {{ transcription.text }}
            <span
              v-if="transcription.id === (liveTranscription && liveTranscription.id)"
              animate-pulse
            >|</span>
          </div>
        </div>

        <div self-end flex="~ gap-2">
          <Button
            v-if="!isRecording"
            @click="startRecording()"
          >
            Start transcription
          </Button>
          <Button
            v-else
            @click="stopRecording()"
          >
            Stop transcription
          </Button>
        </div>
      </div>
    </Card>
  </div>

  <div
    p-4 max-w-screen-md mx-auto font-sans
    flex="~ col items-center gap-4"
  >
    <Card>
      <template #title>
        Model
      </template>

      <div flex="~ col items-start" w-full>
        <div
          ref="metadataDropZone"
          b="b-1 dashed dark-300/20"
          flex="~ col items-center gap-2"
          w-full
          py-4
        >
          <div font-bold uppercase>
            (Metadata)
          </div>

          <div
            v-if="metadata"
            w-full h-96
            b="1 neutral-300"
            rounded-xl overflow-hidden
          >
            <textarea
              id="metadata"
              :value="metadataStringified"
              readonly
              w-full font-mono
              vertical-bottom
              p-3
              outline-none
              text-sm
              h-full
            />
          </div>

          <div text-lg text-center>
            <template v-if="!isOverMetadataDropZone">
              Drop a metadata file here, or
              <span
                text-dark underline mt-2
                role="button"
                @click="metadataFileInputRef?.click()"
              >choose a file</span><span v-if="metadata"> to replace</span>.
            </template>
            <template v-else>
              Release to use this file.
            </template>
          </div>

          <input
            ref="metadataFileInput"
            type="file"
            hidden
            @change="handleMetadataFileInput"
          >
        </div>

        <div
          ref="dataDropZone"
          flex="~ col items-center gap-2"
          py-4
          w-full
        >
          <div font-bold uppercase>
            (Data)
          </div>

          <div v-if="data" text-center>
            <div text-3xl font-semibold>
              {{ prettyBytes(data.byteLength) }}
            </div>
            <div text-lg>
              loaded
            </div>
          </div>

          <div text-lg text-center>
            <template v-if="!isOverDataDropZone">
              Drop a data file here, or
              <span
                text-dark underline mt-2
                role="button"
                @click="dataFileInputRef?.click()"
              >choose a file</span><span v-if="data"> to replace</span>.
            </template>
            <template v-else>
              Release to use this file.
            </template>
          </div>

          <input
            ref="dataFileInput"
            type="file"
            hidden
            @change="handleDataFileInput"
          >
        </div>

        <Button
          self-end
          :disabled="!metadata || !data"
          @click="handleInitASRModule"
        >
          <template v-if="!asrModule">
            Initialize ASR Module
          </template>
          <template v-else>
            Re-initialize ASR Module
          </template>
        </Button>
      </div>
    </Card>
  </div>
</template>
