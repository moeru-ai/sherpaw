// cspell:ignore Nemotron nemotron
import type { ProfileName, ProfileSpeed } from '@sherpaw/speaker-diarization/sortformer'

import { defineInvokeEventa } from '@moeru/eventa'

export type NemotronRequest
  = | { kind: 'load', profiling: boolean }
    | { kind: 'benchmark' }
    | { kind: 'start', profile: ProfileName }
    | { kind: 'push', samples: Float32Array }
    | { kind: 'flush' | 'reset' | 'dispose' }

export interface NemotronReply {
  probabilities: Float32Array
  computeMs: number
  speeds?: ProfileSpeed[]
}

export const operation = defineInvokeEventa<NemotronReply, NemotronRequest>('sherpaw:nemotron:operation')
