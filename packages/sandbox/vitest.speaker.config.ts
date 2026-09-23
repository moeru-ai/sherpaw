import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'sandbox-speaker',
          environment: 'node',
          include: ['tests/speaker-identification/demo.test.ts'],
          testTimeout: 120000,
          hookTimeout: 120000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'speaker-recorder',
          include: ['tests/speaker-identification/recorder.browser.test.ts'],
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
