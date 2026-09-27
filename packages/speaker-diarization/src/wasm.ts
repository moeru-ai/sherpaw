import type { WebAssemblyModule } from '@sherpaw/shared'

import init from './prebuilt/sherpa-onnx-wasm-main-speaker-diarization.js'

/** Exports of the standalone diarization runtime, declared in @sherpaw/shared. Compatible with @sherpaw/preloader. */
export type SpeakerDiarizationModule = WebAssemblyModule

export async function initSpeakerDiarizationModule(): Promise<SpeakerDiarizationModule> {
  const wasmUrl = new URL('./prebuilt/sherpa-onnx-wasm-main-speaker-diarization.wasm', import.meta.url).toString()

  return init({ locateFile: () => wasmUrl })
}
