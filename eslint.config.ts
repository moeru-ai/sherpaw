import eslintConfig from '@antfu/eslint-config'

export default eslintConfig({
  ignores: [
    'packages/*/prebuilt/**',
    'packages/asr/src/asr.js',
  ],
  vue: true,
})
