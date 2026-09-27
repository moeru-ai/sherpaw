<script setup lang="ts">
import type { Detection, KeywordEntry, KeywordSpotter } from '@sherpaw/kws'

import { createKeywordSpotter } from '@sherpaw/kws'
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'

import Button from '../components/Button.vue'
import ModelSetupPopover from '../components/ModelSetupPopover.vue'
import SandboxLayout from '../components/SandboxLayout.vue'
import { startMicrophone } from '../features/audio/microphone'
import { loadKWSModel } from '../features/kws/models'
import { keywordPresets } from '../features/kws/presets'

interface Draft {
  id: number
  label: string
  tokens: string
  score: string | number
  threshold: string | number
}

const audioFile = useTemplateRef<HTMLInputElement>('audioFile')

const ready = ref(false)
const busy = ref('')
const listening = ref(false)
const error = ref('')
const message = ref('Load a model to start listening or test an audio file.')

const seconds = ref(0)
const activeLabels = ref<string[]>([])
const history = ref<(Detection & { id: number, source: string })[]>([])

const preset = ref(keywordPresets[0]!)
let rowId = 0
const drafts = ref<Draft[]>(createDrafts(preset.value.entries))

let hitId = 0
let disposed = false
let inputGeneration = 0
let microphone: AbortController | undefined
let fileContext: AudioContext | undefined

const paused = computed(() => ready.value && activeLabels.value.length === 0)

const lifetime = new AbortController()
let spotter: KeywordSpotter | undefined

function createDrafts(keywords: KeywordEntry[]): Draft[] {
  return keywords.map(entry => ({
    id: ++rowId,
    label: entry.label,
    tokens: entry.matches.map(match => match.tokens.join(' ')).join('\n'),
    score: String(entry.score ?? 1),
    threshold: String(entry.threshold ?? 0.25),
  }))
}

/** Triggering workflow: kws.vue preset select `change` -> {@link selectPreset} -> draft replacement and {@link applyKeywords} when loaded. */
async function selectPreset(id: string) {
  const selected = keywordPresets.find(preset => preset.id === id)

  if (!selected)
    return

  preset.value = selected
  drafts.value = createDrafts(selected.entries)
  error.value = ''

  if (ready.value)
    await applyKeywords()
  else
    message.value = 'Preset selected. Load the model to begin.'
}

function entries(): KeywordEntry[] {
  return drafts.value.map((row) => {
    const lines = row.tokens.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)

    return {
      label: row.label,
      matches: lines.map(line => ({ tokens: line.split(/\s+/u) })),
      score: String(row.score).trim() ? Number(row.score) : undefined,
      threshold: String(row.threshold).trim() ? Number(row.threshold) : undefined,
    }
  })
}

function reportError(cause: unknown) {
  error.value = cause instanceof Error ? cause.message : String(cause)
}

function record(hits: Detection[], source: string) {
  for (const hit of hits)
    history.value.unshift({ ...hit, id: ++hitId, source })

  history.value = history.value.slice(0, 100)
}

/** Triggering workflow: kws.vue load button `click` -> {@link loadModel} -> createKeywordSpotter -> model/keyword status. */
async function loadModel() {
  busy.value = 'load'
  error.value = ''

  try {
    const keywords = entries()

    message.value = 'Loading model…'

    const model = await loadKWSModel()

    lifetime.signal.throwIfAborted()
    message.value = 'Initializing keyword detector…'
    spotter = await createKeywordSpotter({ model, keywords, maxActivePaths: preset.value.maxActivePaths, signal: lifetime.signal })
    ready.value = true
    activeLabels.value = [...new Set(keywords.map(entry => entry.label))]
    message.value = 'Model ready.'
  }
  catch (cause) {
    if (disposed)
      return

    reportError(cause)
    message.value = 'Could not load the model. Check your keywords and try again.'
  }
  finally {
    busy.value = ''
  }
}

async function replace(keywords: KeywordEntry[]) {
  busy.value = 'update'
  error.value = ''

  try {
    await spotter!.setKeywords(keywords, { maxActivePaths: preset.value.maxActivePaths })
    activeLabels.value = [...new Set(keywords.map(entry => entry.label))]
    seconds.value = 0
    message.value = keywords.length ? 'Keywords updated. Audio state reset.' : 'Detection paused. Apply keywords to resume.'
  }
  catch (cause) {
    reportError(cause)
    message.value = 'Update failed. The previous keywords remain active.'
  }
  finally {
    busy.value = ''
  }
}

/** Triggering workflow: kws.vue apply button `click` -> {@link applyKeywords} -> {@link replace} -> spotter.setKeywords. */
async function applyKeywords() {
  await replace(entries())
}

/** Triggering workflow: kws.vue pause button `click` -> {@link pauseDetection} -> {@link replace} with an empty vocabulary. */
async function pauseDetection() {
  await replace([])
}

/** Triggering workflow: kws.vue add button `click` -> {@link addKeyword} -> editable draft row. */
function addKeyword() {
  drafts.value.push({ id: ++rowId, label: '', tokens: '', score: '1', threshold: '0.25' })
}

/** Triggering workflow: kws.vue remove button `click` -> {@link removeKeyword} -> draft removal; {@link applyKeywords} commits it. */
function removeKeyword(id: number) {
  drafts.value = drafts.value.filter(row => row.id !== id)
}

/** Triggering workflow: kws.vue stop button / capture failure / {@link dispose} -> {@link stopMicrophone} -> AbortController.abort. */
function stopMicrophone() {
  inputGeneration++
  microphone?.abort()
  microphone = undefined
  listening.value = false
  message.value = 'Listening stopped. Microphone released.'
}

/** Triggering workflow: kws.vue start button `click` -> {@link listen} -> spotter.reset -> {@link startMicrophone}. */
async function listen() {
  busy.value = 'start'
  error.value = ''
  seconds.value = 0
  listening.value = true

  const controller = new AbortController()

  microphone = controller

  const generation = ++inputGeneration

  /** Triggering workflow: microphone.collect -> {@link processMicrophone} -> spotter.processAudio -> {@link record}. */
  function processMicrophone(samples: Float32Array, sampleRate: number) {
    if (disposed || generation !== inputGeneration)
      return

    seconds.value += samples.length / sampleRate

    if (paused.value)
      return

    void spotter!.processAudio(samples, sampleRate).then((hits) => {
      if (!disposed && generation === inputGeneration)
        record(hits, 'Microphone')
    }).catch((cause: unknown) => {
      if (!disposed && generation === inputGeneration) {
        stopMicrophone()
        reportError(cause)
      }
    })
  }

  try {
    await spotter!.reset()
    controller.signal.throwIfAborted()

    let batch: Float32Array | undefined
    let offset = 0

    // Keep 100 ms requests without making the shared recorder clip speaker audio.
    await startMicrophone(controller.signal, (samples, sampleRate) => {
      batch ??= new Float32Array(Math.round(sampleRate / 10))

      for (const value of samples) {
        batch[offset++] = Math.max(-1, Math.min(1, value))

        if (offset === batch.length) {
          const completed = batch

          batch = new Float32Array(batch.length)
          processMicrophone(completed, sampleRate)
          offset = 0
        }
      }
    })
    message.value = 'Listening for keywords.'
  }
  catch (cause) {
    if (!controller.signal.aborted && !disposed) {
      stopMicrophone()
      reportError(cause)
    }
  }
  finally {
    busy.value = ''
  }
}

/** Triggering workflow: kws.vue audio file input `change` -> {@link testFile} -> decodeAudioData -> spotter.processAudio -> {@link record}. */
async function testFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  input.value = ''

  if (!file)
    return

  busy.value = 'file'
  error.value = ''
  seconds.value = 0

  const generation = ++inputGeneration
  const context = new AudioContext({ sampleRate: 16000 })

  fileContext = context

  try {
    message.value = `Reading ${file.name}…`

    const decoded = await context.decodeAudioData(await file.arrayBuffer())

    if (disposed)
      return

    await spotter!.reset()

    // Downmix to mono and add one second of trailing silence for streaming KWS.
    const samples = new Float32Array(decoded.length + decoded.sampleRate)

    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel)

      for (let i = 0; i < values.length; i++)
        samples[i] = samples[i]! + values[i]! / decoded.numberOfChannels
    }

    for (let i = 0; i < samples.length; i++)
      samples[i] = Math.max(-1, Math.min(1, samples[i]!))

    for (let offset = 0; offset < samples.length; offset += 1600) {
      if (disposed || generation !== inputGeneration)
        return

      const hits = await spotter!.processAudio(samples.subarray(offset, offset + 1600), decoded.sampleRate)

      if (disposed)
        return

      record(hits, file.name)
      seconds.value = Math.min((offset + 1600) / decoded.sampleRate, decoded.duration)
      message.value = `Processing ${file.name} · ${seconds.value.toFixed(1)} / ${decoded.duration.toFixed(1)} s`
    }

    message.value = `${file.name} complete.`
  }
  catch (cause) {
    if (!disposed) {
      reportError(cause)
      message.value = 'Could not process this audio file. Check the file and try again.'
    }
  }
  finally {
    if (context.state !== 'closed')
      await context.close()

    fileContext = undefined
    busy.value = ''
  }
}

/** Triggering workflow: kws.vue clear button `click` -> {@link clearHistory} -> history rows cleared. */
function clearHistory() {
  history.value = []
}

/** Triggering workflow: Vue route onBeforeUnmount -> {@link dispose} -> capture abort, AudioContext.close and spotter.dispose. */
function dispose() {
  disposed = true
  stopMicrophone()

  if (fileContext && fileContext.state !== 'closed')
    void fileContext.close().catch(() => {})

  lifetime.abort()
  spotter?.dispose()
}

onBeforeUnmount(dispose)
</script>

<template>
  <SandboxLayout title="KWS" h-dvh>
    <template #setup>
      <ModelSetupPopover :ready="ready">
        <div p-4 flex="~ col gap-4" overflow-y-auto class="max-h-[70dvh]" aria-label="Model settings">
          <div flex="~ col items-center gap-2" p-4>
            <div font-bold uppercase text-2xl text-neutral>
              Zipformer 3M
            </div>
            <p text-sm text-center>
              Chinese / English · 13 MB
            </p>
          </div>
          <Button :disabled="ready || !!busy" self-end @click="loadModel">
            {{ busy === 'load' ? 'Loading…' : ready ? 'Initialized' : 'Initialize' }}
          </Button>
          <details b="t neutral-200" pt-4>
            <summary cursor-pointer font-semibold>
              Keywords
            </summary>
            <div flex="~ col gap-4" pt-4>
              <label text-sm flex="~ col gap-2">
                Preset
                <select aria-label="Preset" :value="preset.id" :disabled="!!busy" b="1 neutral-300" rounded-xl p-2 @change="selectPreset(($event.target as HTMLSelectElement).value)">
                  <option v-for="option in keywordPresets" :key="option.id" :value="option.id">{{ option.name }}</option>
                </select>
              </label>
              <p text-xs text-neutral-500>
                {{ preset.note }} Presets apply immediately once the model is ready.
              </p>
              <div v-for="(row, index) in drafts" :key="row.id" class="keyword-row" flex="~ col gap-3" b="1 neutral-300" rounded-xl p-3>
                <label text-sm>Label<input v-model="row.label" :aria-label="`Keyword ${index + 1} label`" :disabled="!!busy" placeholder="Hey Iru" w-full b="1 neutral-300" rounded-xl p-2 mt-1></label>
                <label text-sm min-w-0>Tokens<textarea v-model="row.tokens" :aria-label="`Keyword ${index + 1} tokens`" :rows="Math.min(4, row.tokens.split('\n').length)" :disabled="!!busy" spellcheck="false" w-full b="1 neutral-300" rounded-xl p-2 mt-1 font-mono text-xs /></label>
                <div flex="~ items-end gap-3">
                  <label text-sm flex-1 min-w-0>Score<input v-model="row.score" :aria-label="`Keyword ${index + 1} score`" :disabled="!!busy" type="number" min="0" step="any" placeholder="1" w-full b="1 neutral-300" rounded-xl p-2 mt-1></label>
                  <label text-sm flex-1 min-w-0>Threshold<input v-model="row.threshold" :aria-label="`Keyword ${index + 1} threshold`" :disabled="!!busy" type="number" min="0" max="1" step="any" placeholder="0.25" w-full b="1 neutral-300" rounded-xl p-2 mt-1></label>
                  <Button :aria-label="`Remove keyword ${index + 1}`" :disabled="!!busy" @click="removeKeyword(row.id)">
                    Remove
                  </Button>
                </div>
              </div>
              <p v-if="!drafts.length" text-sm text-neutral-500>
                Applying an empty list pauses detection.
              </p>
              <div flex="~ wrap gap-3">
                <Button :disabled="!!busy" @click="addKeyword">
                  Add keyword
                </Button>
                <Button :disabled="!ready || !!busy" @click="applyKeywords">
                  {{ busy === 'update' ? 'Applying…' : 'Apply' }}
                </Button>
                <Button :disabled="!ready || paused || !!busy" @click="pauseDetection">
                  Pause detection
                </Button>
              </div>
              <p text-xs text-neutral-500>
                Separate tokens with spaces and pronunciations with new lines. Apply manual edits to update the active keywords.
              </p>
            </div>
          </details>
        </div>
      </ModelSetupPopover>
    </template>

    <main p-4 w-full relative min-h-0 flex="~ col items-center justify-center gap-4 grow-1">
      <div v-if="!listening && !history.length" flex="~ col items-center gap-6" w-full p-4>
        <h1 text-4xl md:text-6xl lg:text-8xl font-semibold text-center>
          Keyword spotting
        </h1>
        <Button :disabled="!ready || paused || !!busy" @click="listen">
          Start
        </Button>
      </div>
      <div v-else flex="~ col items-center justify-end gap-6" w-full absolute h-full p-6>
        <div class="history" w-full min-h-0 overflow-y-auto flex="~ col items-center gap-6 grow-1" aria-label="Detections">
          <p v-if="!history.length" text-4xl font-semibold text-center my-auto>
            Listening<span font-normal animate-pulse>|</span>
          </p>
          <article v-for="(hit, index) in history" :key="hit.id" class="hit" text-center shrink-0>
            <strong :class="index === 0 ? 'text-4xl font-bold' : 'text-3xl op-70'">{{ hit.label }}</strong>
            <p text-xs text-neutral-500 mt-2>
              {{ hit.source }} · {{ (hit.timestamps[0] ?? 0).toFixed(2) }} s
            </p>
            <details text-xs text-neutral-500 mt-2>
              <summary cursor-pointer>
                Token timestamps
              </summary>
              <p>Segment start: {{ hit.startTime.toFixed(2) }} s</p>
              <div class="token-times" flex="~ wrap justify-center gap-2" mt-2>
                <span v-for="(token, tokenIndex) in hit.tokens" :key="tokenIndex">{{ token }} {{ (hit.timestamps[tokenIndex] ?? 0).toFixed(2) }} s</span>
              </div>
              <p mt-2>
                Times are relative to the decoder segment.
              </p>
            </details>
          </article>
        </div>
        <div flex="~ col items-center gap-3 shrink-0">
          <p class="time" text-sm text-neutral-500 tabular-nums>
            {{ seconds.toFixed(1) }} s · {{ paused ? 'Paused' : listening ? 'Listening' : 'Idle' }}
          </p>
          <Button v-if="listening" @click="stopMicrophone">
            Stop listening
          </Button>
          <Button v-else :disabled="!ready || paused || !!busy" @click="listen">
            Start
          </Button>
        </div>
      </div>
    </main>
    <footer w-full p-4 flex="~ col items-center gap-3 shrink-0" text-sm>
      <div class="active-words" flex="~ wrap justify-center gap-3" text-neutral-500 aria-label="Active keywords">
        <span v-for="(label, index) in activeLabels" :key="index" class="word">{{ label }}</span>
      </div>
      <div flex="~ wrap justify-center gap-3">
        <Button :disabled="!ready || paused || listening || !!busy" @click="audioFile?.click()">
          Test audio file
        </Button>
        <Button v-if="history.length" @click="clearHistory">
          Clear detections
        </Button>
        <input ref="audioFile" type="file" hidden accept="audio/*" aria-label="Test audio file" :disabled="!ready || paused || listening || !!busy" @change="testFile">
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
