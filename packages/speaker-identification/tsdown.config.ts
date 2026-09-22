import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [{ from: 'src/prebuilt/speaker-embedding.wasm', to: 'dist/prebuilt/speaker-embedding.wasm' }],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
