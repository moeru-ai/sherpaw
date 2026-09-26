import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'kws-unit',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
