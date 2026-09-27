import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'speaker-diarization',
    environment: 'node',
    include: ['tests/**/*.node.test.ts'],
    testTimeout: 300000,
  },
})
