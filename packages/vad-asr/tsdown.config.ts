import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [
    'src/asr.d.ts',
    'src/vad.d.ts',
    { from: 'src/prebuilt/vad-asr.wasm', to: 'dist/prebuilt/vad-asr.wasm' },
  ],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
