import { resolve } from 'node:path'
import { env } from 'node:process'
import { defineConfig } from 'playwright/test'

import { microphoneArguments } from './e2e/microphone'

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  workers: 1,
  forbidOnly: !!env.CI,
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 1100 },
    permissions: ['microphone'],
    launchOptions: {
      args: microphoneArguments(resolve(import.meta.dirname, '../kws/tests/models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/test_wavs/zh_5.wav')),
    },
    actionTimeout: 30000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'development',
      testMatch: '**/*.spec.ts',
      testIgnore: '**/production.spec.ts',
      use: { baseURL: 'http://127.0.0.1:5175' },
    },
    {
      name: 'production',
      testMatch: '**/production.spec.ts',
      use: { baseURL: 'http://127.0.0.1:4175' },
    },
  ],
  webServer: [
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      timeout: 120000,
    },
    {
      command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort',
      url: 'http://127.0.0.1:4175',
      timeout: 120000,
    },
  ],
})
