import eslintConfig from '@antfu/eslint-config'

export default eslintConfig({
  ignores: [
    'cspell.config.yaml',
    'packages/*/src/prebuilt/**/*',
    'packages/asr/src/asr.js',
    'packages/speaker-diarization/src/sherpa-onnx-speaker-diarization.js',
    'packages/speaker-diarization/src/sherpa-onnx-wasm-main-speaker-diarization.js',
    'packages/vad/src/vad.js',
    'packages/vad-asr/src/asr.js',
    'packages/vad-asr/src/vad.js',
  ],
  vue: true,
}, [
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      'ts/consistent-type-imports': 'error',
      'import/order': 'off',
      'perfectionist/sort-exports': ['error', {
        type: 'natural',
        fallbackSort: { type: 'line-length' },
        groups: [
          'type-export',
          'value-export',
        ],
        newlinesBetween: 1,
        partitionByComment: true,
      }],
      'perfectionist/sort-imports': ['error', {
        type: 'natural',
        fallbackSort: { type: 'line-length' },
        newlinesBetween: 1,
        partitionByComment: true,
      }],
      'perfectionist/sort-named-imports': 'error',
      'sort-imports': 'off',
    },
  },
])
