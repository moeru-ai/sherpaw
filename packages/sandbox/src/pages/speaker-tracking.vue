<script setup lang="ts">
import type { SpeakerGuess, SpeakerMap, SpeakerTracker, SpeakerTurn, SpeechSegment } from '@sherpaw/speaker-diarization'

import type { Recognizer } from '../features/asr/protocol'

import type { EmbeddingModel } from '../features/speaker-diarization/models'
import type { SpeechDetection, UtteranceDetector } from '../features/speaker-diarization/speech-detectors'
import type { Preset, TrackingParameters } from '../features/speaker-diarization/tracker-settings'
import { loadData } from '@sherpaw/preloader'
import { createSpeakerTracker } from '@sherpaw/speaker-diarization'
import { createVad, initVADModule } from '@sherpaw/vad'
import { useLocalStorage } from '@vueuse/core'

import { TabsContent, TabsList, TabsRoot, TabsTrigger, TooltipProvider } from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import Button from '../components/Button.vue'
import PanelToggle from '../components/PanelToggle.vue'
import ParameterSlider from '../components/ParameterSlider.vue'
import RadioCards from '../components/RadioCards.vue'
import SandboxLayout from '../components/SandboxLayout.vue'
import SelectField from '../components/SelectField.vue'
import SwitchField from '../components/SwitchField.vue'
import { asrModels } from '../features/asr/catalog'
import { createRecognizer } from '../features/asr/recognizer'
import { startMicrophone } from '../features/audio/microphone'

import { loadTrackerModels } from '../features/speaker-diarization/models'
import { review, reviewerNames } from '../features/speaker-diarization/review'
import { cosine } from '../features/speaker-diarization/speaker-map'
import SpeakerMapView from '../features/speaker-diarization/SpeakerMapView.vue'
import { segmentationDetector, sileroDetector, speechDetectionOptions } from '../features/speaker-diarization/speech-detectors'
import { createTokenTimeline } from '../features/speaker-diarization/token-timeline'
import { changeDetectionDescriptions, embeddingOptions, parameterGroups, presetOptions, presetParameters, presets, speechThresholds, trackerTuning, transcriptDescriptions } from '../features/speaker-diarization/tracker-settings'

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
  /** The words of the tokens that the recognizer heard in this row's audio. */
  transcript?: string
  /** The recognizer heard the whole utterance, so the transcript is final. */
  transcribed?: boolean
  /** Why the utterance ended: a pause (VAD) or a detected speaker change. */
  ended: 'pause' | 'change'
  /** Who the reviewer says spoke. */
  truth?: string
}

/** A person enrolled by name. */
interface KnownSpeaker {
  speaker: number
  name: string
  /** The enrolled speech, kept to enroll the person again after a reset. */
  samples: Float32Array
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
  /** Segmentation changes that the last check found but did not confirm, in samples from the part start. */
  candidates: number[]
}

const sampleRate = 16000
// With embeddings, peek compares the last two 1.5 s windows. So a check every 0.75 s finds only a
// change more than 0.75 s back.
const checkEvery = 0.75 * sampleRate
const minEnrollSeconds = 5
const maxEnrollSeconds = 30
/** The page keeps at most this much enrollment speech per known person when more speech comes. */
const maxKeptSeconds = 60
const colors = ['#2f6f9f', '#c2410c', '#15803d', '#7e22ce', '#b45309', '#0e7490', '#be123c', '#4d7c0f']
// Streaming transducers with endpoint detection. Each utterance ends with a final result. `none` turns
// transcripts off.
const transcriptOptions = [
  ...asrModels.filter(model => model.id !== 'x-asr-fp32').map(model => ({ value: model.id, label: `${model.label} · ${Math.round(model.modelBytes / 1e6)} MB` })),
  { value: 'none', label: 'No transcripts' },
]

const audioFile = useTemplateRef<HTMLInputElement>('audioFile')
const list = useTemplateRef<HTMLOListElement>('list')

const ready = ref(false)
const busy = ref('')
const error = ref('')
const message = ref('Choose the models and parameters on the left and select Initialize. Then start the microphone or test an audio file.')
const asrModel = ref('x-asr')
/** The speaker embedding model. The tracker's thresholds come from tuning with CAM++. */
const embeddingModel = ref<EmbeddingModel>('campplus')
/** What finds speaker changes inside an utterance. */
const changeDetection = ref<'segmentation' | 'embeddings'>('segmentation')
const useSegmentation = computed({
  get: () => changeDetection.value === 'segmentation',
  set: (value: boolean) => changeDetection.value = value ? 'segmentation' : 'embeddings',
})
/** What finds utterances. The segmentation model needs `useSegmentation`. */
const speechDetection = ref<SpeechDetection>('silero')
/** The loaded tracker segments speech with the segmentation model. */
const segmenting = ref(false)
/** The last preset chosen. The sliders mark its values, and "Reset to preset" restores them. */
const lastPreset = ref<Preset>('conversation')
/** Parameters in the settings sidebar. `active` holds the ones that the running VAD and tracker use. */
const parameters = ref<TrackingParameters>(presetParameters('conversation', 'campplus'))
/** The values that the sliders mark: the preset's, with the speech threshold of the chosen detector. */
const defaults = computed(() => ({ ...presetParameters(lastPreset.value, embeddingModel.value), vadThreshold: speechThresholds[speechDetection.value] }))
const applied = ref<string>()
/** Known speakers. The page keeps their enrollment audio to enroll them again in a new tracker. */
const known = ref<KnownSpeaker[]>([])
const enrollName = ref('Owner')
/** Seconds recorded so far while enrolling from the microphone. */
const enrolling = ref<number>()
const listening = ref(false)
const utterances = ref<Utterance[]>([])
const revisionLog = ref<Array<{ after: number, index: number, from: number | null, to: number | null }>>([])
const selected = ref<number>()
// The list follows new utterances while it is scrolled to the bottom.
const following = ref(true)
/** The utterance in progress while the microphone is on: a guess of the speaker and the partial transcript. */
const preview = ref<{ guess?: SpeakerGuess, transcript: string }>()
/** Which side panels are open. This browser keeps the choice. The right panel starts closed on narrow screens. */
const settingsOpen = useLocalStorage('sherpaw:speaker-tracking:settings-open', true)
const insightsOpen = useLocalStorage('sherpaw:speaker-tracking:insights-open', typeof window === 'undefined' || window.innerWidth >= 1280)
/** The tab of the right panel. The page gets the speaker map from the tracker only while the map shows. */
const insightTab = ref<'map' | 'review'>('map')
const insightTabs = [{ value: 'map', label: 'Speaker map' }, { value: 'review', label: 'Review' }]
const speakerMap = shallowRef<SpeakerMap>()
/** The parameters of the running tracker, for the speaker map's explanations. */
const running = shallowRef<TrackingParameters>({ ...parameters.value })

let tracker: SpeakerTracker | undefined
let recognizer: Recognizer | undefined
let detector: UtteranceDetector | undefined
/** The speech detection that the running session uses. */
let activeDetection: SpeechDetection = 'silero'
let vadModule: Awaited<ReturnType<typeof initVADModule>> | undefined
/** The page writes the VAD model file into the VAD module once. A second write fails because the file exists. */
let vadModelLoaded = false
let active: TrackingParameters = { ...parameters.value }
let microphone: AbortController | undefined
let enrollment: { controller: AbortController, chunks: Float32Array[] } | undefined
let playback: AudioContext | undefined
let source: AudioBufferSourceNode | undefined
// Tracker and recognizer each take utterances one at a time, in VAD order.
let labeling = Promise.resolve()
let transcribing = Promise.resolve()
// A transducer token comes 0.05-0.5 s after its speech. At the speaker changes of the four-speaker
// recording, every word went to the right speaker when its time moved back by 0.2 s.
const timeline = createTokenTimeline(sampleRate, 0.2)
/** The utterance in progress, from its start or from the last speaker change in it. */
let part: Part | undefined
/** The last 0.5 s before speech: Silero VAD reports speech about 0.25 s after it starts. */
let leadIn: Float32Array[] = []
/** The last 4 s of audio: the segmentation model reports an utterance 0.5-1.5 s after it starts. */
let recent: Float32Array[] = []
/** Samples fed to the VAD in this session. */
let fed = 0
// Audio blocks are handled one at a time, because speaker checks are asynchronous.
let pipeline = Promise.resolve()
let disposed = false
let generation = 0

const lifetime = new AbortController()

function speakerName(speaker: number | null) {
  if (speaker === null)
    return 'Unknown'

  return known.value.find(entry => entry.speaker === speaker)?.name ?? `Speaker ${speaker + 1}`
}

/** The recognizer found no words: most likely laughter, music or noise that the VAD took for speech. */
function wordless(item: Utterance) {
  return !!recognizer && !!item.transcribed && !item.transcript?.trim()
}

const dirty = computed(() => ready.value && applied.value !== JSON.stringify([parameters.value, embeddingModel.value, changeDetection.value, speechDetection.value]))

/** Triggering workflow: speech detection cards `update` / segmentation switch off -> {@link chooseDetection} -> that detector's default speech threshold. */
function chooseDetection(detection: SpeechDetection) {
  speechDetection.value = detection
  parameters.value.vadThreshold = speechThresholds[detection]
}

/** Triggering workflow: segmentation switch off -> watch -> Silero VAD, which needs no segmentation model. */
watch(useSegmentation, (on) => {
  if (!on && speechDetection.value !== 'silero')
    chooseDetection('silero')
})

/** Whether the models and parameters are exactly those of a preset. */
function matches(preset: Preset) {
  const settings = presets[preset]
  const values = presetParameters(preset, embeddingModel.value)

  return speechDetection.value === settings.speechDetection && useSegmentation.value === settings.useSegmentation
    && (Object.keys(values) as Array<keyof TrackingParameters>).every(key => Math.abs(parameters.value[key] - values[key]) < 1e-9)
}

/** Triggering workflow: preset cards / embedding model change / "Reset to preset" -> {@link applyPreset} -> the preset's models and parameters. */
function applyPreset(preset: Preset) {
  lastPreset.value = preset
  useSegmentation.value = presets[preset].useSegmentation
  speechDetection.value = presets[preset].speechDetection
  parameters.value = presetParameters(preset, embeddingModel.value)
}

/** The preset cards: a preset while the settings match it, "custom" after any change. */
const preset = computed<Preset | 'custom'>({
  get: () => (matches(lastPreset.value) ? lastPreset.value : (Object.keys(presets) as Preset[]).find(matches) ?? 'custom'),
  set: (value) => {
    if (value !== 'custom')
      applyPreset(value)
  },
})

/** Triggering workflow: embedding model cards `update` -> watch -> the last preset's parameters for that model. */
watch(embeddingModel, () => applyPreset(lastPreset.value))

/** Triggering workflow: "Reset to preset" button -> {@link restoreDefaults} -> the last preset. */
function restoreDefaults() {
  applyPreset(lastPreset.value)
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

/** The row continues the previous row's speaker, for example after a cut inside one person's speech. It sits closer to that row. */
function continued(item: Utterance) {
  const previous = utterances.value[item.index - 1]

  return !!previous?.emitted && !!item.emitted && previous.speaker === item.speaker && !wordless(previous) && !wordless(item)
}

/** The speaker a row shows: none for a row without words, which is most likely not speech. */
function shownSpeaker(item: Utterance) {
  return wordless(item) ? null : item.speaker
}

function verdict(item: Utterance) {
  if (!item.truth || item.speaker === null)
    return ''

  return result.value.mapping.get(item.speaker) === item.truth ? '✓' : '✗'
}

/** Triggering workflow: sidebar "Initialize" button `click` -> {@link loadModel} -> Silero VAD, speaker tracker and optional recognizer. */
async function loadModel() {
  busy.value = 'load'
  error.value = ''

  try {
    message.value = 'Loading models…'

    vadModule = await initVADModule()
    ;[recognizer] = await Promise.all([
      asrModel.value !== 'none' ? createRecognizer({ modelId: asrModel.value, backend: 'cpu' }, status => message.value = status) : undefined,
      setupTracking(),
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

function createUtteranceVad(module: NonNullable<typeof vadModule>, threshold: number) {
  return createVad(module, {
    sileroVad: { model: '/silero-vad.onnx', threshold, minSilenceDuration: active.vadSilence, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: 512 },
    sampleRate,
    bufferSizeInSeconds: 60,
  })
}

/**
 * Triggering workflow: {@link loadModel} / {@link applyParameters} -> {@link setupTracking} -> VAD and
 * speaker tracker with the form's parameters. The new tracker enrolls the known speakers again.
 */
async function setupTracking() {
  const models = await loadTrackerModels({ segmentation: changeDetection.value === 'segmentation', embedding: embeddingModel.value })

  lifetime.signal.throwIfAborted()
  active = { ...parameters.value }
  running.value = active

  if (!vadModelLoaded) {
    loadData({ module: vadModule!, data: models.vad.data, metadata: models.vad.metadata })
    vadModelLoaded = true
  }

  detector?.free()
  detector = undefined
  tracker?.dispose()
  tracker = undefined
  tracker = await createSpeakerTracker({ model: models.embedding, segmentation: models.segmentation && { data: models.segmentation.data }, tuning: trackerTuning(active), signal: lifetime.signal })
  detector = speechDetection.value === 'segmentation' && models.segmentation
    ? segmentationDetector(tracker, { threshold: active.vadThreshold, minSilenceSeconds: active.vadSilence })
    : sileroDetector(createUtteranceVad(vadModule!, active.vadThreshold))
  activeDetection = speechDetection.value === 'segmentation' && models.segmentation ? 'segmentation' : 'silero'

  for (const entry of known.value)
    entry.speaker = await tracker.enroll(entry.samples, sampleRate)

  segmenting.value = !!models.segmentation
  applied.value = JSON.stringify([parameters.value, embeddingModel.value, changeDetection.value, speechDetection.value])
}

/** Triggering workflow: sidebar "Apply" button -> {@link applyParameters} -> {@link setupTracking} and a new session. */
async function applyParameters() {
  busy.value = 'apply'
  error.value = ''

  try {
    message.value = 'Applying the parameters…'
    await setupTracking()
    await newSession()
    message.value = 'Parameters applied. A new session started.'
  }
  catch (cause) {
    reportError(cause)
    message.value = 'Could not apply the parameters.'
  }
  finally {
    busy.value = ''
  }
}

/** Speech of a recording: the VAD segments of it, joined. */
function speechOf(samples: Float32Array): Float32Array {
  // Silero VAD at its own threshold: the speech threshold may belong to the segmentation model.
  const detector = createUtteranceVad(vadModule!, activeDetection === 'segmentation' ? speechThresholds.silero : active.vadThreshold)
  const segments: Float32Array[] = []

  try {
    for (let offset = 0; offset < samples.length; offset += 512)
      detector.acceptWaveform(samples.subarray(offset, offset + 512))

    detector.flush()

    while (!detector.isEmpty()) {
      segments.push(detector.front().samples)
      detector.pop()
    }
  }
  finally {
    detector.free()
  }

  return concat(segments)
}

/** Triggering workflow: enroll buttons -> {@link enroll} -> tracker.enroll -> known speaker with a name. */
async function enroll(samples: Float32Array) {
  if (samples.length < minEnrollSeconds * sampleRate) {
    error.value = `Enrollment needs at least ${minEnrollSeconds} s of speech; this audio has ${(samples.length / sampleRate).toFixed(1)} s.`

    return
  }

  error.value = ''

  const name = enrollName.value.trim()
  const existing = name ? known.value.find(entry => entry.name === name) : undefined

  try {
    if (existing) {
      await addToKnown(existing, samples)
      message.value = `Added this voice to ${name}. A new session started, so that the tracker recognizes ${name} from the start.`

      return
    }

    const speaker = await tracker!.enroll(samples, sampleRate)

    known.value.push({ speaker, name: name || `Speaker ${speaker + 1}`, samples })
    message.value = `Enrolled ${name || `Speaker ${speaker + 1}`}. Rows already shown keep their labels. Start a new session to use the name from the start.`
  }
  catch (cause) {
    reportError(cause)
  }
}

/**
 * More speech of a known person: one enrollment from all of their audio, instead of a second person
 * with the same name. The tracker enrolls everyone again, so the session restarts.
 */
async function addToKnown(entry: KnownSpeaker, samples: Float32Array) {
  // A trial enrollment of the new audio alone, to compare it with the person. The combined audio keeps
  // only its main voice. So the enrollment would drop another voice, or use it instead if it is longer.
  const trial = await tracker!.enroll(samples, sampleRate)
  const earlier = entry.samples
  let similarity = 0

  try {
    const { speakers } = await tracker!.inspect()
    const embedding = (speaker: number) => speakers.find(item => item.speaker === speaker)!.embedding

    similarity = cosine(embedding(entry.speaker), embedding(trial))

    if (similarity >= active.enrollThreshold)
      entry.samples = concat([earlier, samples]).slice(-maxKeptSeconds * sampleRate)

    // Enrolling everyone again also removes the trial enrollment.
    await enrollKnown()
  }
  catch (cause) {
    entry.samples = earlier
    await enrollKnown()
    throw cause
  }
  finally {
    await newSession()
    // The caller replaces this message when the new audio becomes part of the enrollment.
    message.value = `${entry.name} keeps the earlier enrollment. A new session started.`
  }

  if (entry.samples === earlier)
    throw new Error(`This voice does not sound like ${entry.name}: the similarity is ${similarity.toFixed(2)}, below the known speaker threshold ${active.enrollThreshold}. Enroll it under another name.`)
}

/** Enrolls every known person again, numbered 0, 1, ... in list order. */
async function enrollKnown() {
  await tracker!.reset({ forgetEnrolled: true })

  for (const entry of known.value)
    entry.speaker = await tracker!.enroll(entry.samples, sampleRate)
}

/** The enrollment buttons add to a known person when a known person already has the name. */
const enrollsKnown = computed(() => known.value.some(entry => entry.name === enrollName.value.trim()))

/** Triggering workflow: "Enroll with microphone" button -> {@link startEnrollment} -> up to 30 s of microphone audio. */
async function startEnrollment() {
  const controller = new AbortController()

  enrollment = { controller, chunks: [] }
  enrolling.value = 0
  error.value = ''

  try {
    await startMicrophone(controller.signal, (samples, rate) => {
      if (rate !== sampleRate || !enrollment)
        return

      enrollment.chunks.push(samples.slice())
      enrolling.value = (enrolling.value ?? 0) + samples.length / sampleRate

      if (enrolling.value >= maxEnrollSeconds)
        void finishEnrollment()
    }, { sampleRate })
  }
  catch (cause) {
    if (!controller.signal.aborted)
      reportError(cause)

    enrollment = undefined
    enrolling.value = undefined
  }
}

/** Triggering workflow: "Stop and enroll" button / 30 s limit -> {@link finishEnrollment} -> VAD speech -> {@link enroll}. */
async function finishEnrollment() {
  const current = enrollment

  if (!current)
    return

  enrollment = undefined
  enrolling.value = undefined
  current.controller.abort()
  await enroll(speechOf(concat(current.chunks)))
}

/** Triggering workflow: "Forget known speakers" button -> {@link forgetKnown} -> tracker.reset without enrollments. */
async function forgetKnown() {
  known.value = []

  try {
    await tracker?.reset({ forgetEnrolled: true })
    await newSession()
  }
  catch (cause) {
    reportError(cause)
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
  void refreshMap()
}

/** Triggering workflow: {@link label} / speaker map tab / {@link newSession} -> {@link refreshMap} -> tracker.inspect -> speaker map. */
async function refreshMap() {
  if (!insightsOpen.value || insightTab.value !== 'map' || !tracker)
    return

  const session = generation

  try {
    const map = await tracker.inspect()

    if (!disposed && session === generation)
      speakerMap.value = map
  }
  catch (cause) {
    reportError(cause)
  }
}

/** Triggering workflow: right panel toggle or tab `update` -> watch -> speaker map refresh. */
watch([insightsOpen, insightTab], () => void refreshMap())

/** Triggering workflow: speaker map dot `click` -> {@link selectUtterance} -> the row selected in the transcript. */
function selectUtterance(index: number) {
  selected.value = index
  following.value = false
  void nextTick(() => list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' }))
}

/** Triggering workflow: recognizer reply / new row -> {@link placeTokens} -> the words of the open rows and of the preview. */
function placeTokens() {
  if (!recognizer)
    return

  const rows = utterances.value
  const open = rows.findIndex(row => !row.transcribed)
  // Only open rows change. The row before them can still get the final mark of its sentence.
  const from = Math.max(0, (open < 0 ? rows.length : open) - 1)
  const last = rows.at(-1)
  // A cut commits rows before `part` moves on, so the live words start where the rows end.
  const liveFrom = part && Math.max(part.start, last ? Math.round((last.start + last.seconds) * sampleRate) : 0)
  const placed = timeline.place(recognizer.tokens(), rows.slice(from).map(row => Math.round(row.start * sampleRate)), liveFrom)

  placed.rows.forEach((words, i) => {
    const row = rows[from + i]!

    if (row.transcript !== words)
      row.transcript = words
  })

  if (preview.value)
    preview.value.transcript = placed.live
}

/**
 * Triggering workflow: {@link endUtterance} -> {@link finishTranscript} -> recognizer.accept of 2 s of
 * silence -> the last words of the utterance, and its rows marked as transcribed.
 */
function finishTranscript(rows: number, session: number) {
  if (!recognizer)
    return

  // The recognizer's endpoint rule needs 0.8 s of trailing silence. The 480 ms X-ASR chunks also come
  // late, so 1 s was not always enough.
  timeline.pause(2 * sampleRate)
  transcribing = transcribing.then(async () => {
    await recognizer!.accept(new Float32Array(2 * sampleRate))

    if (disposed || session !== generation)
      return

    placeTokens()
    utterances.value.slice(0, rows).forEach(row => row.transcribed = true)
  }).catch(reportError)
}

/** A copy of the samples between two positions of audio that arrived in chunks. */
function range(chunks: Float32Array[], from: number, to: number) {
  const audio = new Float32Array(Math.max(0, to - from))
  let at = 0

  for (const chunk of chunks) {
    const a = Math.max(from, at)
    const b = Math.min(to, at + chunk.length)

    if (b > a)
      audio.set(chunk.subarray(a - at, b - at), a - from)

    at += chunk.length

    if (at >= to)
      break
  }

  return audio
}

function concat(chunks: Float32Array[]) {
  return range(chunks, 0, chunks.reduce((sum, chunk) => sum + chunk.length, 0))
}

/** Triggering workflow: {@link handle} / {@link commit} -> {@link send} -> recognizer tokens for the part's audio before `to`. */
function send(current: Part, to: number) {
  if (!recognizer || to <= current.sent)
    return

  const audio = range(current.chunks, current.sent, to)
  const session = generation

  timeline.hear(current.start + current.sent, audio.length)
  current.sent = to
  transcribing = transcribing.then(async () => {
    await recognizer!.accept(audio)

    if (!disposed && session === generation)
      placeTokens()
  }).catch(reportError)
}

/** Triggering workflow: speaker change or VAD utterance end -> {@link commit} -> queued {@link label} and {@link transcribe} for the part's audio before `to`. */
function commit(current: Part, to: number, ended: Utterance['ended']) {
  const session = generation

  send(current, to)

  const count = utterances.value.push({
    index: utterances.value.length,
    start: current.start / sampleRate,
    seconds: to / sampleRate,
    samples: range(current.chunks, 0, to),
    speaker: null,
    revisions: [],
    transcript: recognizer ? '' : undefined,
    ended,
  })
  // Mutate through the reactive array so the row updates.
  const item = utterances.value[count - 1]!

  labeling = labeling.then(() => label(item, session)).catch(reportError)
  placeTokens()
}

/** Triggering workflow: {@link check} / {@link handle} at an utterance end -> {@link split} -> {@link commit} of the part before `at`. Returns the rest. */
function split(current: Part, at: number): Part {
  commit(current, at, 'change')

  const rest = range(current.chunks, at, current.length)

  return {
    start: current.start + at,
    chunks: [rest],
    length: rest.length,
    sent: Math.max(0, current.sent - at),
    checked: Math.max(0, current.checked - at),
    candidates: current.candidates.filter(position => position > at).map(position => position - at),
  }
}

/** Cuts the part at each change, given in samples from the part start. */
function splitAll(current: Part, changes: number[], minBefore: number): Part {
  let rest = current
  let done = 0

  for (const at of changes) {
    if (at - done < minBefore)
      continue

    rest = split(rest, at - done)
    done = at
  }

  return rest
}

/** Segmentation cuts plus a window change, in samples from the part start, in order. */
function cutsOf(segmentation: number[], windowChange: number | undefined, from: number): number[] {
  const cuts = windowChange === undefined ? segmentation : [...segmentation, from + Math.round(windowChange * sampleRate)]

  return cuts.sort((a, b) => a - b)
}

/** Triggering workflow: {@link handle} every 0.75 s of speech -> {@link check} -> tracker.peek -> speaker guess, and cuts at speaker changes. */
async function check(current: Part, session: number) {
  // The segmentation model looks at the audio since the last cut. The embedding check looks at its last 3 s.
  const from = segmenting.value ? 0 : Math.max(0, current.length - 3 * sampleRate)

  current.checked = current.length

  const guess = await tracker!.peek(range(current.chunks, from, current.length), sampleRate)

  if (session !== generation)
    return current

  // Cut at both kinds of change. Cut at a change between the last two 1.5 s windows immediately. Cut
  // at a segmentation change when two consecutive checks find it within `confirmSeconds` (0.25 s by
  // default). On fast turn-taking (VoxConverse talk shows), cutting at both labeled 83.0% of the
  // speech correctly. Confirmed segmentation changes alone gave 79.7%, and window changes alone 80.6%.
  // Near the end of a window, the model's output changes from check to check. On AliMeeting, AMI and
  // MagicData conversations, the confirmation removed 35%-41% of the cuts inside one speaker's speech.
  // It also cut out 4-7 percentage points fewer short interjections. The page drops a cut closer than
  // `minPieceSeconds` to the previous cut or to the start of the part.
  const found = guess.changes.map(change => from + Math.round(change * sampleRate))
  const confirmed = found.filter(at => current.candidates.some(position => Math.abs(at - position) <= active.confirmSeconds * sampleRate))

  current.candidates = found.filter(at => at > (confirmed.at(-1) ?? -1))

  const rest = splitAll(current, cutsOf(confirmed, guess.windowChange, from), active.minPieceSeconds * sampleRate)

  preview.value = { transcript: preview.value?.transcript ?? '', guess }

  return rest
}

/** Audio between two sample positions from the last 4 s. Positions count the samples fed since the session start. */
function recentAudio(from: number, to: number) {
  const offset = fed - recent.reduce((sum, chunk) => sum + chunk.length, 0)

  return range(recent, Math.max(0, from - offset), Math.max(0, to - offset))
}

/** Triggering workflow: {@link handle} -> {@link endUtterance} -> final speaker check and commit of the part up to the segment end. */
async function endUtterance(segment: SpeechSegment, session: number) {
  // Normally the part holds the segment. It also holds the trailing silence that ended it.
  const current = part ?? { start: segment.start, chunks: [segment.samples], length: segment.samples.length, sent: 0, checked: 0, candidates: [] }
  const end = Math.min(current.length, segment.start + segment.samples.length - current.start)

  if (end > 0 && segmenting.value) {
    // The utterance is complete: changes near its end count now, without confirmation.
    const guess = await tracker!.peek(range(current.chunks, 0, end), sampleRate, { final: true })

    if (session !== generation)
      return false

    const rest = splitAll(current, cutsOf(guess.changes.map(change => Math.round(change * sampleRate)), guess.windowChange, 0), active.minPieceSeconds * sampleRate)

    commit(rest, end - (current.length - rest.length), 'pause')
  }
  else if (end > 0) {
    commit(current, end, 'pause')
  }

  part = undefined
  leadIn = []
  preview.value = undefined
  finishTranscript(utterances.value.length, session)

  return true
}

/** Triggering workflow: {@link feed} -> {@link handle} -> speech detector, speaker checks, recognizer audio and utterance commits. */
async function handle(block: Float32Array | undefined, session: number) {
  const speech = detector

  if (disposed || !speech || session !== generation)
    return

  const ended = block ? await speech.accept(block) : await speech.flush()

  if (session !== generation)
    return

  if (block) {
    fed += block.length
    recent.push(block)

    while (recent.length * block.length > 4 * sampleRate)
      recent.shift()
  }

  // A late detector (the segmentation model) can end one utterance and start the next in one block:
  // the ended one goes first.
  for (const segment of ended) {
    if (!await endUtterance(segment, session))
      return
  }

  if (!block)
    return

  if (speech.speaking()) {
    // The part holds decided audio only: speaker checks never look past a possible utterance end.
    const until = speech.decided()

    if (!part) {
      const start = speech.speechStart()

      if (start === undefined) {
        const lead = leadIn.splice(0)
        const length = lead.reduce((sum, chunk) => sum + chunk.length, 0)

        part = { start: until - block.length - length, chunks: lead, length, sent: 0, checked: 0, candidates: [] }
      }
      else {
        // The detector found the start late: the audio since then is in the last 4 s.
        const oldest = fed - recent.reduce((sum, chunk) => sum + chunk.length, 0)

        part = { start: Math.max(start, oldest), chunks: [], length: 0, sent: 0, checked: 0, candidates: [] }
      }

      preview.value = { transcript: '' }
    }

    const piece = recentAudio(part.start + part.length, until)

    part.chunks.push(piece)
    part.length += piece.length

    if (part.length - part.checked >= checkEvery) {
      const next = await check(part, session)

      if (session !== generation)
        return

      part = next
    }

    // The token times put the words of a later cut into the right row.
    send(part, part.length)
  }
  else if (!part) {
    leadIn.push(block)

    while (leadIn.length * block.length > sampleRate / 2)
      leadIn.shift()
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
  detector?.reset()
  utterances.value = []
  revisionLog.value = []
  selected.value = undefined
  following.value = true
  part = undefined
  leadIn = []
  recent = []
  fed = 0
  timeline.reset()
  preview.value = undefined
  speakerMap.value = undefined
  await tracker?.reset()
  // The tracker numbers known speakers 0, 1, ... in enrollment order in every new session.
  known.value.forEach((entry, i) => entry.speaker = i)
  await refreshMap()
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

  // The settings sidebar and the select list handle their own keys, for example arrows on a slider.
  if (event.altKey || event.ctrlKey || event.metaKey || target?.closest('input, select, textarea, aside, [role="listbox"]') || !utterances.value.length)
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
  enrollment?.controller.abort()
  lifetime.abort()
  tracker?.dispose()
  void recognizer?.dispose().catch(() => {})
  detector?.free()
  source?.stop()
  void playback?.close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(dispose)
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <SandboxLayout title="Speaker tracking" class="md:h-dvh">
      <div w-full grow min-h-0 flex="~ col md:row" class="border-t border-neutral-200">
        <!-- The wrapper animates its width; the panel keeps its own width so that its content does not reflow. -->
        <div class="side-panel side-panel-left" :class="{ closed: !settingsOpen }" :inert="!settingsOpen" flex shrink-0 min-h-0>
          <aside id="settings-panel" aria-label="Models and parameters" w-full shrink-0 flex="~ col" class="md:w-80 lg:w-96 md:min-h-0 md:border-r border-neutral-200 bg-neutral-50">
            <div grow p-4 flex="~ col gap-7" class="md:overflow-y-auto">
              <section flex="~ col gap-4" aria-labelledby="preset-heading">
                <h2 id="preset-heading" text-xs font-bold uppercase tracking-wider text-neutral-500>
                  Preset
                </h2>
                <RadioCards v-model="preset" label="Use case" :options="presetOptions" :disabled="!!busy || listening" description="A preset sets the models and parameters below. Changing any of them switches to Custom." />
              </section>
              <section flex="~ col gap-4" aria-labelledby="models-heading">
                <h2 id="models-heading" text-xs font-bold uppercase tracking-wider text-neutral-500>
                  Models
                </h2>
                <SelectField
                  v-model="asrModel" label="Transcripts" :options="transcriptOptions" :disabled="ready || !!busy"
                  :description="`${transcriptDescriptions[asrModel] ?? ''} To change it later, reload the page.`"
                />
                <RadioCards
                  v-model="embeddingModel" label="Speaker embedding" :options="embeddingOptions" :disabled="!!busy || listening"
                  description="Changing the model resets the parameters below to the preset's values for it."
                />
                <SwitchField
                  v-model="useSegmentation" label="Segmentation model" :disabled="!!busy || listening"
                  :description="changeDetectionDescriptions[changeDetection]"
                />
                <RadioCards
                  :model-value="speechDetection" label="Speech detection" :options="speechDetectionOptions" :disabled="!!busy || listening || !useSegmentation"
                  :description="useSegmentation ? undefined : 'Turn on the segmentation model to use it.'"
                  @update:model-value="chooseDetection"
                />
                <p text-xs text-neutral-500>
                  Downloads: VAD 2.3 MB · speaker embedding {{ embeddingModel === 'campplus' ? 28 : 71 }} MB{{ useSegmentation ? ' · segmentation 20 MB' : '' }}.
                </p>
              </section>
              <section v-for="group in parameterGroups" :key="group.title" flex="~ col gap-4" :aria-label="group.title">
                <h2 text-xs font-bold uppercase tracking-wider text-neutral-500>
                  {{ group.title }}
                </h2>
                <ParameterSlider
                  v-for="field in group.fields" :key="field.key" v-model="parameters[field.key]"
                  :label="field.label" :help="field.help" :min="field.min" :max="field.max" :step="field.step" :unit="field.unit"
                  :default-value="defaults[field.key]"
                  :disabled="!!busy || listening || (field.segmentation && !useSegmentation)"
                  :disabled-reason="field.segmentation && !useSegmentation ? 'Needs the segmentation model.' : undefined"
                />
              </section>
              <section flex="~ col gap-3" aria-labelledby="known-heading">
                <h2 id="known-heading" text-xs font-bold uppercase tracking-wider text-neutral-500>
                  Known speakers
                </h2>
                <p text-xs text-neutral-500>
                  Record one person talking alone for {{ minEnrollSeconds }}–{{ maxEnrollSeconds }} s, or enroll a selected row of at least {{ minEnrollSeconds }} s. They then show their name from their first utterance. Use a new name for each person; the same name adds more speech to that person.
                </p>
                <div flex="~ wrap gap-1.5" text-sm>
                  <span v-if="!known.length" text-neutral-500>None yet.</span>
                  <span v-for="entry in known" :key="entry.speaker" rounded-full px-2 py-0.5 text-white :style="{ background: color(entry.speaker) }">
                    {{ entry.name }} · {{ (entry.samples.length / sampleRate).toFixed(0) }} s
                  </span>
                </div>
                <label flex="~ col gap-1.5">
                  <span text-sm font-semibold>Name of the next known speaker</span>
                  <input
                    v-model="enrollName" placeholder="Name" rounded-lg px-3 py-2 text-sm bg-white
                    class="border border-neutral-300 outline-none hover:border-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-400"
                  >
                </label>
                <div flex="~ wrap gap-2" text-sm>
                  <Button v-if="enrolling === undefined" :disabled="!ready || !!busy || listening" @click="startEnrollment">
                    {{ enrollsKnown ? `Add microphone speech to "${enrollName.trim()}"` : 'Enroll with microphone' }}
                  </Button>
                  <Button v-else @click="finishEnrollment">
                    Stop and enroll ({{ enrolling.toFixed(0) }} s)
                  </Button>
                  <Button v-if="known.length" :disabled="!!busy || listening" @click="forgetKnown">
                    Forget known speakers
                  </Button>
                </div>
                <p v-if="!ready" text-xs text-neutral-500>
                  Available after initialization.
                </p>
              </section>
            </div>
            <div shrink-0 p-4 flex="~ col gap-2" class="border-t border-neutral-200 bg-white">
              <p text-xs text-neutral-500>
                {{ !ready ? 'Initialize loads the models with these settings.' : dirty ? 'Apply restarts the session with the new settings.' : 'The running session uses these settings.' }}
              </p>
              <div flex="~ items-center justify-between gap-2" text-sm>
                <Button :disabled="!!busy || listening" @click="restoreDefaults">
                  Reset to preset
                </Button>
                <Button v-if="!ready" :disabled="!!busy" @click="loadModel">
                  {{ busy === 'load' ? 'Loading…' : 'Initialize' }}
                </Button>
                <Button v-else :disabled="!!busy || listening || !dirty" @click="applyParameters">
                  {{ busy === 'apply' ? 'Applying…' : dirty ? 'Apply' : 'Applied' }}
                </Button>
              </div>
            </div>
          </aside>
        </div>

        <main grow min-w-0 min-h-0 flex="~ col gap-4" p-4>
          <div flex="~ wrap items-center gap-3" text-sm>
            <PanelToggle v-model="settingsOpen" controls="settings-panel" side="left" label="settings" />
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
            <span grow aria-hidden="true" />
            <PanelToggle v-model="insightsOpen" controls="insights-panel" side="right" label="speaker map and review" />
          </div>
          <p role="status" text-sm text-neutral-500>
            {{ message }}
          </p>
          <p v-if="error" role="alert" text-sm text-red-600>
            {{ error }}
          </p>
          <div grow min-h-0 flex="~ col" text-sm>
            <div v-if="!utterances.length && !preview" grow flex="~ col items-center justify-center gap-4" p-4 text-center>
              <h1 text-3xl md:text-5xl font-semibold>
                Speaker tracking
              </h1>
              <p max-w-xl text-base text-neutral-500>
                The page numbers speakers as they appear. Each label comes with a confidence, and later audio can revise earlier labels. Audio stays on this device.
              </p>
            </div>
            <section v-else grow min-h-0 flex="~ col gap-2" aria-label="Utterances">
              <ol ref="list" grow min-h-0 overflow-y-auto flex="~ col gap-1" pr-2 class="max-h-[70dvh] md:max-h-none" @scroll="onScroll">
                <li
                  v-for="item in utterances" :key="item.index" class="row-in"
                  :aria-selected="item.index === selected" rounded-lg px-3 cursor-pointer
                  :class="[item.index === selected ? 'bg-neutral-100' : 'hover:bg-neutral-50', continued(item) ? 'pt-0 pb-2 -mt-1' : 'py-2']"
                  @click="selected = item.index"
                >
                  <div flex="~ items-baseline gap-3">
                    <span w-3 h-3 rounded-full shrink-0 :style="{ background: color(shownSpeaker(item)) }" />
                    <span w-28 shrink-0 font-semibold :style="{ color: color(shownSpeaker(item)) }">
                      {{ wordless(item) ? '—' : item.emitted ? speakerName(item.speaker) : '…' }}{{ !wordless(item) && item.speaker !== null && result.mapping.get(item.speaker) ? ` = ${result.mapping.get(item.speaker)}` : '' }}
                    </span>
                    <p v-if="wordless(item)" grow-1 text-base text-neutral-400 italic>
                      No words recognized (laughter, music or noise?)
                    </p>
                    <p v-else grow-1 text-base>
                      {{ item.transcript || (recognizer && !item.transcribed ? '…' : '') }}
                    </p>
                    <span shrink-0 text-xs text-neutral-500 tabular-nums>{{ time(item.start) }}</span>
                  </div>
                  <div flex="~ wrap gap-x-3" pl-6 text-xs text-neutral-500>
                    <span v-if="item.emitted && !wordless(item)" :class="item.emitted.confidence === 'high' ? 'text-green-700' : item.emitted.confidence === 'medium' ? 'text-amber-700' : 'text-red-700'">
                      {{ item.emitted.confidence }} {{ item.emitted.score.toFixed(2) }}
                    </span>
                    <span tabular-nums>{{ item.seconds.toFixed(1) }} s</span>
                    <span v-if="item.emitted?.pending && !wordless(item)">new speaker?</span>
                    <span v-if="item.emitted?.mixed && !wordless(item)">+ another speaker</span>
                    <span v-if="item.emitted?.overlap && !wordless(item)">+ overlapping speech</span>
                    <span v-if="item.revisions.length && !wordless(item)">revised ↺</span>
                    <span v-if="item.truth" font-semibold text-neutral-800>label {{ item.truth }} {{ verdict(item) }}</span>
                  </div>
                  <div v-if="item.index === selected" pl-6 pt-2 flex="~ col gap-2">
                    <p v-if="item.emitted">
                      When it ended ({{ item.ended === 'change' ? 'speaker change' : 'pause' }}): <b>{{ speakerName(item.emitted.speaker) }}</b>, {{ item.emitted.confidence }} ({{ item.emitted.score.toFixed(2) }}). Now: <b>{{ speakerName(item.speaker) }}</b>.{{ wordless(item) ? ' The row shows no speaker because the recognizer found no words.' : '' }}
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
                      <Button ml-2 :disabled="!!busy || item.seconds < minEnrollSeconds" :title="item.seconds < minEnrollSeconds ? `Needs at least ${minEnrollSeconds} s` : ''" @click.stop="enroll(item.samples)">
                        {{ enrollsKnown ? `Add this voice to "${enrollName.trim()}"` : `Enroll this voice as "${enrollName.trim() || 'a new speaker'}"` }}
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
          </div>
        </main>

        <div class="side-panel side-panel-right" :class="{ closed: !insightsOpen }" :inert="!insightsOpen" flex="~ justify-end" shrink-0 min-h-0>
          <aside id="insights-panel" aria-label="Speaker map and review" w-full shrink-0 min-h-0 flex="~ col" text-sm class="md:w-80 xl:w-96 md:border-l border-neutral-200 bg-neutral-50">
            <TabsRoot v-model="insightTab" grow min-h-0 flex="~ col gap-3" p-4>
              <TabsList flex="~ gap-5" class="border-b border-neutral-200" aria-label="Panels">
                <TabsTrigger
                  v-for="tab in insightTabs" :key="tab.value" :value="tab.value"
                  pb-1.5 text-neutral-500 hover:text-neutral-900
                  class="-mb-px border-b-2 border-transparent outline-none focus-visible:ring-2 focus-visible:ring-neutral-400
                  data-[state=active]:border-neutral-800 data-[state=active]:text-neutral-900 data-[state=active]:font-semibold"
                >
                  {{ tab.label }}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="map" grow min-h-0 overflow-y-auto>
                <SpeakerMapView
                  :map="speakerMap" :selected="selected" :merge-threshold="running.mergeThreshold"
                  :color-of="color" :name-of="speakerName" @select="selectUtterance"
                />
              </TabsContent>
              <TabsContent value="review" grow min-h-0 overflow-y-auto flex="~ col gap-2">
                <p>Labeled {{ result.labeled }} of {{ utterances.length }} utterances. To label who spoke, select a row and press A–{{ reviewerNames.at(-1) }}.</p>
                <p>When they ended: {{ result.emittedCorrect }} correct ({{ percentage(result.emittedCorrect, result.labeled) }})</p>
                <p>After revisions: {{ result.finalCorrect }} correct ({{ percentage(result.finalCorrect, result.labeled) }})</p>
                <p>Revisions on labeled utterances: {{ result.fixed }} fixed, {{ result.broken }} broke a correct label.</p>
                <h3 font-semibold mt-2>
                  Revision log ({{ revisionLog.length }})
                </h3>
                <ol text-neutral-600 tabular-nums>
                  <li v-for="(entry, i) in revisionLog" :key="i">
                    After #{{ entry.after }}: #{{ entry.index }} {{ speakerName(entry.from) }} → {{ speakerName(entry.to) }}
                  </li>
                </ol>
              </TabsContent>
            </TabsRoot>
          </aside>
        </div>
      </div>
    </SandboxLayout>
  </TooltipProvider>
</template>

<style scoped>
.side-panel {
  overflow: hidden;
  transition: width 240ms ease, opacity 240ms ease, visibility 0s linear 0s;
}

.side-panel.closed {
  opacity: 0;
  visibility: hidden;
  transition: width 240ms ease, opacity 240ms ease, visibility 0s linear 240ms;
}

@media (min-width: 768px) {
  .side-panel-left,
  .side-panel-right {
    width: 20rem;
  }

  .side-panel.closed {
    width: 0;
  }
}

@media (min-width: 1024px) {
  .side-panel-left {
    width: 24rem;
  }
}

@media (min-width: 1280px) {
  .side-panel-right {
    width: 24rem;
  }
}

@media (max-width: 767px) {
  .side-panel.closed {
    display: none;
  }
}

/* New rows fade in and rise slightly. */
.row-in {
  animation: row-in 220ms ease-out;
}

@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .side-panel,
  .side-panel.closed {
    transition: none;
  }

  .row-in {
    animation: none;
  }
}
</style>
