import eslintConfig from '@antfu/eslint-config'

export default eslintConfig({
  ignores: [
    'packages/asr/src/sherpa-onnx-asr.js',
    'packages/asr/src/sherpa-onnx-wasm-main-asr.js',
  ],
})
