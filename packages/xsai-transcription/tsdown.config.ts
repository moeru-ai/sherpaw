import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'stream-transcription': 'src/stream-transcription/index.ts',
    },
    dts: true,
    tsconfig: 'tsconfig.lib.json',
  },
  {
    entry: {
      'worker/index': 'src/worker/index.ts',
    },
    // Keep the client build output when tsdown writes the worker entry.
    clean: false,
    // Browser consumers cannot load picomatch's CommonJS entry through an unbundled Eventa import.
    noExternal: [/^@moeru\/eventa(?:\/|$)/, 'picomatch'],
    platform: 'browser',
    dts: true,
    tsconfig: 'tsconfig.lib.json',
  },
])
