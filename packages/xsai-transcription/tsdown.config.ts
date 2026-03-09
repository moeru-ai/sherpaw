import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'stream-transcription': 'src/stream-transcription/index.ts',
    'worker/index': 'src/worker/index.ts',
  },
  dts: true,
  exports: true,
  tsconfig: 'tsconfig.lib.json',
})
