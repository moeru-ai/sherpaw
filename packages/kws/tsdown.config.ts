import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [{ from: 'src/prebuilt/kws.wasm', to: 'dist/prebuilt/kws.wasm' }],
  dts: true,
  tsconfig: 'tsconfig.lib.json',
})
