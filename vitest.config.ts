import { defineConfig } from 'vitest/config'

export default defineConfig(() => {
  return {
    test: {
      projects: [
        'packages/asr',
        'packages/preloader',
        'packages/sandbox',
        'packages/speaker-diarization',
        'packages/vad',
        'packages/vad-asr',
        'packages/vitest-plugin-fakemic',
        'packages/xsai-transcription',
      ],
    },
  }
})
