import { defineInvokeEventa } from '@moeru/eventa'

import type { Clustering, DiarizerConfig, SpeakerSegment } from '../types'

/** Resolves to the sample rate that the segmentation model requires. */
export const initialize = defineInvokeEventa<number, Omit<DiarizerConfig, 'signal'>>('sherpaw:speaker-diarization:initialize')
export const diarize = defineInvokeEventa<SpeakerSegment[], { samples: Float32Array, sampleRate: number, clustering?: Clustering }>('sherpaw:speaker-diarization:diarize')
