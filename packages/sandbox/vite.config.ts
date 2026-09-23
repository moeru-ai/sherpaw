import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import VueRouter from 'unplugin-vue-router/vite'
import { defineConfig } from 'vite'

import { cloudflareModels } from './vite-plugins/cloudflare-models'

export default defineConfig(({ mode }) => ({
  build: { outDir: mode === 'cloudflare' ? 'dist-cloudflare' : 'dist' },
  worker: { format: 'es' },
  plugins: [
    mode === 'cloudflare' && cloudflareModels(),
    VueRouter(),
    vue(),
    UnoCSS(),
  ],
}))
