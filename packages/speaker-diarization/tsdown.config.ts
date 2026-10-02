import type { Options } from 'tsdown'

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

// onnxruntime-web runtime for the optional segmentation model, loaded by the browser Worker entry.
const ortAssets = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']
  .map(file => ({ from: fileURLToPath(import.meta.resolve(`onnxruntime-web/${file}`)), to: `dist/prebuilt/${file}` }))

const runtimeAssets = {
  plugins: [{
    name: 'speaker-diarization-runtime-assets',
    // Emscripten emits a Node-only import and a fallback URL relative to the
    // original glue file. Adapt the published chunk without editing generated source.
    renderChunk(code, chunk) {
      if (!chunk.moduleIds.some(id => id.endsWith('/prebuilt/sherpa-onnx-wasm-main-speaker-diarization.js')))
        return

      return {
        code: code
          .replace(/import\(["']module["']\)/gu, 'import(/* webpackIgnore: true */ /* @vite-ignore */ "node:module")')
          .replace(/new URL\(["']sherpa-onnx-wasm-main-speaker-diarization\.wasm["'],\s*import\.meta\.url\)/gu, 'new URL("./prebuilt/sherpa-onnx-wasm-main-speaker-diarization.wasm", import.meta.url)'),
        map: null,
      }
    },
  }],
} satisfies Options

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'core': 'src/core.ts',
      'conversation': 'src/conversation.ts',
      'node': 'src/node/index.ts',
      'node-worker': 'src/node/entry.ts',
    },
    copy: [{ from: 'src/prebuilt/sherpa-onnx-wasm-main-speaker-diarization.wasm', to: 'dist/prebuilt/sherpa-onnx-wasm-main-speaker-diarization.wasm' }, ...ortAssets],
    dts: true,
    ...runtimeAssets,
  },
  {
    entry: { 'worker-entry': 'src/web/entry.ts' },
    // Keep the client and Node output when tsdown writes the browser worker.
    clean: false,
    // Browser consumers cannot load picomatch's CommonJS entry through an unbundled Eventa import.
    noExternal: [/^@moeru\/eventa(?:\/|$)/, 'picomatch'],
    platform: 'browser',
    dts: true,
    ...runtimeAssets,
  },
])
