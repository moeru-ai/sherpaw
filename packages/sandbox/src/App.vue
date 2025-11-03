<script setup lang="ts">
import { createOnlineRecognizer, initASRModule } from '@sherpa-onnx-wasm/asr'
import wasmUrl from '@sherpa-onnx-wasm/asr/module.wasm?url'
import { loadData } from '@sherpa-onnx-wasm/preloader'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import metadata from './assets/metadata/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.json'

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

async function initASR() {
  // Initialize the WASM module and await the returned Module instance.
  // Use the resolved module object directly instead of relying on `this` in
  // the onRuntimeInitialized callback to avoid binding/race issues.
  const asrModule = await initASRModule({
    locateFile() {
      return wasmUrl
    },
    onRuntimeInitialized() {
      console.warn('ASR runtime initialized', this)
    },
  })

  const res = await fetch('/data/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.data')
  const data = await res.arrayBuffer()

  loadData(asrModule, metadata, data, 'streaming-zipformer-bilingual-zh-en-2023-02-20')

  // Create recognizer using the resolved module instance
  recognizerRef.value = createOnlineRecognizer(asrModule)
  console.warn('Recognizer created')
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

function startRecording() {
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

onMounted(async () => {
  await initASR()
  await requestMicrophone()
})

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
  <section class="recorder">
    <div style="display:flex; gap:8px; margin: 1rem 0;">
      <button @click="startRecording">
        Start
      </button>
      <button @click="stopRecording">
        Stop
      </button>
    </div>

    <textarea ref="textAreaRef" :value="getDisplayResult()" rows="6" style="width:100%" readonly />

    <h3>Recordings</h3>
    <ul>
      <li v-for="(r, idx) in recordings" :key="r.url" style="margin-bottom:0.5rem;">
        <audio :src="r.url" controls />
        <div style="display:inline-block; margin-left:8px; vertical-align:middle;">
          <div>{{ r.name }}</div>
          <button @click="removeRecording(idx)">
            Delete
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
