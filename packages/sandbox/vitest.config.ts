import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'sandbox',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.browser.test.ts', 'tests/asr/realtime.audio.test.ts'],
          testTimeout: 120000,
          hookTimeout: 120000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'sandbox-browser',
          include: ['tests/**/*.browser.test.ts'],
          testTimeout: 120000,
          hookTimeout: 120000,
          browser: {
            enabled: true,
            provider: playwright({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
