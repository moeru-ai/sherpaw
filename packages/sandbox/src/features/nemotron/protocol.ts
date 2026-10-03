// cspell:ignore Nemotron nemotron
import { defineInvokeEventa } from '@moeru/eventa'

export type NemotronProfile = 'low' | 'veryLow'

export type NemotronRequest
  = | { kind: 'load', profile: NemotronProfile }
    | { kind: 'push', samples: Float32Array }
    | { kind: 'flush' | 'reset' | 'dispose' }

export interface NemotronReply {
  probabilities: Float32Array
  computeMs: number
}

export const operation = defineInvokeEventa<NemotronReply, NemotronRequest>('sherpaw:nemotron:operation')
