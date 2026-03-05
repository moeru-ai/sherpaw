import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [
    'src/asr.d.ts',
    { from: 'src/prebuilt/asr.wasm', to: 'dist/prebuilt/asr.wasm' },
  ],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
