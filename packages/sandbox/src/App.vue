<script setup lang="ts">
import type { MainModule } from '@sherpa-onnx-wasm/asr'
import type { Metadata } from '@sherpa-onnx-wasm/preloader'
import { createOnlineRecognizer, initASRModule } from '@sherpa-onnx-wasm/asr'
import wasmUrl from '@sherpa-onnx-wasm/asr/module.wasm?url'
import { loadData } from '@sherpa-onnx-wasm/preloader'
import { useDropZone } from '@vueuse/core'
import prettyBytes from 'pretty-bytes'
import { Label, Separator } from 'reka-ui'
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef } from 'vue'
import Button from './components/Button.vue'
import Card from './components/Card.vue'

const metadata = shallowRef<Metadata>()
const metadataStringified = computed(() => JSON.stringify(metadata.value, null, 2))
const data = shallowRef<ArrayBuffer>()

const metadataDropZoneRef = useTemplateRef<HTMLDivElement>('metadataDropZone')
const dataDropZoneRef = useTemplateRef<HTMLDivElement>('dataDropZone')

const metadataFileInputRef = useTemplateRef('metadataFileInput')
const dataFileInputRef = useTemplateRef('dataFileInput')

const asrModule = shallowRef<MainModule>()

async function readFileAsArrayBuffer(file: File) {
  return new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(e.target?.result as ArrayBuffer)
    }
    reader.readAsArrayBuffer(file)
  })
}

async function readFileAsText(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(e.target?.result as string)
    }
    reader.readAsText(file)
  })
}

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

// UI refs
const textAreaRef = ref<HTMLTextAreaElement | null>(null)

// recordings list for template rendering
const recordings = ref<Array<{ name: string, url: string }>>([])

// ASR / audio state
const expectedSampleRate = 16000
let audioCtx: AudioContext | null = null
let mediaStreamSource: MediaStreamAudioSourceNode | null = null
let recordSampleRate = 0
let recorderNode: ScriptProcessorNode | null = null
let leftchannel: Int16Array[] = []

// recognizer state
const recognizerRef: { value: any | null } = { value: null }
let recognizerStream: any = null
const resultList = ref<string[]>([])
const lastResult = ref('')

function getDisplayResult() {
  return `${resultList.value.join('\n')}${lastResult.value ? `\n${lastResult.value}` : ''}`
}

function flatten(listOfSamples: Int16Array[]) {
  let n = 0
  for (let i = 0; i < listOfSamples.length; ++i) n += listOfSamples[i]!.length
  const ans = new Int16Array(n)
  let offset = 0
  for (let i = 0; i < listOfSamples.length; ++i) {
    const chunk = listOfSamples[i]!
    ans.set(chunk, offset)
    offset += chunk.length
  }
  return ans
}

function toWav(samples: Int16Array) {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buf)

  view.setUint32(0, 0x46464952, true)
  view.setUint32(4, 36 + samples.length * 2, true)
  view.setUint32(8, 0x45564157, true)
  view.setUint32(12, 0x20746D66, true)
  view.setUint32(16, 16, true)
  view.setUint32(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, expectedSampleRate, true)
  view.setUint32(28, expectedSampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x61746164, true)
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; ++i) {
    view.setInt16(offset, samples[i] ?? 0, true)
    offset += 2
  }
  return new Blob([view], { type: 'audio/wav' })
}

function downsampleBuffer(buffer: Float32Array, exportSampleRate: number): Float32Array {
  if (!recordSampleRate || exportSampleRate === recordSampleRate)
    return buffer
  const sampleRateRatio = recordSampleRate / exportSampleRate
  const newLength = Math.round(buffer.length / sampleRateRatio)
  const result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i] ?? 0
      count++
    }
    result[offsetResult] = accum / (count || 1)
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }
  return result
}

function setupRecorder(audioContext: AudioContext, stream: MediaStream) {
  if (audioCtx)
    return
  audioCtx = audioContext
  recordSampleRate = audioCtx.sampleRate
  mediaStreamSource = audioCtx.createMediaStreamSource(stream)

  const bufferSize = 4096
  const numberOfInputChannels = 1
  const numberOfOutputChannels = 1
  recorderNode = audioCtx.createScriptProcessor(
    bufferSize,
    numberOfInputChannels,
    numberOfOutputChannels,
  )

  recorderNode.onaudioprocess = function (e: AudioProcessingEvent) {
    const floatSamples = new Float32Array(e.inputBuffer.getChannelData(0))
    const samples = downsampleBuffer(floatSamples, expectedSampleRate)

    // ASR processing (if recognizer is ready)
    if (recognizerRef.value) {
      if (recognizerStream == null)
        recognizerStream = recognizerRef.value.createStream()
      recognizerStream.acceptWaveform(expectedSampleRate, samples)
      while (recognizerRef.value.isReady(recognizerStream)) {
        recognizerRef.value.decode(recognizerStream)
      }

      const isEndpoint = recognizerRef.value.isEndpoint(recognizerStream)
      let result = recognizerRef.value.getResult(recognizerStream).text

      if (recognizerRef.value.config?.modelConfig?.paraformer?.encoder !== '') {
        const tailPaddings = new Float32Array(expectedSampleRate)
        recognizerStream.acceptWaveform(expectedSampleRate, tailPaddings)
        while (recognizerRef.value.isReady(recognizerStream)) {
          recognizerRef.value.decode(recognizerStream)
        }
        result = recognizerRef.value.getResult(recognizerStream).text
      }

      if (result.length > 0 && lastResult.value !== result)
        lastResult.value = result
      if (isEndpoint) {
        if (lastResult.value.length > 0) {
          resultList.value.push(lastResult.value)
          lastResult.value = ''
        }
        recognizerRef.value.reset(recognizerStream)
      }
    }

    // update UI text area
    if (textAreaRef.value) {
      textAreaRef.value.value = getDisplayResult()
      textAreaRef.value.scrollTop = textAreaRef.value.scrollHeight
    }

    // prepare wav buffer
    const buf = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; ++i) {
      let s = samples[i] ?? 0
      if (s >= 1)
        s = 1
      else if (s <= -1)
        s = -1
      buf[i] = s * 32767
    }
    leftchannel.push(buf)
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
    setupRecorder(new AudioContext({ sampleRate: expectedSampleRate }), stream)
}

async function startRecording() {
  await requestMicrophone()

  if (!mediaStreamSource || !recorderNode || !audioCtx)
    return
  mediaStreamSource.connect(recorderNode)
  recorderNode.connect(audioCtx.destination)
}

function stopRecording() {
  if (recorderNode && mediaStreamSource && audioCtx) {
    try {
      recorderNode.disconnect(audioCtx.destination)
      mediaStreamSource.disconnect(recorderNode)
    }
    catch {
      // ignore if already disconnected
    }

    const clipName = new Date().toISOString()
    const samples = flatten(leftchannel)
    const blob = toWav(samples)
    leftchannel = []
    const audioURL = window.URL.createObjectURL(blob)
    recordings.value.push({ name: clipName, url: audioURL })
  }
}

function removeRecording(idx: number) {
  const r = recordings.value[idx]
  if (r) {
    URL.revokeObjectURL(r.url)
    recordings.value.splice(idx, 1)
  }
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
    p-4 max-w-2xl mx-auto font-sans
    flex="~ col items-start gap-4"
  >
    <Card>
      <template #title>
        Model
      </template>

      <div
        ref="metadataDropZone"
        b="b-1 dashed dark-300/20"
        flex="~ col items-center gap-2"
        w-full
        p-4
      >
        <div font-bold uppercase>
          (Metadata)
        </div>

        <textarea
          v-if="metadata"
          v-model="metadataStringified"
          readonly
          w-full overflow-auto font-mono
          p-3
          outline-none
          b="2 neutral/50"
          text-sm
          h-96
        />

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
        p-4
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
        Initialize ASR
      </Button>
    </Card>

    <Card>
      <template #title>
        Transcription
      </template>

      <div flex="~ col gap-2 items-start">
        <Button
          @click="startRecording()"
        >
          Start
        </Button>
      </div>
    </Card>

    <!-- Transcription Results Section -->
    <section class="section">
      <div class="section-header">
        <Label for="transcription-output" class="section-label">
          Transcription Results
        </Label>
      </div>
      <textarea
        id="transcription-output"
        ref="textAreaRef"
        :value="getDisplayResult()"
        class="transcription-output"
        rows="8"
        readonly
      />
    </section>

    <Separator class="separator" />

    <!-- Recordings List Section -->
    <section class="section">
      <div class="section-header">
        <Label class="section-label">Previous Audio Slices</Label>
        <span class="recordings-count">{{ recordings.length }} recording(s)</span>
      </div>
      <div v-if="recordings.length === 0" class="empty-state">
        No recordings yet. Start and stop recording to create audio slices.
      </div>
      <ul v-else class="recordings-list">
        <li v-for="(r, idx) in recordings" :key="r.url" class="recording-item">
          <div class="recording-content">
            <audio :src="r.url" controls class="audio-player" />
            <div class="recording-info">
              <span class="recording-name">{{ r.name }}</span>
              <button class="btn btn-delete" @click="removeRecording(idx)">
                Delete
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
