interface SherpawAudioTestSnapshot {
  error: string
  status: 'idle' | 'loading-model' | 'recording' | 'stopped'
  transcription: string
}

interface SherpawAudioTestAPI {
  loadAudioWorklet: () => Promise<void>
  snapshot: () => SherpawAudioTestSnapshot
  start: (model: import('../../src/models').SherpawAudioModel) => Promise<void>
  stop: () => Promise<void>
}

interface Window {
  __sherpawAudioTest: SherpawAudioTestAPI
}
