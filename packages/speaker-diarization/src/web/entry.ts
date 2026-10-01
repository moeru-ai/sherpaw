import { createContext } from '@moeru/eventa/adapters/webworkers/worker'

import { registerWorkerHandlers } from '../worker/runtime'

const { context } = createContext()

registerWorkerHandlers(context, {
  // Published next to this entry by tsdown, for the optional segmentation model.
  ortWasmPaths: {
    mjs: new URL('./prebuilt/ort-wasm-simd-threaded.mjs', import.meta.url).href,
    wasm: new URL('./prebuilt/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  },
})
