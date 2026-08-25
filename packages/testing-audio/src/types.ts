import type { AudioTestCase, AudioTestSession } from '@sherpaw/vitest-plugin-fakemic'
import type { Page } from 'playwright'

import type { SherpawAudioModel } from './models'

/** One Sherpaw fake-microphone test definition. */
export type SherpawAudioTestCase = AudioTestCase

/** Browser state recorded by the Sherpaw audio test application. */
export interface SherpawAudioSnapshot {
  error: string
  status: 'idle' | 'loading-model' | 'recording' | 'stopped'
  transcription: string
}

/** Runtime handle for one Sherpaw fake-microphone test. */
export interface SherpawAudioSession extends AudioTestSession {
  page: Page
  loadAudioWorklet: () => Promise<void>
  snapshot: () => Promise<SherpawAudioSnapshot>
  start: (model: SherpawAudioModel) => Promise<void>
  stop: () => Promise<void>
}
