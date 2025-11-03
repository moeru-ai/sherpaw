import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  copy: [
    'src/sherpa-onnx-asr.d.ts',
    'src/sherpa-onnx-wasm-main-asr.d.ts',
    'src/sherpa-onnx-wasm-main-asr.wasm',
  ],
  dts: true,
  exports: {
    customExports(exports) {
      exports['./module.wasm'] = './dist/sherpa-onnx-wasm-main-asr.wasm'
      return exports
    },
  },
  tsconfig: 'tsconfig.lib.json',
})
