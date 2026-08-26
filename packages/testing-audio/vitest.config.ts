import fakemic, { web } from '@sherpaw/vitest-plugin-fakemic'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      fakemic({
        name: 'audio-web',
        include: ['cases/**/*.audio.test.ts'],
        testTimeout: 360_000,
        hookTimeout: 180_000,
        runtime: web({
          name: 'web',
          prepare: new URL('./src/prepare-web.ts', import.meta.url).href,
          url: 'http://127.0.0.1:4173/',
          context: { permissions: ['microphone'] },
          preview: {
            configFile: resolve(import.meta.dirname, 'vite.config.ts'),
            root: resolve(import.meta.dirname, 'app'),
          },
        }),
      }),
    ],
  },
})
