import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/core.ts', 'src/worker.ts', 'src/node.ts', 'src/node-worker.ts'],
  copy: [{ from: 'src/prebuilt/kws.wasm', to: 'dist/prebuilt/kws.wasm' }],
  dts: true,
  plugins: [{
    name: 'kws-runtime-assets',
    // Emscripten emits a Node-only import and a fallback URL relative to the
    // original glue file. Adapt the published chunk without editing generated source.
    renderChunk(code, chunk) {
      if (!chunk.moduleIds.some(id => id.endsWith('/prebuilt/kws.js')))
        return

      return {
        code: code
          .replace(/import\(["']module["']\)/gu, 'import(/* webpackIgnore: true */ /* @vite-ignore */ "node:module")')
          .replace(/new URL\(["']kws\.wasm["'],\s*import\.meta\.url\)/gu, 'new URL("./prebuilt/kws.wasm", import.meta.url)'),
        map: null,
      }
    },
  }],
})
