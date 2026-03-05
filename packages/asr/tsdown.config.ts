import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [
    'src/asr.d.ts',
    'src/prebuilt/asr.wasm',
  ],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
