import eslintConfig from '@antfu/eslint-config'

export default eslintConfig({
  ignores: [
    'packages/*/src/prebuilt/**/*',
    'packages/asr/src/asr.js',
    'packages/vad/src/vad.js',
  ],
  vue: true,
})
