import { defineConfig } from 'vitest/config'

export default defineConfig(() => {
  return {
    test: {
      projects: [
        'packages/asr',
        'packages/kws/vitest.config.ts',
        'packages/kws/vitest.node.config.ts',
        'packages/preloader',
        'packages/speaker-diarization',
        'packages/speaker-identification',
        'packages/vad',
        'packages/vad-asr',
        'packages/vitest-plugin-fakemic',
        'packages/xsai-transcription',
      ],
    },
  }
})
