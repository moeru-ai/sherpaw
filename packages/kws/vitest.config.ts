import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  optimizeDeps: { include: ['@moeru/eventa/adapters/webworkers/worker'] },
  test: {
    name: 'kws-browser',
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [
        { browser: 'chromium' },
      ],
    },
    include: ['tests/**/*.browser.test.ts'],
  },
})
