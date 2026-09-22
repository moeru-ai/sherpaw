import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'speaker-identification',
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } }),
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    include: ['tests/identification.browser.test.ts'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
})
