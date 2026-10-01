import { defineInvokeEventa } from '@moeru/eventa'

import type { Clustering, DiarizerConfig, SpeakerGuess, SpeakerSegment, SpeakerTrackerConfig, SpeakerTurn } from '../types'

/** Resolves to the sample rate that the segmentation model requires. */
export const initialize = defineInvokeEventa<number, Omit<DiarizerConfig, 'signal'>>('sherpaw:speaker-diarization:initialize')
export const diarize = defineInvokeEventa<SpeakerSegment[], { samples: Float32Array, sampleRate: number, clustering?: Clustering }>('sherpaw:speaker-diarization:diarize')

export const initializeTracker = defineInvokeEventa<void, Omit<SpeakerTrackerConfig, 'signal'>>('sherpaw:speaker-diarization:initialize-tracker')
export const track = defineInvokeEventa<SpeakerTurn, { samples: Float32Array, sampleRate: number }>('sherpaw:speaker-diarization:track')
export const peek = defineInvokeEventa<SpeakerGuess, { samples: Float32Array, sampleRate: number }>('sherpaw:speaker-diarization:peek')
export const resetTracker = defineInvokeEventa<void>('sherpaw:speaker-diarization:reset-tracker')
