import type { SpeakerMatch } from '@sherpaw/speaker-identification'

export interface AudioClip {
  samples: Float32Array
  sampleRate: number
}

export interface IdentificationResult {
  match: SpeakerMatch | null
  scores: SpeakerMatch[]
  milliseconds: number
}

export interface EnrollmentResult {
  name: string
  sampleCount: number
  sampleIds: string[]
}

export type WorkerRequest
  = | { type: 'init', model: string }
    | { type: 'identify', audio: AudioClip }
    | { type: 'enroll', name: string, audio: AudioClip[] }
    | { type: 'rename', name: string, newName: string }
    | { type: 'removeSpeaker', name: string }
    | { type: 'removeSample', name: string, sampleId: string }
    | { type: 'dispose' }

export interface WorkerResponses {
  init: void
  identify: IdentificationResult
  enroll: EnrollmentResult
  rename: EnrollmentResult
  removeSpeaker: void
  removeSample: EnrollmentResult
  dispose: void
}

export interface LoadingProgress {
  message: string
  completed?: number
  total?: number
}
