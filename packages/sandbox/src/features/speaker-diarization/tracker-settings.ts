import type { SpeakerTrackerTuning } from '@sherpaw/speaker-diarization'

import { defaultSpeakerTrackerTuning } from '@sherpaw/speaker-diarization'

import type { EmbeddingModel } from './models'
import type { SpeechDetection } from './speech-detectors'

// Short user-facing help.

/** The speaker embedding models, as cards. */
export const embeddingOptions: Array<{ value: EmbeddingModel, title: string, detail: string }> = [
  { value: 'campplus', title: 'CAM++ · 28 MB', detail: 'Chinese and English. Use this one unless you have a reason not to.' },
  { value: 'eres2netv2', title: 'ERes2NetV2 · 71 MB', detail: 'Chinese only and slower. Try it for Chinese conversations.' },
]

export const changeDetectionDescriptions: Record<'segmentation' | 'embeddings', string> = {
  segmentation: 'Finds speaker changes inside an utterance, including short interjections, and marks overlapping speech. Adds a 20 MB download.',
  embeddings: 'Off: only speaker embeddings find changes inside an utterance, so turns shorter than about 1.5 s stay merged.',
}

/** Transcript choices. `none` turns the recognizer off. */
export const transcriptDescriptions: Record<string, string> = {
  'x-asr': 'Chinese and English, with punctuation.',
  'zipformer-zh': 'Chinese only.',
  'zipformer-multilingual': 'Arabic, Chinese, English, Indonesian, Japanese, Russian, Thai and Vietnamese.',
  'none': 'Speaker labels only.',
}

/** Parameters of the page itself: speech detection, and how segmentation changes become cuts. */
export interface PageParameters {
  vadThreshold: number
  vadSilence: number
  confirmSeconds: number
  minPieceSeconds: number
}

export type TrackingParameters = PageParameters & SpeakerTrackerTuning

export const defaultPageParameters: Readonly<PageParameters> = Object.freeze({ vadThreshold: 0.5, vadSilence: 0.5, confirmSeconds: 0.25, minPieceSeconds: 0.5 })

/** The tracker's part of the parameters. */
export function trackerTuning(parameters: TrackingParameters): SpeakerTrackerTuning {
  return Object.fromEntries(Object.keys(defaultSpeakerTrackerTuning).map(key => [key, parameters[key as keyof SpeakerTrackerTuning]])) as unknown as SpeakerTrackerTuning
}

/** Tracker defaults for an embedding model: CAM++ uses the library defaults. */
export function tuningFor(model: EmbeddingModel): SpeakerTrackerTuning {
  return model === 'eres2netv2' ? { ...defaultSpeakerTrackerTuning, clusterThreshold: 0.5 } : { ...defaultSpeakerTrackerTuning }
}

/** Default speech thresholds: with the segmentation model, 0.8 gave about as many false alarms as Silero VAD at 0.5. */
export const speechThresholds: Record<SpeechDetection, number> = { silero: 0.5, segmentation: 0.8 }

/** All page and tracker defaults for an embedding model and a speech detector. */
export function defaultsFor(model: EmbeddingModel, detection: SpeechDetection): TrackingParameters {
  return { ...defaultPageParameters, vadThreshold: speechThresholds[detection], ...tuningFor(model) }
}

export type Preset = 'conversation' | 'media'

export const presetOptions: Array<{ value: Preset | 'custom', title: string, detail: string }> = [
  { value: 'conversation', title: 'Conversation', detail: 'Voice agents, calls and meetings. A new voice shows as "new speaker?" until the tracker knows it.' },
  { value: 'media', title: 'Films and TV', detail: 'Finds speech under music and sound effects. Utterances end about 1 s later.' },
  { value: 'custom', title: 'Custom', detail: 'Your own settings below.' },
]

/**
 * Both presets turn borrowing off (1). With borrowing, a new person's first utterance showed an
 * existing speaker's number 29%–70% of the time, without "new speaker?". Without borrowing, this
 * happened 18%–62% of the time. The cost was 1.5–2.6 more numbers per recording. The speech time
 * with the right label stayed the same (±1 point).
 */
export const presets: Record<Preset, { speechDetection: SpeechDetection, useSegmentation: boolean, overrides: Partial<TrackingParameters> }> = {
  conversation: { speechDetection: 'silero', useSegmentation: true, overrides: { borrowThreshold: 1 } },
  media: { speechDetection: 'segmentation', useSegmentation: true, overrides: { borrowThreshold: 1 } },
}

/** The parameters of a preset with an embedding model. */
export function presetParameters(preset: Preset, model: EmbeddingModel): TrackingParameters {
  return { ...defaultsFor(model, presets[preset].speechDetection), ...presets[preset].overrides }
}

export interface ParameterField {
  key: keyof TrackingParameters
  label: string
  help: string
  step: number
  min: number
  max: number
  unit?: string
  /** The parameter has an effect only with the segmentation model. */
  segmentation?: boolean
}

// Similarities are cosines between speaker embeddings. The library accepts -1 to 1; the sliders
// cover 0 to 1, where all useful values are.
export const parameterGroups: Array<{ title: string, fields: ParameterField[] }> = [
  {
    title: 'Speech detection',
    fields: [
      { key: 'vadThreshold', label: 'Speech threshold', help: 'Raise it if music or noise starts utterances. Lower it if the page misses quiet speech.', step: 0.05, min: 0.05, max: 0.95 },
      { key: 'vadSilence', label: 'Silence to end an utterance', help: 'Shorter values split quick exchanges into more utterances.', step: 0.05, min: 0.1, max: 2, unit: ' s' },
    ],
  },
  {
    title: 'Speaker changes',
    fields: [
      { key: 'changeThreshold', label: 'Window change threshold', help: 'Raise it to find more changes. Lower it to cut less often.', step: 0.05, min: 0, max: 1 },
      { key: 'minPieceSeconds', label: 'Minimum gap between cuts', help: 'The page ignores a cut closer than this to the previous cut.', step: 0.05, min: 0.1, max: 3, unit: ' s' },
      { key: 'segmentationRunSeconds', label: 'Minimum turn', help: 'Lower it to cut out shorter interjections, at the cost of more false cuts.', step: 0.05, min: 0, max: 2, unit: ' s', segmentation: true },
      { key: 'segmentationMarginSeconds', label: 'End margin', help: 'A change this close to the newest audio waits for more audio.', step: 0.05, min: 0, max: 2, unit: ' s', segmentation: true },
      { key: 'confirmSeconds', label: 'Confirmation distance', help: 'A change counts when the next check finds it again this close.', step: 0.05, min: 0, max: 1, unit: ' s', segmentation: true },
      { key: 'overlapSeconds', label: 'Overlap to flag', help: 'The page marks rows with at least this much overlapping speech.', step: 0.1, min: 0, max: 5, unit: ' s', segmentation: true },
    ],
  },
  {
    title: 'Speaker numbers',
    fields: [
      { key: 'clusterThreshold', label: 'Cluster threshold', help: 'A higher value keeps similar voices apart. A lower value merges them.', step: 0.05, min: 0, max: 1 },
      { key: 'mergeThreshold', label: 'Merge threshold', help: 'The tracker merges two speakers at least this similar.', step: 0.05, min: 0, max: 1 },
      { key: 'matchThreshold', label: 'Match threshold', help: 'How similar a voice must be to keep a speaker\'s number.', step: 0.05, min: 0, max: 1 },
      { key: 'enrollThreshold', label: 'Known speaker threshold', help: 'Raise it if a new person gets a known speaker\'s name.', step: 0.05, min: 0, max: 1 },
      { key: 'establishedSeconds', label: 'Speech to establish a speaker', help: 'Until then, a new voice shows "new speaker?".', step: 0.5, min: 0, max: 30, unit: ' s' },
      { key: 'borrowThreshold', label: 'Borrow threshold', help: 'A new voice this similar to a speaker shows that speaker at first. Raise it to see new numbers sooner. A value of 1 turns it off.', step: 0.05, min: 0, max: 1 },
      { key: 'nearestThreshold', label: 'Nearest-speaker threshold', help: 'Utterances under 1 s take the nearest speaker if at least this similar.', step: 0.05, min: 0, max: 1 },
      { key: 'maxSpeakers', label: 'Maximum speakers', help: 'The most speakers that the tracker looks for in the recent audio.', step: 1, min: 1, max: 30 },
    ],
  },
]
