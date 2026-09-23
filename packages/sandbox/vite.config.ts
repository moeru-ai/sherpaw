import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import VueRouter from 'unplugin-vue-router/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  worker: { format: 'es' },
  plugins: [
    VueRouter(),
    vue(),
    UnoCSS(),
  ],
})
