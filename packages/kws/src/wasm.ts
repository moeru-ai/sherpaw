import type { WebAssemblyModule } from '@sherpaw/shared'

import init from './prebuilt/kws.js'

/** Exports of the standalone KWS runtime. Compatible with @sherpaw/preloader. */
export interface KWSModule extends WebAssemblyModule {
  FS: typeof FS
  _SherpawCreateKeywordSpotter: (encoder: number, decoder: number, joiner: number, tokens: number, keywords: number, maxActivePaths: number) => number
  _SherpaOnnxCreateKeywordStream: (spotter: number) => number
  _SherpaOnnxIsKeywordStreamReady: (spotter: number, stream: number) => number
  _SherpaOnnxDecodeKeywordStream: (spotter: number, stream: number) => void
  _SherpaOnnxResetKeywordStream: (spotter: number, stream: number) => void
  _SherpaOnnxGetKeywordResult: (spotter: number, stream: number) => number
  _SherpaOnnxDestroyKeywordResult: (result: number) => void
  _SherpawKeywordResultKeyword: (result: number) => number
  _SherpawKeywordResultCount: (result: number) => number
  _SherpawKeywordResultToken: (result: number, index: number) => number
  _SherpawKeywordResultTimestamp: (result: number, index: number) => number
  _SherpawKeywordResultStartTime: (result: number) => number
}

export async function initKWSModule(): Promise<KWSModule> {
  const wasmUrl = new URL('./prebuilt/kws.wasm', import.meta.url).toString()

  return init({ locateFile: () => wasmUrl })
}
