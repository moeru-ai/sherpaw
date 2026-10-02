import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const gpuAssets = ['asr-webgpu.js', 'asr-webgpu.wasm']
  .filter(file => existsSync(`src/prebuilt/${file}`))
  .map(file => ({ from: `src/prebuilt/${file}`, to: `dist/prebuilt/${file}` }))
if (gpuAssets.length === 1)
  throw new Error('Incomplete WebGPU runtime: build both asr-webgpu.js and asr-webgpu.wasm before packaging.')
const ortAssets = gpuAssets.length
  ? ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
      .map(file => ({ from: fileURLToPath(import.meta.resolve(`onnxruntime-web/${file}`)), to: `dist/prebuilt/${file}` }))
  : []

export default defineConfig({
  entry: ['src/index.ts', 'src/tokens.ts', 'src/webgpu.ts'],
  copy: [
    'src/asr.d.ts',
    { from: 'src/prebuilt/asr.wasm', to: 'dist/prebuilt/asr.wasm' },
    ...gpuAssets,
    ...ortAssets,
  ],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
