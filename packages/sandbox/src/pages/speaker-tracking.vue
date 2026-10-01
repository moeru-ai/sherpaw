<script setup lang="ts">
import type { SpeakerGuess, SpeakerTracker, SpeakerTurn } from '@sherpaw/speaker-diarization'
import type { VadInstance } from '@sherpaw/vad'

import type { Recognizer } from '../features/asr/protocol'

import { loadData } from '@sherpaw/preloader'
import { createSpeakerTracker } from '@sherpaw/speaker-diarization'
import { createVad, initVADModule } from '@sherpaw/vad'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import Button from '../components/Button.vue'
import ModelSetupPopover from '../components/ModelSetupPopover.vue'
import SandboxLayout from '../components/SandboxLayout.vue'
import { asrModels } from '../features/asr/catalog'
import { createRecognizer } from '../features/asr/recognizer'
import { startMicrophone } from '../features/audio/microphone'
import { loadTrackerModels } from '../features/speaker-diarization/models'
import { review, reviewerNames } from '../features/speaker-diarization/review'

interface Utterance {
  index: number
  /** Seconds of audio fed to the VAD before the utterance started. */
  start: number
  seconds: number
  samples: Float32Array
  /** The label reported when the utterance ended; undefined until the tracker answers. */
  emitted?: Omit<SpeakerTurn, 'index' | 'revisions'>
  /** The label after later revisions. */
  speaker: number | null
  revisions: Array<{ after: number, from: number | null, to: number | null }>
  transcript?: string
  /** Who the reviewer says spoke. */
  truth?: string
}

interface Part {
  /** Samples fed to the VAD before the part starts. */
  start: number
  chunks: Float32Array[]
  length: number
  /** Samples already sent to the recognizer. */
  sent: number
  /** Length at the last speaker check. */
  checked: number
}

const sampleRate = 16000
// peek compares the last two 1.5 s windows, so a check every 0.75 s can only find a change after
// the audio that is more than 0.75 s old. The recognizer gets audio that far behind, to cut it there.
const checkEvery = 0.75 * sampleRate
const colors = ['#2f6f9f', '#c2410c', '#15803d', '#7e22ce', '#b45309', '#0e7490', '#be123c', '#4d7c0f']
// Streaming transducers with endpoint detection; each utterance ends with a final result.
const transcribers = asrModels.filter(model => model.id !== 'x-asr-fp32')

const audioFile = useTemplateRef<HTMLInputElement>('audioFile')
const list = useTemplateRef<HTMLOListElement>('list')

const ready = ref(false)
const busy = ref('')
const error = ref('')
const message = ref('Initialize the models, then start the microphone or test an audio file.')
const asrModel = ref('x-asr')
const listening = ref(false)
const utterances = ref<Utterance[]>([])
const revisionLog = ref<Array<{ after: number, index: number, from: number | null, to: number | null }>>([])
const selected = ref<number>()
// The list follows new utterances while it is scrolled to the bottom.
const following = ref(true)
/** The utterance in progress while the microphone is on: a guess of the speaker and the partial transcript. */
const preview = ref<{ guess?: SpeakerGuess, transcript: string }>()

let tracker: SpeakerTracker | undefined
let recognizer: Recognizer | undefined
let vad: VadInstance | undefined
let microphone: AbortController | undefined
let playback: AudioContext | undefined
let source: AudioBufferSourceNode | undefined
// Tracker and recognizer each take utterances one at a time, in VAD order.
let labeling = Promise.resolve()
let transcribing = Promise.resolve()
/** Text the recognizer has returned so far; each utterance adds its final result to it. */
let recognized = ''
/** The utterance in progress, from its start or from the last speaker change in it. */
let part: Part | undefined
/** The last 0.5 s before speech: the VAD reports speech about 0.25 s after it starts. */
let leadIn: Float32Array[] = []
/** Samples fed to the VAD in this session. */
let fed = 0
// Audio blocks are handled one at a time, because speaker checks are asynchronous.
let pipeline = Promise.resolve()
let disposed = false
let generation = 0

const lifetime = new AbortController()

function speakerName(speaker: number | null) {
  return speaker === null ? 'Unknown' : `Speaker ${speaker + 1}`
}

function color(speaker: number | null | undefined) {
  return speaker === null || speaker === undefined ? '#a3a3a3' : colors[speaker % colors.length]!
}

function time(seconds: number) {
  const minutes = Math.floor(seconds / 60)

  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`
}

function reportError(cause: unknown) {
  if (!disposed)
    error.value = cause instanceof Error ? cause.message : String(cause)
}

const result = computed(() => review(utterances.value.flatMap(item => (item.truth && item.emitted ? [{ emitted: item.emitted.speaker, final: item.speaker, truth: item.truth }] : []))))
const current = computed(() => (selected.value === undefined ? undefined : utterances.value[selected.value]))

function percentage(part: number, whole: number) {
  return whole ? `${Math.round(part / whole * 100)}%` : '—'
}

function verdict(item: Utterance) {
  if (!item.truth || item.speaker === null)
    return ''

  return result.value.mapping.get(item.speaker) === item.truth ? '✓' : '✗'
}

/** Triggering workflow: speaker-tracking.vue initialize button `click` -> {@link loadModel} -> Silero VAD, speaker tracker and optional recognizer. */
async function loadModel() {
  busy.value = 'load'
  error.value = ''

  try {
    message.value = 'Loading models…'

    const [models, module] = await Promise.all([loadTrackerModels(), initVADModule()])

    lifetime.signal.throwIfAborted()
    loadData({ module, data: models.vad.data, metadata: models.vad.metadata })
    // As in a voice agent, an utterance ends after 0.5 s of silence.
    vad = createVad(module, {
      sileroVad: { model: '/silero-vad.onnx', threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 },
      sampleRate,
      bufferSizeInSeconds: 60,
    })
    ;[tracker, recognizer] = await Promise.all([
      createSpeakerTracker({ model: models.embedding, signal: lifetime.signal }),
      asrModel.value ? createRecognizer({ modelId: asrModel.value, backend: 'cpu' }, status => message.value = status) : undefined,
    ])
    ready.value = true
    message.value = 'Models ready. Start the microphone or test an audio file.'
  }
  catch (cause) {
    reportError(cause)
    message.value = 'Could not load the models. Try again.'
  }
  finally {
    busy.value = ''
  }
}

/** Triggering workflow: {@link feed} -> {@link label} -> tracker.track -> utterance label, revised earlier utterances and revision log. */
async function label(item: Utterance, session: number) {
  const { revisions, index, ...turn } = await tracker!.track(item.samples, sampleRate)

  if (disposed || session !== generation)
    return

  for (const revision of revisions) {
    const earlier = utterances.value[revision.index]

    if (earlier) {
      earlier.revisions.push({ after: index, from: earlier.speaker, to: revision.speaker })
      revisionLog.value.unshift({ after: index, index: revision.index, from: earlier.speaker, to: revision.speaker })
      earlier.speaker = revision.speaker
    }
  }

  item.emitted = turn
  item.speaker = turn.speaker
}

function withoutLeadingMark(text: string) {
  // Punctuating models emit the previous sentence's final mark at the start of the next result.
  const mark = text.match(/^[\s,.!?;:，。！？、；：]*/u)![0]

  return { mark, words: text.slice(mark.length).trim() }
}

/** Triggering workflow: {@link commit} -> {@link transcribe} -> recognizer.accept of 1 s of silence -> final utterance transcript. */
async function transcribe(item: Utterance, session: number) {
  // The recognizer's endpoint rule needs 0.8 s of trailing silence to finish the utterance.
  const text = await recognizer!.accept(new Float32Array(sampleRate))
  const { mark, words } = withoutLeadingMark(text.startsWith(recognized) ? text.slice(recognized.length) : text)

  recognized = text

  if (disposed || session !== generation)
    return

  const previous = utterances.value[item.index - 1]

  if (previous?.transcript !== undefined)
    previous.transcript += mark.trim()

  item.transcript = words
}

function concat(chunks: Float32Array[]) {
  const audio = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0

  for (const chunk of chunks) {
    audio.set(chunk, offset)
    offset += chunk.length
  }

  return audio
}

/** Triggering workflow: {@link handle} / {@link commit} -> {@link send} -> recognizer partial text for the part's audio before `to`. */
function send(current: Part, to: number) {
  if (!recognizer || to <= current.sent)
    return

  const audio = concat(current.chunks).slice(current.sent, to)
  const session = generation

  current.sent = to
  transcribing = transcribing.then(async () => {
    const text = await recognizer!.accept(audio)

    // A part that was cut or ended no longer owns the preview.
    if (preview.value && session === generation && part === current)
      preview.value.transcript = withoutLeadingMark(text.slice(recognized.length)).words
  }).catch(reportError)
}

/** Triggering workflow: speaker change or VAD utterance end -> {@link commit} -> queued {@link label} and {@link transcribe} for the part's audio before `to`. */
function commit(current: Part, to: number) {
  const session = generation

  send(current, to)

  const count = utterances.value.push({
    index: utterances.value.length,
    start: current.start / sampleRate,
    seconds: to / sampleRate,
    samples: concat(current.chunks).slice(0, to),
    speaker: null,
    revisions: [],
    transcript: recognizer ? preview.value?.transcript : undefined,
  })
  // Mutate through the reactive array so the row updates.
  const item = utterances.value[count - 1]!

  labeling = labeling.then(() => label(item, session)).catch(reportError)

  if (recognizer)
    transcribing = transcribing.then(() => transcribe(item, session)).catch(reportError)
}

/** Triggering workflow: {@link handle} every 0.75 s of speech -> {@link check} -> tracker.peek -> speaker guess, and a cut at a speaker change. */
async function check(current: Part, session: number) {
  const from = Math.max(0, current.length - 3 * sampleRate)

  current.checked = current.length

  const guess = await tracker!.peek(concat(current.chunks).slice(from), sampleRate)

  if (session !== generation)
    return current

  const at = guess.change === undefined ? 0 : from + Math.round(guess.change * sampleRate)

  // Keep at least 0.5 s on the earlier side of a change.
  if (at < sampleRate / 2) {
    preview.value = { transcript: preview.value?.transcript ?? '', guess }

    return current
  }

  commit(current, at)

  const rest = concat(current.chunks).slice(at)

  preview.value = { transcript: '', guess: { speaker: guess.speaker, score: guess.score, confidence: guess.confidence } }

  return { start: current.start + at, chunks: [rest], length: rest.length, sent: 0, checked: rest.length }
}

/** Triggering workflow: {@link feed} -> {@link handle} -> VAD, speaker checks, recognizer audio and utterance commits. */
async function handle(block: Float32Array | undefined, session: number) {
  const detector = vad

  if (!detector || session !== generation)
    return

  if (block) {
    detector.acceptWaveform(block)
    fed += block.length

    if (detector.isDetected()) {
      if (!part) {
        const lead = leadIn.splice(0)
        const length = lead.reduce((sum, chunk) => sum + chunk.length, 0)

        part = { start: fed - block.length - length, chunks: lead, length, sent: 0, checked: 0 }
        preview.value = { transcript: '' }
      }

      part.chunks.push(block)
      part.length += block.length

      if (part.length - part.checked >= checkEvery) {
        const next = await check(part, session)

        if (session !== generation)
          return

        part = next
      }

      // The next check can cut 1.5 s before its own end, which is at least 0.75 s before the
      // last checked end; a part is cut no earlier than 1.5 s into it.
      send(part, Math.min(part.length, Math.max(2 * checkEvery, part.checked - checkEvery)))
    }
    else if (!part) {
      leadIn.push(block)

      while (leadIn.length * block.length > sampleRate / 2)
        leadIn.shift()
    }
  }
  else {
    detector.flush()
  }

  while (!detector.isEmpty()) {
    const segment = detector.front()

    detector.pop()

    // Normally the part holds the segment; it also holds the trailing silence that ended it.
    const current = part ?? { start: segment.start, chunks: [segment.samples], length: segment.samples.length, sent: 0, checked: 0 }
    const end = Math.min(current.length, segment.start + segment.samples.length - current.start)

    if (end > 0)
      commit(current, end)

    part = undefined
    leadIn = []
    preview.value = undefined
  }
}

/** Triggering workflow: microphone or file audio / flush -> {@link feed} -> {@link handle} in order. */
function feed(block?: Float32Array) {
  const session = generation

  pipeline = pipeline.then(() => handle(block, session)).catch(reportError)

  return pipeline
}

/** Triggering workflow: speaker-tracking.vue stop button / capture failure / {@link dispose} -> {@link stopMicrophone} -> VAD flush and capture abort. */
function stopMicrophone() {
  microphone?.abort()
  microphone = undefined

  if (listening.value)
    void feed()

  listening.value = false
  message.value = 'Microphone stopped. Select an utterance to review it.'
}

/** Triggering workflow: speaker-tracking.vue start button `click` -> {@link listen} -> {@link startMicrophone} -> {@link feed}. */
async function listen() {
  busy.value = 'start'
  error.value = ''

  const controller = new AbortController()

  microphone = controller
  listening.value = true
  following.value = true

  let block = new Float32Array(sampleRate / 10)
  let offset = 0

  try {
    // Batch and clamp microphone PCM into 100 ms blocks.
    await startMicrophone(controller.signal, (samples, rate) => {
      if (rate !== sampleRate)
        return

      for (const value of samples) {
        block[offset++] = Math.max(-1, Math.min(1, value))

        if (offset === block.length) {
          void feed(block)
          block = new Float32Array(block.length)
          offset = 0
        }
      }
    }, { sampleRate })
    message.value = 'Listening. Each utterance gets a speaker label and a transcript when it ends.'
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

/** Triggering workflow: speaker-tracking.vue new session button / {@link testFile} -> {@link newSession} -> tracker.reset and VAD reset. */
async function newSession() {
  generation++
  vad?.reset()
  utterances.value = []
  revisionLog.value = []
  selected.value = undefined
  following.value = true
  part = undefined
  leadIn = []
  fed = 0
  preview.value = undefined
  await tracker?.reset()
}

/** Triggering workflow: speaker-tracking.vue audio file input `change` -> {@link testFile} -> decodeAudioData -> {@link feed} in 100 ms chunks. */
async function testFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  input.value = ''

  if (!file)
    return

  busy.value = 'file'
  error.value = ''

  // decodeAudioData resamples to the context rate.
  const context = new AudioContext({ sampleRate })

  try {
    message.value = `Reading ${file.name}…`

    const decoded = await context.decodeAudioData(await file.arrayBuffer())
    // Downmix to mono and clamp decoded lossy audio into [-1, 1].
    const samples = new Float32Array(decoded.length)

    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel)

      for (let i = 0; i < values.length; i++)
        samples[i] = samples[i]! + values[i]! / decoded.numberOfChannels
    }

    await newSession()

    message.value = `Processing ${file.name}…`

    for (let offset = 0; offset < samples.length; offset += sampleRate / 10)
      void feed(samples.subarray(offset, offset + sampleRate / 10).map(value => Math.max(-1, Math.min(1, value))))

    await feed()
    await Promise.all([labeling, transcribing])
    message.value = `${file.name}: ${utterances.value.length} utterances. Select one to review it.`
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

/** Triggering workflow: row play button / Space key -> {@link play} -> AudioBufferSourceNode playback of the utterance. */
function play(item: Utterance) {
  source?.stop()
  playback ??= new AudioContext({ sampleRate })

  const buffer = playback.createBuffer(1, item.samples.length, sampleRate)

  buffer.getChannelData(0).set(item.samples)
  source = playback.createBufferSource()
  source.buffer = buffer
  source.connect(playback.destination)
  source.start()
}

/** Triggering workflow: row name buttons / A-L and Backspace keys -> {@link setTruth} -> review summary. */
function setTruth(name?: string) {
  if (current.value)
    current.value.truth = name
}

/** Triggering workflow: list `scroll` -> {@link onScroll} -> follow new utterances only at the bottom. */
function onScroll() {
  const element = list.value

  if (element)
    following.value = element.scrollTop + element.clientHeight >= element.scrollHeight - 24
}

/** Triggering workflow: "Follow latest" button -> {@link followLatest} -> scroll to the newest row. */
function followLatest() {
  following.value = true
  list.value?.scrollTo({ top: list.value.scrollHeight })
}

/** Triggering workflow: window `keydown` -> {@link onKeydown} -> selection, labeling or playback of the selected utterance. */
function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null

  if (event.altKey || event.ctrlKey || event.metaKey || target?.closest('input, select, textarea') || !utterances.value.length)
    return

  const key = event.key.toUpperCase()

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const step = event.key === 'ArrowDown' ? 1 : -1

    selected.value = Math.max(0, Math.min(utterances.value.length - 1, (selected.value ?? -step) + step))
    void nextTick(() => list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  }
  else if (current.value && (reviewerNames as readonly string[]).includes(key)) {
    setTruth(key)
  }
  else if (current.value && (event.key === 'Backspace' || event.key === 'Delete')) {
    setTruth()
  }
  else if (current.value && event.key === ' ') {
    play(current.value)
  }
  else {
    return
  }

  event.preventDefault()
}

/** Triggering workflow: new utterance -> watch -> scroll the list to the newest row while following. */
watch(() => [utterances.value.length, preview.value?.transcript], async () => {
  if (!following.value)
    return

  await nextTick()
  list.value?.scrollTo({ top: list.value.scrollHeight })
})

/** Triggering workflow: Vue route onBeforeUnmount -> {@link dispose} -> capture abort, tracker, recognizer, VAD and playback release. */
function dispose() {
  disposed = true
  window.removeEventListener('keydown', onKeydown)
  stopMicrophone()
  lifetime.abort()
  tracker?.dispose()
  void recognizer?.dispose().catch(() => {})
  vad?.free()
  source?.stop()
  void playback?.close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(dispose)
</script>

<template>
  <SandboxLayout title="Speaker tracking" min-h-dvh>
    <template #setup>
      <ModelSetupPopover :ready="ready">
        <div p-4 flex="~ col gap-4" aria-label="Model settings">
          <div flex="~ col items-center gap-2" p-4>
            <div font-bold uppercase text-2xl text-neutral>
              Silero VAD + CAM++
            </div>
            <p text-sm text-center>
              VAD 2.3 MB · Speaker embedding 28 MB
            </p>
          </div>
          <label flex="~ col gap-1" text-sm>
            <span font-semibold>Transcripts</span>
            <select v-model="asrModel" :disabled="ready || !!busy" b rounded-lg p-2 bg-white>
              <option v-for="model in transcribers" :key="model.id" :value="model.id">
                {{ model.label }} · {{ Math.round(model.modelBytes / 1e6) }} MB
              </option>
              <option value="">
                No transcripts
              </option>
            </select>
          </label>
          <Button :disabled="ready || !!busy" self-end @click="loadModel">
            {{ busy === 'load' ? 'Loading…' : ready ? 'Initialized' : 'Initialize' }}
          </Button>
        </div>
      </ModelSetupPopover>
    </template>

    <main p-4 w-full max-w-5xl flex="~ col items-center justify-center gap-6 grow-1">
      <div v-if="!utterances.length && !preview" flex="~ col items-center gap-6" w-full p-4>
        <h1 text-4xl md:text-6xl lg:text-8xl font-semibold text-center>
          Speaker tracking
        </h1>
        <p text-neutral-500 text-center>
          Speakers are numbered as they appear. Each label comes with a confidence, and earlier labels may be revised. Audio stays on this device.
        </p>
      </div>
      <div v-else w-full grid="~ cols-1 md:cols-[2fr_1fr] gap-6" text-sm>
        <section flex="~ col gap-2" aria-label="Utterances">
          <ol ref="list" class="max-h-[65dvh]" overflow-y-auto flex="~ col gap-1" pr-2 @scroll="onScroll">
            <li
              v-for="item in utterances" :key="item.index"
              :aria-selected="item.index === selected" rounded-lg px-3 py-2 cursor-pointer
              :class="item.index === selected ? 'bg-neutral-100' : 'hover:bg-neutral-50'"
              @click="selected = item.index"
            >
              <div flex="~ items-baseline gap-3">
                <span w-3 h-3 rounded-full shrink-0 :style="{ background: color(item.speaker) }" />
                <span w-28 shrink-0 font-semibold :style="{ color: color(item.speaker) }">
                  {{ item.emitted ? speakerName(item.speaker) : '…' }}{{ item.speaker !== null && result.mapping.get(item.speaker) ? ` = ${result.mapping.get(item.speaker)}` : '' }}
                </span>
                <p grow-1 text-base>
                  {{ item.transcript ?? (recognizer ? '…' : '') }}
                </p>
                <span shrink-0 text-xs text-neutral-500 tabular-nums>{{ time(item.start) }}</span>
              </div>
              <div flex="~ wrap gap-x-3" pl-6 text-xs text-neutral-500>
                <span v-if="item.emitted" :class="item.emitted.confidence === 'high' ? 'text-green-700' : item.emitted.confidence === 'medium' ? 'text-amber-700' : 'text-red-700'">
                  {{ item.emitted.confidence }} {{ item.emitted.score.toFixed(2) }}
                </span>
                <span tabular-nums>{{ item.seconds.toFixed(1) }} s</span>
                <span v-if="item.emitted?.pending">new speaker?</span>
                <span v-if="item.emitted?.mixed">+ another speaker</span>
                <span v-if="item.revisions.length">revised ↺</span>
                <span v-if="item.truth" font-semibold text-neutral-800>label {{ item.truth }} {{ verdict(item) }}</span>
              </div>
              <div v-if="item.index === selected" pl-6 pt-2 flex="~ col gap-2">
                <p v-if="item.emitted">
                  When it ended: <b>{{ speakerName(item.emitted.speaker) }}</b>, {{ item.emitted.confidence }} ({{ item.emitted.score.toFixed(2) }}). Now: <b>{{ speakerName(item.speaker) }}</b>.
                </p>
                <ol v-if="item.revisions.length" text-neutral-600>
                  <li v-for="(revision, i) in item.revisions" :key="i">
                    After #{{ revision.after }}: {{ speakerName(revision.from) }} → {{ speakerName(revision.to) }}
                  </li>
                </ol>
                <div flex="~ wrap items-center gap-1">
                  <span mr-1>Who spoke:</span>
                  <button
                    v-for="name in reviewerNames" :key="name" w-7 h-7 rounded b="1 neutral-300"
                    :class="item.truth === name ? 'bg-neutral-800 text-white' : 'bg-white hover:bg-neutral-100'"
                    @click.stop="setTruth(name)"
                  >
                    {{ name }}
                  </button>
                  <button px-2 h-7 rounded b="1 neutral-300" bg-white hover:bg-neutral-100 @click.stop="setTruth()">
                    Clear
                  </button>
                  <Button ml-2 @click.stop="play(item)">
                    Play
                  </Button>
                </div>
              </div>
            </li>
            <li v-if="preview" rounded-lg px-3 py-2 b="1 dashed neutral-300" aria-live="polite">
              <div flex="~ items-baseline gap-3">
                <span w-3 h-3 rounded-full shrink-0 animate-pulse :style="{ background: color(preview.guess?.speaker) }" />
                <span w-28 shrink-0 font-semibold :style="{ color: color(preview.guess?.speaker) }">
                  {{ preview.guess === undefined ? '…' : preview.guess.speaker === null ? 'New speaker?' : `${speakerName(preview.guess.speaker)}?` }}
                </span>
                <p grow-1 text-base text-neutral-500>
                  {{ preview.transcript || '…' }}
                </p>
              </div>
              <div pl-6 text-xs text-neutral-500>
                speaking{{ preview.guess ? ` · guess ${preview.guess.confidence} ${preview.guess.score.toFixed(2)}` : '' }}
              </div>
            </li>
          </ol>
          <p text-xs text-neutral-500>
            Keys: ↑/↓ select, A–{{ reviewerNames.at(-1) }} label who spoke, Backspace clear, Space play.
            <button v-if="!following" underline @click="followLatest">
              Follow latest
            </button>
          </p>
        </section>
        <section flex="~ col gap-2" aria-label="Review">
          <h2 font-semibold>
            Review
          </h2>
          <p>Labeled {{ result.labeled }} of {{ utterances.length }} utterances.</p>
          <p>When they ended: {{ result.emittedCorrect }} correct ({{ percentage(result.emittedCorrect, result.labeled) }})</p>
          <p>After revisions: {{ result.finalCorrect }} correct ({{ percentage(result.finalCorrect, result.labeled) }})</p>
          <p>Revisions on labeled utterances: {{ result.fixed }} fixed, {{ result.broken }} broke a correct label.</p>
          <h3 font-semibold mt-2>
            Revision log ({{ revisionLog.length }})
          </h3>
          <ol max-h-64 overflow-y-auto text-neutral-600 tabular-nums>
            <li v-for="(entry, i) in revisionLog" :key="i">
              After #{{ entry.after }}: #{{ entry.index }} {{ speakerName(entry.from) }} → {{ speakerName(entry.to) }}
            </li>
          </ol>
        </section>
      </div>
    </main>
    <footer w-full p-4 flex="~ col items-center gap-3 shrink-0" text-sm>
      <div flex="~ wrap justify-center gap-3">
        <Button v-if="!listening" :disabled="!ready || !!busy" @click="listen">
          Start microphone
        </Button>
        <Button v-else @click="stopMicrophone">
          Stop microphone
        </Button>
        <Button :disabled="!ready || !!busy || listening" @click="audioFile?.click()">
          Test audio file
        </Button>
        <Button :disabled="!ready || !!busy || !utterances.length" @click="newSession">
          New session
        </Button>
        <input ref="audioFile" type="file" hidden accept="audio/*" aria-label="Test audio file" :disabled="!ready || !!busy || listening" @change="testFile">
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
