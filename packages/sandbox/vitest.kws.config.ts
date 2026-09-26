import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'sandbox-kws',
    environment: 'node',
    include: ['tests/kws/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
})
