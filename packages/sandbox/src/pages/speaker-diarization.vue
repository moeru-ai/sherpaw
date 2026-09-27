<script setup lang="ts">
import type { Clustering, Diarizer, SpeakerSegment } from '@sherpaw/speaker-diarization'

import { createDiarizer } from '@sherpaw/speaker-diarization'
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'

import Button from '../components/Button.vue'
import ModelSetupPopover from '../components/ModelSetupPopover.vue'
import SandboxLayout from '../components/SandboxLayout.vue'
import { loadDiarizationModel } from '../features/speaker-diarization/models'

const colors = ['#2f6f9f', '#c2410c', '#15803d', '#7e22ce', '#b45309', '#0e7490', '#be123c', '#4d7c0f']

const audioFile = useTemplateRef<HTMLInputElement>('audioFile')
const player = useTemplateRef<HTMLAudioElement>('player')

const ready = ref(false)
const busy = ref('')
const error = ref('')
const message = ref('Initialize the models, then choose a recording.')

const mode = ref<'count' | 'threshold'>('count')
const numSpeakers = ref('2')
const distanceThreshold = ref('0.6')

const fileName = ref('')
const audioUrl = ref('')
const duration = ref(0)
const segments = ref<SpeakerSegment[]>([])

let recording: Float32Array | undefined
let disposed = false
let generation = 0

const lifetime = new AbortController()
let diarizer: Diarizer | undefined

const speakers = computed(() => [...new Set(segments.value.map(segment => segment.speaker))].sort((a, b) => a - b))

function color(speaker: number) {
  return colors[speaker % colors.length]
}

function time(seconds: number) {
  const minutes = Math.floor(seconds / 60)

  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`
}

function clustering(): Clustering {
  return mode.value === 'count' ? { numSpeakers: Number(numSpeakers.value) } : { distanceThreshold: Number(distanceThreshold.value) }
}

function reportError(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : String(cause)
}

/** Triggering workflow: speaker-diarization.vue initialize button `click` -> {@link loadModel} -> createDiarizer -> model status. */
async function loadModel() {
  busy.value = 'load'
  error.value = ''

  try {
    message.value = 'Loading models…'

    const model = await loadDiarizationModel()

    lifetime.signal.throwIfAborted()
    message.value = 'Initializing speaker diarizer…'
    diarizer = await createDiarizer({ model, clustering: clustering(), signal: lifetime.signal })
    ready.value = true
    message.value = recording ? 'Models ready. Analyze the recording.' : 'Models ready. Choose a recording.'
  }
  catch (cause) {
    if (disposed)
      return

    reportError(cause)
    message.value = 'Could not load the models. Try again.'
  }
  finally {
    busy.value = ''
  }
}

/** Triggering workflow: speaker-diarization.vue analyze button `click` / {@link chooseFile} -> {@link analyze} -> diarizer.diarize -> timeline and segment list. */
async function analyze() {
  if (!diarizer || !recording)
    return

  busy.value = 'analyze'
  error.value = ''

  const current = ++generation
  const started = performance.now()

  try {
    message.value = `Analyzing ${fileName.value}…`

    const result = await diarizer.diarize(recording, diarizer.sampleRate, clustering())

    if (disposed || current !== generation)
      return

    segments.value = result
    message.value = `${fileName.value} complete in ${((performance.now() - started) / 1000).toFixed(1)} s. Change the clustering to analyze again.`
  }
  catch (cause) {
    if (disposed || current !== generation)
      return

    reportError(cause)
    message.value = 'Could not analyze this recording. Check the clustering settings and try again.'
  }
  finally {
    if (current === generation)
      busy.value = ''
  }
}

/** Triggering workflow: speaker-diarization.vue audio file input `change` -> {@link chooseFile} -> decodeAudioData -> {@link analyze}. */
async function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  input.value = ''

  if (!file || !diarizer)
    return

  busy.value = 'file'
  error.value = ''
  segments.value = []

  // decodeAudioData resamples to the context rate, which the segmentation model fixes.
  const context = new AudioContext({ sampleRate: diarizer.sampleRate })

  try {
    message.value = `Reading ${file.name}…`

    const decoded = await context.decodeAudioData(await file.arrayBuffer())

    if (disposed)
      return

    // Downmix to mono and clamp decoded lossy audio into [-1, 1].
    const samples = new Float32Array(decoded.length)

    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel)

      for (let i = 0; i < values.length; i++)
        samples[i] = samples[i]! + values[i]! / decoded.numberOfChannels
    }

    for (let i = 0; i < samples.length; i++)
      samples[i] = Math.max(-1, Math.min(1, samples[i]!))

    recording = samples
    fileName.value = file.name
    duration.value = decoded.duration

    if (audioUrl.value)
      URL.revokeObjectURL(audioUrl.value)

    audioUrl.value = URL.createObjectURL(file)
  }
  catch (cause) {
    if (!disposed) {
      reportError(cause)
      message.value = 'Could not decode this audio file. Try another format.'
    }

    return
  }
  finally {
    if (context.state !== 'closed')
      await context.close()

    busy.value = ''
  }

  await analyze()
}

/** Triggering workflow: speaker-diarization.vue segment `click` -> {@link seek} -> audio playback from the segment start. */
function seek(seconds: number) {
  if (!player.value)
    return

  player.value.currentTime = seconds
  void player.value.play().catch(() => {})
}

/** Triggering workflow: speaker-diarization.vue cancel button `click` -> {@link cancel} -> diarizer.dispose terminates the Worker. */
function cancel() {
  generation++
  diarizer?.dispose()
  diarizer = undefined
  ready.value = false
  busy.value = ''
  message.value = 'Analysis cancelled. Initialize the models again.'
}

/** Triggering workflow: Vue route onBeforeUnmount -> {@link dispose} -> diarizer.dispose and object URL release. */
function dispose() {
  disposed = true
  lifetime.abort()
  diarizer?.dispose()

  if (audioUrl.value)
    URL.revokeObjectURL(audioUrl.value)
}

onBeforeUnmount(dispose)
</script>

<template>
  <SandboxLayout title="Speaker diarization" min-h-dvh>
    <template #setup>
      <ModelSetupPopover :ready="ready">
        <div p-4 flex="~ col gap-4" overflow-y-auto class="max-h-[70dvh]" aria-label="Model settings">
          <div flex="~ col items-center gap-2" p-4>
            <div font-bold uppercase text-2xl text-neutral>
              pyannote + CAM++
            </div>
            <p text-sm text-center>
              Segmentation 6 MB · Speaker embedding 28 MB
            </p>
          </div>
          <Button :disabled="ready || !!busy" self-end @click="loadModel">
            {{ busy === 'load' ? 'Loading…' : ready ? 'Initialized' : 'Initialize' }}
          </Button>
          <details b="t neutral-200" pt-4 open>
            <summary cursor-pointer font-semibold>
              Clustering
            </summary>
            <div flex="~ col gap-3" pt-4 text-sm>
              <label flex="~ items-center gap-2">
                <input v-model="mode" type="radio" value="count" :disabled="!!busy">
                Known number of speakers
                <input v-model="numSpeakers" aria-label="Number of speakers" type="number" min="1" step="1" :disabled="mode !== 'count' || !!busy" w-20 b="1 neutral-300" rounded-xl p-2>
              </label>
              <label flex="~ items-center gap-2">
                <input v-model="mode" type="radio" value="threshold" :disabled="!!busy">
                Distance threshold
                <input v-model="distanceThreshold" aria-label="Distance threshold" type="number" min="0" step="0.05" :disabled="mode !== 'threshold' || !!busy" w-20 b="1 neutral-300" rounded-xl p-2>
              </label>
              <p text-xs text-neutral-500>
                A larger threshold gives fewer speakers. 0.6 is a starting point; tune it for your recordings.
              </p>
            </div>
          </details>
        </div>
      </ModelSetupPopover>
    </template>

    <main p-4 w-full max-w-4xl flex="~ col items-center justify-center gap-6 grow-1">
      <div v-if="!segments.length" flex="~ col items-center gap-6" w-full p-4>
        <h1 text-4xl md:text-6xl lg:text-8xl font-semibold text-center>
          Speaker diarization
        </h1>
        <p text-neutral-500 text-center>
          Upload a conversation and find when each person speaks. Audio stays on this device.
        </p>
      </div>
      <template v-else>
        <audio ref="player" :src="audioUrl" controls w-full />
        <div class="timeline" w-full flex="~ col gap-2" aria-label="Speaker timeline">
          <div v-for="speaker in speakers" :key="speaker" flex="~ items-center gap-3">
            <span w-24 shrink-0 text-sm font-semibold>Speaker {{ speaker + 1 }}</span>
            <div relative h-6 grow-1 rounded bg-neutral-100>
              <button
                v-for="(segment, index) in segments.filter(item => item.speaker === speaker)" :key="index"
                :aria-label="`Speaker ${speaker + 1}, ${time(segment.start)} to ${time(segment.end)}`"
                absolute h-full rounded
                :style="{ left: `${segment.start / duration * 100}%`, width: `${(segment.end - segment.start) / duration * 100}%`, background: color(speaker) }"
                @click="seek(segment.start)"
              />
            </div>
          </div>
        </div>
        <ol class="segments" w-full text-sm tabular-nums flex="~ col gap-1" aria-label="Segments">
          <li v-for="(segment, index) in segments" :key="index">
            <button flex="~ items-center gap-3" w-full text-left rounded-lg px-2 py-1 hover:bg-neutral-100 @click="seek(segment.start)">
              <span w-3 h-3 rounded-full :style="{ background: color(segment.speaker) }" />
              <span w-24 font-semibold>Speaker {{ segment.speaker + 1 }}</span>
              <span>{{ time(segment.start) }} – {{ time(segment.end) }}</span>
              <span text-neutral-500>{{ (segment.end - segment.start).toFixed(1) }} s</span>
            </button>
          </li>
        </ol>
      </template>
    </main>
    <footer w-full p-4 flex="~ col items-center gap-3 shrink-0" text-sm>
      <div flex="~ wrap justify-center gap-3">
        <Button :disabled="!ready || !!busy" @click="audioFile?.click()">
          Choose audio file
        </Button>
        <Button v-if="busy !== 'analyze'" :disabled="!ready || !!busy || !fileName" @click="analyze">
          Analyze again
        </Button>
        <Button v-else @click="cancel">
          Cancel
        </Button>
        <input ref="audioFile" type="file" hidden accept="audio/*" aria-label="Choose audio file" :disabled="!ready || !!busy" @change="chooseFile">
      </div>
      <p role="status" text-neutral-500 text-center>
        {{ message }}
      </p>
      <p v-if="error" role="alert" text-red-600 text-center>
        {{ error }}
      </p>
    </footer>
  </SandboxLayout>
</template>
