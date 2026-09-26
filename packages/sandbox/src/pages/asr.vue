<script setup lang="ts">
import type { AudioProcessorMessage } from '../audio-processor.protocol'
import type { ModelBackend } from '../features/asr-models/catalog'
import type { LiveBackend, LiveRecognizer } from '../features/webgpu-experiment/live-asr'
import type { RealtimeEvent, RealtimeSnapshot } from '../features/webgpu-experiment/realtime-metrics'
import { createOnlineRecognizer } from '@sherpaw/asr'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import audioProcessor from '../audio-processor.worklet?worker&url'
import Button from '../components/Button.vue'
import ModelSetup from '../components/ModelSetup.vue'
import { asrModels } from '../features/asr-models/catalog'
import { RealtimeMetrics } from '../features/webgpu-experiment/realtime-metrics'
import { provideASRStore } from '../store'

const { asrModule } = provideASRStore()
const backend = ref<LiveBackend | ModelBackend | 'custom'>('cpu')
const model = ref('paraformer')
const selectedModel = computed(() => asrModels.find(entry => entry.id === model.value))
const modelLoaded = ref(false)
const phase = ref<'idle' | 'loading' | 'recording' | 'stopping'>('idle')
const status = ref('Ready · built-in Paraformer zh-en')
const error = ref('')
const transcript = ref('')
const backlog = ref(0)
const measurement = ref<RealtimeSnapshot>()
let metrics = new RealtimeMetrics()
let pendingEndTime = 0
let lastCapturePublish = 0
let closed = false
let engine: LiveRecognizer | undefined
let audioCtx: AudioContext | undefined
let microphone: MediaStream | undefined
let source: MediaStreamAudioSourceNode | undefined
let worklet: AudioWorkletNode | undefined
let pending: Float32Array[] = []
let pendingSize = 0
let processing: Promise<void> | undefined

/** Triggering workflow: pump/Stop -> realtime snapshot -> sandbox display and fakemic timeline collector. */
function publishMetrics(kind: RealtimeEvent['kind'] = 'progress') {
  measurement.value = metrics.snapshot(performance.now(), engine?.stats?.().gpuDispatches ?? measurement.value?.gpuDispatches ?? 0)
  window.dispatchEvent(new CustomEvent<RealtimeEvent>('sherpaw:asr-realtime', {
    detail: { kind, backend: backend.value, model: model.value, snapshot: measurement.value, text: transcript.value },
  }))
}

function disconnectMicrophone() {
  if (worklet)
    worklet.port.onmessage = null
  source?.disconnect()
  worklet?.disconnect()
  microphone?.getTracks().forEach(track => track.stop())
  microphone = undefined
  source = undefined
  worklet = undefined
}

async function release() {
  disconnectMicrophone()
  const current = engine
  engine = undefined
  modelLoaded.value = false
  await current?.dispose()
  await audioCtx?.close()
  audioCtx = undefined
}

/** Triggering workflow: model/backend selector change -> release loaded worker -> next Load/Start uses the new selection. */
watch([model, backend], async ([currentModel], [previousModel]) => {
  if (phase.value !== 'idle')
    return
  phase.value = 'loading'
  try {
    await release()
    if (currentModel !== previousModel)
      backend.value = 'cpu'
    error.value = ''
    status.value = `Ready to load · ${selectedModel.value?.label ?? 'Paraformer zh-en'}`
  }
  finally { phase.value = 'idle' }
})

/** Triggering workflow: Load model or Start -> selected model/backend -> initialized recognizer without opening the microphone. */
async function ensureModel() {
  if (engine)
    return
  if (model.value !== 'paraformer') {
    const { createModelRecognizer } = await import('../features/asr-models/recognizer')
    engine = await createModelRecognizer(model.value, message => status.value = message, backend.value === 'webgpu-encoder' ? 'webgpu-encoder' : 'cpu')
  }
  else if (backend.value === 'custom') {
    engine = createCustomRecognizer()
    status.value = 'CPU / WASM · custom model'
  }
  else {
    const { createLiveRecognizer } = await import('../features/webgpu-experiment/live-asr')
    if (backend.value === 'webgpu-encoder')
      throw new Error('WebGPU encoder backend requires X-ASR FP32')
    engine = await createLiveRecognizer(backend.value, message => status.value = message)
  }
  modelLoaded.value = true
}

/** Triggering workflow: Load model click -> ensureModel -> ready status, with microphone still closed. */
async function loadModel() {
  if (phase.value !== 'idle')
    return
  phase.value = 'loading'
  error.value = ''
  try {
    await ensureModel()
    if (closed)
      await release()
  }
  catch (cause) {
    error.value = String(cause)
    await release()
  }
  finally { phase.value = 'idle' }
}

function createCustomRecognizer(): LiveRecognizer {
  if (!asrModule.value)
    throw new Error('Load and initialize your model in Model setup first.')
  const recognizer = createOnlineRecognizer(asrModule.value)
  const stream = recognizer.createStream()
  const completed: string[] = []
  function decode() {
    while (recognizer.isReady(stream)) recognizer.decode(stream)
    const text = recognizer.getResult(stream).text
    const result = [...completed, text].join(' ')
    if (recognizer.isEndpoint(stream)) {
      if (text)
        completed.push(text)
      recognizer.reset(stream)
    }
    return result
  }
  return {
    async accept(samples) {
      stream.acceptWaveform(16000, samples)
      return decode()
    },
    async finish() {
      stream.setOption('is_final', '1')
      stream.inputFinished()
      return decode()
    },
    async dispose() {
      stream.free()
      recognizer.free()
    },
  }
}

/** Triggering workflow: AudioWorklet data -> pending PCM -> serialized engine.accept -> live transcript. */
function pump() {
  if (processing)
    return processing
  processing = (async () => {
    // Never enter Sherpa while an Asyncify inference call is suspended.
    while (pendingSize) {
      if (!engine)
        break
      const audioEnd = pendingEndTime
      const samples = new Float32Array(pendingSize)
      let offset = 0
      for (const chunk of pending) {
        samples.set(chunk, offset)
        offset += chunk.length
      }
      pending = []
      pendingSize = 0
      backlog.value = 0
      const chunksBefore = engine.stats?.().decodedChunks ?? 0
      const started = performance.now()
      transcript.value = await engine.accept(samples)
      metrics.complete(samples.length, audioEnd, audioCtx!.currentTime, performance.now() - started, (engine.stats?.().decodedChunks ?? 0) > chunksBefore, transcript.value, performance.now())
      publishMetrics()
    }
  })().catch(async (cause) => {
    error.value = String(cause)
    pending = []
    pendingSize = 0
    backlog.value = 0
    await release()
    phase.value = 'idle'
  }).finally(() => { processing = undefined })
  return processing
}

/** Triggering workflow: worklet.port message -> validate PCM/backlog -> pump -> selected inference backend. */
function receiveAudio(event: MessageEvent<AudioProcessorMessage>) {
  if (phase.value !== 'recording' || event.data.type !== 'data')
    return
  const message = event.data
  if (message.sampleRate !== 16000 || pendingSize > 16000 * 10) {
    error.value = message.sampleRate !== 16000 ? 'Unexpected microphone sample rate.' : 'Inference is falling behind by more than 10 seconds. Try a smaller model or a faster backend.'
    void stopRecording()
    return
  }
  const samples = new Float32Array(message.data)
  metrics.receive(samples.length, message.audioEndTime, audioCtx!.currentTime, performance.now())
  pendingEndTime = message.audioEndTime
  pending.push(samples)
  pendingSize += samples.length
  backlog.value = pendingSize / 16000
  // Slow worker inference must not hide ongoing microphone capture from the
  // display or the fakemic stop condition. Publish at most ten times/second.
  if (processing && message.audioEndTime - lastCapturePublish >= 0.1) {
    lastCapturePublish = message.audioEndTime
    publishMetrics()
  }
  if (pendingSize >= 1600)
    void pump()
}

/** Triggering workflow: Start click -> chosen backend and microphone -> AudioWorklet -> receiveAudio. */
async function startRecording() {
  if (phase.value !== 'idle')
    return
  phase.value = 'loading'
  error.value = ''
  transcript.value = ''
  metrics = new RealtimeMetrics()
  measurement.value = undefined
  pendingEndTime = 0
  lastCapturePublish = 0
  pending = []
  pendingSize = 0
  try {
    audioCtx = new AudioContext({ sampleRate: 16000 })
    await audioCtx.resume()
    await ensureModel()
    if (closed) {
      await release()
      return
    }
    microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (closed) {
      await release()
      return
    }
    await audioCtx.audioWorklet.addModule(audioProcessor)
    if (closed) {
      await release()
      return
    }
    source = audioCtx.createMediaStreamSource(microphone)
    worklet = new AudioWorkletNode(audioCtx, 'audio-processor')
    worklet.port.onmessage = receiveAudio
    /** Triggering workflow: AudioWorklet processor error -> visible error -> stopRecording and cleanup. */
    worklet.onprocessorerror = () => {
      error.value = 'Microphone audio processing failed.'
      void stopRecording()
    }
    phase.value = 'recording'
    source.connect(worklet)
    worklet.connect(audioCtx.destination)
  }
  catch (cause) {
    error.value = String(cause)
    await release()
    phase.value = 'idle'
  }
}

/** Triggering workflow: Stop click/audio error -> stop microphone -> drain queue -> final text -> release sessions. */
async function stopRecording() {
  if (phase.value !== 'recording')
    return
  phase.value = 'stopping'
  const stopStarted = performance.now()
  disconnectMicrophone()
  try {
    await pump()
    if (engine)
      transcript.value = await engine.finish()
  }
  catch (cause) { error.value = String(cause) }
  finally {
    metrics.finish(performance.now() - stopStarted, transcript.value, performance.now())
    publishMetrics('stopped')
    await release()
    phase.value = 'idle'
    backlog.value = 0
  }
}

/** Triggering workflow: route unmount -> mark initialization cancelled -> stop recording and release microphone/session resources. */
onBeforeUnmount(() => {
  closed = true
  if (phase.value === 'recording')
    void stopRecording()
  else if (phase.value === 'idle')
    void release()
  // Initialization checks closed after each awaited resource acquisition.
})
</script>

<template>
  <main min-h-dvh w-full font-sans flex="~ col items-center" p-6 gap-6>
    <header w-full flex="~ row items-center justify-between">
      <div>
        <RouterLink to="/" text-sm underline>
          Sherpaw
        </RouterLink>
        <h1 text-3xl font-black>
          ASR Sandbox
        </h1>
      </div>
      <PopoverRoot v-if="backend === 'custom' && phase === 'idle'">
        <PopoverTrigger rounded-xl p-3 bg-neutral-100>
          Model setup
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent side="bottom" rounded-lg bg-white shadow-sm b m-4 class="w-[460px] max-w-[90vw]">
            <ModelSetup />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
    </header>

    <section w-full max-w-2xl rounded-xl b b-neutral-200 p-4 flex="~ col gap-3">
      <label for="asr-model" font-semibold>ASR model</label>
      <select id="asr-model" v-model="model" :disabled="phase !== 'idle'" b rounded-lg p-2 bg-white>
        <option value="paraformer">
          Paraformer zh-en (baseline)
        </option>
        <option v-for="entry in asrModels" :key="entry.id" :value="entry.id">
          {{ entry.label }}
        </option>
      </select>
      <p v-if="selectedModel" text-sm>
        Model weights: {{ Math.round(selectedModel.modelBytes / 1e6) }} MB.
        Streaming: text appears while you speak.
        {{ model === 'x-asr-fp32' ? 'CPU / WASM or experimental WebGPU encoder.' : 'CPU / WASM inference.' }}
      </p>
      <label for="asr-backend" font-semibold>Inference backend</label>
      <select id="asr-backend" v-model="backend" :disabled="phase !== 'idle'" b rounded-lg p-2 bg-white>
        <option value="cpu">
          CPU / WASM{{ model === 'paraformer' ? ' — Paraformer zh-en' : '' }}
        </option>
        <option v-if="model === 'x-asr-fp32'" value="webgpu-encoder">
          WebGPU — FP32 encoder, CPU decoder/joiner (experimental)
        </option>
        <option v-if="model === 'paraformer'" value="webgpu-fp32">
          WebGPU — FP32 encoder + decoder (experimental)
        </option>
        <option v-if="model === 'paraformer'" value="webgpu">
          WebGPU — encoder + decoder (experimental)
        </option>
        <option v-if="model === 'paraformer'" value="webgpu-decoder">
          WebGPU — decoder only (experimental)
        </option>
        <option v-if="model === 'paraformer'" value="custom">
          CPU / WASM — custom model
        </option>
      </select>
      <p v-if="backend !== 'custom'" text-sm>
        Load the selected model first, or press Start to load it and open the microphone.
      </p>
      <Button v-if="phase === 'idle' && !modelLoaded && backend !== 'custom'" @click="loadModel">
        Load model
      </Button>
      <p v-if="backend === 'webgpu' || backend === 'webgpu-decoder'" text-sm text-amber-800>
        Experimental: WebGPU is currently slower for this model. The GPU encoder can change recognition results; decoder-only mode matched the tested recordings. Some operators still run on CPU.
      </p>
      <p v-if="backend === 'webgpu-fp32'" text-sm text-amber-800>
        Experimental FP32: faster on the tested Mac, with about 865 MB of model weights. Results can differ from the int8 model.
      </p>
      <p role="status" text-sm>
        {{ phase === 'idle' && transcript ? 'Last session · ' : '' }}{{ status }}
      </p>
      <dl v-if="measurement" text-sm grid="~ cols-2 gap-2" aria-label="Realtime metrics">
        <dt>Audio processed</dt><dd>{{ measurement.processedAudioSeconds.toFixed(1) }} s</dd>
        <dt>First text (includes leading silence)</dt><dd>{{ measurement.firstTextMs === null ? 'Waiting…' : `${Math.round(measurement.firstTextMs)} ms` }}</dd>
        <dt>Processing delay p95</dt><dd>{{ Math.round(measurement.audioEndToCompletionP95Ms) }} ms</dd>
        <dt>Peak unprocessed audio</dt><dd>{{ measurement.maxOutstandingSeconds.toFixed(2) }} s</dd>
      </dl>
      <p v-if="measurement" text-xs>
        Processing delay measures audio-batch completion, not word-by-word latency.
      </p>
      <p v-if="error" role="alert" text-red-700>
        {{ error }}
      </p>
    </section>

    <section w-full max-w-3xl flex="~ col items-center gap-6" py-8>
      <div aria-label="Transcription" aria-live="polite" text-3xl text-center break-words w-full min-h-32>
        {{ transcript }}
      </div>
      <p v-if="phase === 'recording'" text-sm>
        Listening… <span v-if="backlog > 1">({{ backlog.toFixed(1) }} s pending)</span>
      </p>
      <Button v-if="phase === 'idle'" @click="startRecording">
        Start
      </Button>
      <Button v-else-if="phase === 'recording'" @click="stopRecording">
        Stop transcription
      </Button>
      <p v-else>
        {{ phase === 'loading' ? 'Loading model…' : 'Finishing transcription…' }}
      </p>
    </section>
  </main>
</template>
