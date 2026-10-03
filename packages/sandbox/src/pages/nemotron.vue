<!-- cspell:ignore Nemotron nemotron -->
<script setup lang="ts">
import type { Recognizer } from '../features/asr/protocol'
import type { NemotronClient } from '../features/nemotron/client'
import type { ProfileName, ProfileSpeed } from '../features/nemotron/stream'
import type { NemotronTurn } from '../features/nemotron/turns'

import { createTokenTimeline } from '@sherpaw/asr/tokens'
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import Button from '../components/Button.vue'
import SandboxLayout from '../components/SandboxLayout.vue'
import SelectField from '../components/SelectField.vue'
import { asrModels } from '../features/asr/catalog'
import { createRecognizer } from '../features/asr/recognizer'
import { startMicrophone } from '../features/audio/microphone'
import { createNemotronClient } from '../features/nemotron/client'
import { profiles, recommendProfile, SPEAKERS } from '../features/nemotron/stream'
import { activeSpeakers, turnsOf } from '../features/nemotron/turns'

interface Row extends NemotronTurn {
  words: string
}

const sampleRate = 16000
const blockSize = sampleRate / 10
/** The rows update at most this often. Each update reads every frame and token so far, so its cost grows with the session. */
const rowsIntervalMs = 200
const colors = ['#2f6f9f', '#c2410c', '#15803d', '#7e22ce', '#b45309', '#0e7490', '#be123c', '#4d7c0f']
const transcriptOptions = [
  ...asrModels.filter(model => model.id !== 'x-asr-fp32').map(model => ({ value: model.id, label: `${model.label} · ${Math.round(model.modelBytes / 1e6)} MB` })),
  { value: 'none', label: 'No transcripts' },
]
const latencyNames: Record<ProfileName, string> = { low: 'Low', veryLow: 'Very low' }

const audioFile = useTemplateRef<HTMLInputElement>('audioFile')
const transcriptModel = ref('x-asr')
const latency = ref<ProfileName>('low')
const speeds = ref<ProfileSpeed[]>([])
const ready = ref(false)
const listening = ref(false)
const busy = ref('')
const error = ref('')
const message = ref('Choose the models and select Initialize.')
const probabilities = ref(new Float32Array(0))
const rows = ref<Row[]>([])
const audioSamples = ref(0)
/** Samples that the recognizer has heard in this session. */
const heardSamples = ref(0)
const computeMs = ref(0)
/** `performance.now()`, refreshed while the microphone runs. */
const now = ref(0)
/** `performance.now()` when the microphone captured the session's first sample. A ref, so that `behind` updates once it is known. */
const microphoneOrigin = ref<number>()
let computeBaseMs = 0
/** `?profile` in the address: the worker logs its step times to the console. */
const profiling = new URLSearchParams(location.search).has('profile')

let diarizer: NemotronClient | undefined
let recognizer: Recognizer | undefined
let timeline: ReturnType<typeof createTokenTimeline> | undefined
let microphone: AbortController | undefined
let diarizerQueue = Promise.resolve()
let recognizerQueue = Promise.resolve()
let disposed = false
let latencyChanged = false
let rowsTimer: ReturnType<typeof setTimeout> | undefined
let clock: ReturnType<typeof setInterval> | undefined
/** The profile of the running stream. */
let startedProfile: ProfileName = 'low'
/** The diarizer decided the rest of the audio: more audio needs a new session. */
let flushed = false

const frames = computed(() => probabilities.value.length / SPEAKERS)
const active = computed(() => activeSpeakers(probabilities.value, frames.value, 0.5))
const audioSeconds = computed(() => audioSamples.value / sampleRate)
const realTimeFactor = computed(() => audioSeconds.value ? computeMs.value / 1000 / audioSeconds.value : 0)
/** The stream decides each frame at most this long after its audio. */
const modelLatency = computed(() => (profiles[startedProfile].chunk + profiles[startedProfile].right) * 0.08)
/** While the microphone runs: how far each stage is behind the captured audio, in seconds. */
const behind = computed(() => {
  if (!listening.value || microphoneOrigin.value === undefined)
    return undefined

  const captured = (now.value - microphoneOrigin.value) / 1000

  return {
    input: captured - audioSeconds.value,
    speakers: captured - frames.value / 100,
    words: recognizer ? captured - heardSamples.value / sampleRate : undefined,
  }
})
// Lags beyond these limits keep growing when a stage cannot keep up.
const lagging = computed(() => !!behind.value && (behind.value.input > 0.5 || behind.value.speakers > modelLatency.value + 1 || (behind.value.words ?? 0) > 1))
const latencyOptions = computed(() => (Object.keys(latencyNames) as ProfileName[]).map((profile) => {
  const speed = speeds.value.find(value => value.profile === profile)
  const label = `${latencyNames[profile]} · ${((profiles[profile].chunk + profiles[profile].right) * 0.08).toFixed(2)} s`

  return { value: profile, label: speed ? `${label} · RTF ${speed.realTimeFactor.toFixed(2)}` : label }
}))

function reportError(cause: unknown) {
  if (!disposed)
    error.value = cause instanceof Error ? cause.message : String(cause)
}

function markLatencyChanged() {
  latencyChanged = true
}

function time(seconds: number) {
  const minutes = Math.floor(seconds / 60)

  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`
}

function updateRows() {
  clearTimeout(rowsTimer)
  rowsTimer = undefined

  const started = performance.now()
  const turns = turnsOf(probabilities.value, frames.value)
  const words = timeline && recognizer
    ? timeline.place(recognizer.tokens(), turns.map(turn => Math.round(turn.start * sampleRate))).rows
    : []

  rows.value = turns.map((turn, index) => ({ ...turn, words: words[index] ?? '' }))

  if (profiling)
    performance.measure('nemotron:rows', { start: started, end: performance.now() })
}

function scheduleRows() {
  rowsTimer ??= setTimeout(updateRows, rowsIntervalMs)
}

async function createTranscript() {
  await recognizer?.dispose()
  recognizer = undefined
  timeline = undefined

  if (transcriptModel.value !== 'none') {
    recognizer = await createRecognizer({ modelId: transcriptModel.value, backend: 'cpu' }, status => message.value = status)
    timeline = createTokenTimeline(sampleRate, 0.2)
  }
}

async function initialize() {
  busy.value = 'load'
  error.value = ''

  try {
    message.value = 'Loading models…'

    if (!diarizer) {
      const [client] = await Promise.all([
        createNemotronClient({ profiling }),
        createTranscript(),
      ])

      diarizer = client
      speeds.value = await diarizer.benchmark()

      if (!latencyChanged)
        latency.value = recommendProfile(speeds.value) ?? 'low'
    }
    else {
      await createTranscript()
    }

    await diarizer.start(latency.value)
    startedProfile = latency.value
    ready.value = true
    computeBaseMs = 0
    probabilities.value = new Float32Array(0)
    rows.value = []
    audioSamples.value = 0
    heardSamples.value = 0
    computeMs.value = 0
    const recommended = recommendProfile(speeds.value)
    const fastest = speeds.value.reduce<ProfileSpeed | undefined>((best, speed) => !best || speed.realTimeFactor < best.realTimeFactor ? speed : best, undefined)

    message.value = recommended
      ? `Models ready. Recommended: ${latencyNames[recommended]}. Start the microphone or test an audio file.`
      : `This device may not keep up in real time. Fastest: RTF ${fastest?.realTimeFactor.toFixed(2) ?? '-'}.`
  }
  catch (cause) {
    reportError(cause)
    message.value = 'Could not load the models. Try again.'
    // A failed worker cannot take more requests: the next try loads the model again.
    await diarizer?.dispose().catch(() => {})
    diarizer = undefined
    ready.value = false
  }
  finally { busy.value = '' }
}

/** Adds an audio block to both model queues. */
function feed(block: Float32Array) {
  if (!diarizer)
    return

  const blockStartSample = audioSamples.value
  audioSamples.value += block.length
  diarizerQueue = diarizerQueue.then(async () => {
    const decided = await diarizer!.push(block)

    computeMs.value = diarizer!.computeMs - computeBaseMs

    // Most blocks decide no frame: the model steps once per chunk.
    if (!decided.length)
      return

    const all = new Float32Array(probabilities.value.length + decided.length)

    all.set(probabilities.value)
    all.set(decided, probabilities.value.length)
    probabilities.value = all
    scheduleRows()
  }).catch(reportError)

  if (recognizer && timeline) {
    const currentRecognizer = recognizer
    const currentTimeline = timeline

    recognizerQueue = recognizerQueue.then(async () => {
      await currentRecognizer.accept(block)
      currentTimeline.hear(blockStartSample, currentRecognizer.received() - block.length, block.length)
      heardSamples.value += block.length
      scheduleRows()
    }).catch(reportError)
  }
}

async function flush() {
  flushed = true
  diarizerQueue = diarizerQueue.then(async () => {
    const decided = await diarizer!.flush()
    const all = new Float32Array(probabilities.value.length + decided.length)

    all.set(probabilities.value)
    all.set(decided, probabilities.value.length)
    probabilities.value = all
    computeMs.value = diarizer!.computeMs - computeBaseMs
    updateRows()
  }).catch(reportError)
  await diarizerQueue
  await recognizerQueue
  updateRows()
}

function stopMicrophone() {
  microphone?.abort()
  microphone = undefined
  clearInterval(clock)
  listening.value = false
  message.value = 'Microphone stopped. Processing the final audio.'
  void flush().then(() => message.value = 'Microphone stopped.')
}

async function listen() {
  busy.value = 'start'
  error.value = ''

  if (flushed)
    await newSession()

  const controller = new AbortController()
  microphone = controller
  microphoneOrigin.value = undefined
  listening.value = true
  clock = setInterval(() => now.value = performance.now(), 250)
  let block = new Float32Array(blockSize)
  let offset = 0

  try {
    await startMicrophone(controller.signal, (samples, rate) => {
      if (rate !== sampleRate)
        return

      microphoneOrigin.value ??= performance.now() - samples.length / rate * 1000

      for (const value of samples) {
        block[offset++] = Math.max(-1, Math.min(1, value))

        if (offset === block.length) {
          feed(block)
          block = new Float32Array(block.length)
          offset = 0
        }
      }
    }, { sampleRate })
    message.value = 'Listening. Speaker labels arrive after the selected latency.'
  }
  catch (cause) {
    if (!controller.signal.aborted) {
      listening.value = false
      clearInterval(clock)
      reportError(cause)
    }
  }
  finally { busy.value = '' }
}

async function newSession() {
  if (!diarizer)
    return

  await diarizerQueue
  await recognizerQueue
  await diarizer.reset()
  computeBaseMs = diarizer.computeMs
  await createTranscript()
  probabilities.value = new Float32Array(0)
  rows.value = []
  audioSamples.value = 0
  heardSamples.value = 0
  computeMs.value = 0
  diarizerQueue = Promise.resolve()
  recognizerQueue = Promise.resolve()
  flushed = false
}

async function testFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (!file)
    return

  busy.value = 'file'
  error.value = ''
  const context = new AudioContext({ sampleRate })

  try {
    message.value = `Reading ${file.name}…`
    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    const samples = new Float32Array(decoded.length)

    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel)

      for (let index = 0; index < values.length; index++)
        samples[index] = samples[index]! + values[index]! / decoded.numberOfChannels
    }

    await newSession()
    message.value = `Processing ${file.name}…`

    for (let offset = 0; offset < samples.length; offset += blockSize)
      feed(samples.subarray(offset, offset + blockSize).map(value => Math.max(-1, Math.min(1, value))))

    await flush()
    message.value = `${file.name}: ${rows.value.length} turns.`
  }
  catch (cause) {
    reportError(cause)
    message.value = 'Could not process this audio file. Try another format.'
  }
  finally {
    if (context.state !== 'closed')
      await context.close()

    busy.value = ''
  }
}

async function dispose() {
  disposed = true
  microphone?.abort()
  clearInterval(clock)
  clearTimeout(rowsTimer)
  await Promise.all([diarizer?.dispose(), recognizer?.dispose()])
}

onBeforeUnmount(() => void dispose())
</script>

<template>
  <SandboxLayout title="Nemotron diarization">
    <template #setup>
      <div flex="~ wrap items-end justify-center gap-3">
        <SelectField v-model="transcriptModel" label="Transcripts" :options="transcriptOptions" :disabled="!!busy || listening" />
        <SelectField v-model="latency" label="Latency" :options="latencyOptions" :disabled="!!busy || listening" @update:model-value="markLatencyChanged" />
        <Button :disabled="!!busy || listening" @click="initialize">
          {{ busy === 'load' ? 'Initializing…' : 'Initialize' }}
        </Button>
      </div>
    </template>

    <main w-full max-w-5xl grow p-4 flex="~ col gap-4">
      <p max-w-3xl text-sm text-neutral-600>
        This experiment needs hardware WebGPU and downloads a 104 MB model. It decides speakers about 1 s after audio, or 0.64 s with very low latency.
      </p>
      <div flex="~ wrap items-center gap-3">
        <Button v-if="!listening" :disabled="!ready || !!busy" @click="listen">
          Start microphone
        </Button>
        <Button v-else @click="stopMicrophone">
          Stop microphone
        </Button>
        <Button :disabled="!ready || !!busy || listening" @click="audioFile?.click()">
          Test audio file
        </Button>
        <Button :disabled="!ready || !!busy || listening" @click="newSession">
          New session
        </Button>
        <input ref="audioFile" type="file" hidden accept="audio/*" aria-label="Test audio file" :disabled="!ready || !!busy || listening" @change="testFile">
      </div>
      <p role="status" text-sm text-neutral-500>
        {{ message }}
      </p>
      <p v-if="error" role="alert" text-sm text-red-600>
        {{ error }}
      </p>
      <section aria-label="Diarization status" rounded-lg bg-neutral-100 p-3 text-sm flex="~ wrap gap-x-5 gap-y-1">
        <span>Active now: {{ active.length ? active.map(speaker => `Speaker ${speaker + 1}`).join(', ') : 'None' }}</span>
        <span>{{ audioSeconds.toFixed(1) }} s audio</span>
        <span>{{ computeMs.toFixed(0) }} ms model compute</span>
        <span>{{ realTimeFactor.toFixed(2) }} real-time factor</span>
        <span v-if="profiling">Profiling: step times in the console</span>
        <span v-if="behind" :class="lagging ? 'text-red-600' : ''">
          Behind real time: input {{ behind.input.toFixed(1) }} s · speakers {{ behind.speakers.toFixed(1) }} s (the model adds up to {{ modelLatency.toFixed(2) }} s)<template v-if="behind.words !== undefined"> · words {{ behind.words.toFixed(1) }} s</template>
        </span>
      </section>
      <section aria-label="Speaker turns" grow>
        <p v-if="!rows.length" text-sm text-neutral-500>
          No decided speaker turns yet.
        </p>
        <ol v-else flex="~ col gap-2">
          <li v-for="(row, index) in rows" :key="`${row.start}-${row.speaker}`" rounded-lg border border-neutral-200 px-3 py-2>
            <div flex="~ wrap items-baseline gap-x-3 gap-y-1">
              <span font-semibold :style="{ color: colors[row.speaker % colors.length] }">Speaker {{ row.speaker + 1 }}</span>
              <span text-xs text-neutral-500 tabular-nums>{{ time(row.start) }}</span>
              <span text-xs text-neutral-500 tabular-nums>{{ (row.end - row.start).toFixed(1) }} s</span>
              <span v-if="row.overlapSeconds >= 0.3" text-xs text-neutral-500>overlap {{ row.overlapSeconds.toFixed(1) }} s</span>
              <span v-if="index === rows.length - 1 && listening" text-xs text-neutral-500>in progress</span>
              <p grow min-w-40>
                {{ row.words || (transcriptModel === 'none' ? '' : '…') }}
              </p>
            </div>
          </li>
        </ol>
      </section>
    </main>
  </SandboxLayout>
</template>
