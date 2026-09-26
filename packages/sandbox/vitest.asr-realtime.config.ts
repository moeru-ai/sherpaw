import fakemic, { web } from '@sherpaw/vitest-plugin-fakemic'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [fakemic({
      name: 'asr-realtime',
      include: ['tests/asr/realtime.audio.test.ts', 'tests/asr/models.audio.test.ts', 'tests/asr/realtime-metrics.test.ts'],
      testTimeout: 240000,
      runtime: web({
        name: 'chrome-hardware-webgpu',
        prepare: new URL('./tests/asr/prepare.ts', import.meta.url).href,
        url: 'http://127.0.0.1:5192/asr',
        launch: { channel: 'chrome', headless: true },
        context: { permissions: ['microphone'] },
        preview: { configFile: resolve(import.meta.dirname, 'vite.config.ts'), root: import.meta.dirname, port: 5192 },
      }),
    })],
  },
})
