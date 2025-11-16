import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [
    'src/sherpa-onnx-speaker-diarization.d.ts',
    'src/sherpa-onnx-wasm-main-speaker-diarization.wasm',
  ],
  dts: true,
  exports: {
    customExports(exports) {
      exports['./module.wasm'] = './dist/sherpa-onnx-wasm-main-speaker-diarization.wasm'
      return exports
    },
  },
  tsconfig: 'tsconfig.lib.json',
})
