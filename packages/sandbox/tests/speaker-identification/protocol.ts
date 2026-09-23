import type { EnrollmentResult, IdentificationResult, LoadingProgress } from '../../src/features/speaker-identification/protocol'

export interface SpeakerTestAPI {
  init: (model?: string, onProgress?: (progress: LoadingProgress) => void) => Promise<void>
  enrollFiles: (name: string, files: string[]) => Promise<EnrollmentResult>
  rename: (name: string, newName: string) => Promise<EnrollmentResult>
  removeSpeaker: (name: string) => Promise<void>
  removeSample: (name: string, sampleId: string) => Promise<EnrollmentResult>
  file: (name: string) => Promise<IdentificationResult>
  microphone: (seconds: number) => Promise<IdentificationResult>
  dispose: () => Promise<void>
}

declare global {
  interface Window {
    speakerTest: SpeakerTestAPI
  }
}
