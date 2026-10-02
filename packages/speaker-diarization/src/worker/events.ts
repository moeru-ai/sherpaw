import { defineInvokeEventa } from '@moeru/eventa'

import type { Clustering, DiarizerConfig, SimilarityOptions, SpeakerGuess, SpeakerMap, SpeakerSegment, SpeakerTrackerConfig, SpeakerTrackerResetOptions, SpeakerTurn } from '../types'

/** Resolves to the sample rate that the segmentation model requires. */
export const initialize = defineInvokeEventa<number, Omit<DiarizerConfig, 'signal'>>('sherpaw:speaker-diarization:initialize')
export const diarize = defineInvokeEventa<SpeakerSegment[], { samples: Float32Array, sampleRate: number, clustering?: Clustering }>('sherpaw:speaker-diarization:diarize')

export const initializeTracker = defineInvokeEventa<void, Omit<SpeakerTrackerConfig, 'signal'>>('sherpaw:speaker-diarization:initialize-tracker')
export const track = defineInvokeEventa<SpeakerTurn, { samples: Float32Array, sampleRate: number }>('sherpaw:speaker-diarization:track')
export const peek = defineInvokeEventa<SpeakerGuess, { samples: Float32Array, sampleRate: number, final?: boolean }>('sherpaw:speaker-diarization:peek')
export const enroll = defineInvokeEventa<number, { samples: Float32Array, sampleRate: number }>('sherpaw:speaker-diarization:enroll')
export const inspect = defineInvokeEventa<SpeakerMap, undefined>('sherpaw:speaker-diarization:inspect')
export const speech = defineInvokeEventa<Float32Array, { samples: Float32Array, sampleRate: number }>('sherpaw:speaker-diarization:speech')
export const similarity = defineInvokeEventa<Float32Array, { samples: Float32Array, sampleRate: number, speaker: number, options?: SimilarityOptions }>('sherpaw:speaker-diarization:similarity')
export const resetTracker = defineInvokeEventa<void, SpeakerTrackerResetOptions | undefined>('sherpaw:speaker-diarization:reset-tracker')
