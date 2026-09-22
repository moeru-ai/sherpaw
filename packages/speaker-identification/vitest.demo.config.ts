import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'speaker-demo',
    environment: 'node',
    include: ['tests/demo.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
})
