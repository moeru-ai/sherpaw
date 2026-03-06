import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [
    'src/vad.d.ts',
    { from: 'src/prebuilt/vad.wasm', to: 'dist/prebuilt/vad.wasm' },
  ],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
