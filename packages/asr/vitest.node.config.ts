import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@sherpaw/asr-node',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
