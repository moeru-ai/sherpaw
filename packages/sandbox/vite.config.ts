import vue from '@vitejs/plugin-vue'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'
import UnoCSS from 'unocss/vite'
import Basemove, { createS3Provider } from 'unplugin-basemove/vite'
import VueRouter from 'unplugin-vue-router/vite'
import { defineConfig } from 'vite'

import { localModels } from './plugins/local-models'

export default defineConfig({
  // Route components import this after Vite scans the entry point.
  optimizeDeps: { include: ['reka-ui'] },
  worker: {
    format: 'es',
    plugins: () => [localModels(fileURLToPath(new URL('../../models', import.meta.url)))],
  },
  plugins: [
    localModels(fileURLToPath(new URL('../../models', import.meta.url))),
    VueRouter(),
    vue(),
    UnoCSS(),
    env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? Basemove({
          prefix: env.SANDBOX_WARP_DRIVE_PREFIX || 'sherpaw/sandbox/main/',
          include: [/\.data$/i],
          manifest: true,
          clean: false,
          provider: createS3Provider({
            endpoint: env.S3_ENDPOINT,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            region: env.S3_REGION,
            publicBaseUrl: env.WARP_DRIVE_PUBLIC_BASE ?? env.S3_ENDPOINT,
          }),
        })
      : undefined,
  ],
})
