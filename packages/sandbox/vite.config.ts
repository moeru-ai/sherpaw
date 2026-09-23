import vue from '@vitejs/plugin-vue'
import { env } from 'node:process'
import UnoCSS from 'unocss/vite'
import Basemove, { createS3Provider } from 'unplugin-basemove/vite'
import VueRouter from 'unplugin-vue-router/vite'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  build: { outDir: mode === 'cloudflare' ? 'dist-cloudflare' : 'dist' },
  worker: { format: 'es' },
  plugins: [
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
}))
