import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const gpuAssets = ['asr-webgpu.js', 'asr-webgpu.wasm']
  .filter(file => existsSync(`src/prebuilt/${file}`))
  .map(file => ({ from: `src/prebuilt/${file}`, to: `dist/prebuilt/${file}` }))
const ortAssets = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
  .map(file => ({ from: fileURLToPath(import.meta.resolve(`onnxruntime-web/${file}`)), to: `dist/prebuilt/${file}` }))

export default defineConfig({
  entry: ['src/index.ts', 'src/webgpu.ts'],
  copy: [
    'src/asr.d.ts',
    { from: 'src/prebuilt/asr.wasm', to: 'dist/prebuilt/asr.wasm' },
    ...gpuAssets,
    ...ortAssets,
  ],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
