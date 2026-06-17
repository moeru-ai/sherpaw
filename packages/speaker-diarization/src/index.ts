export * from './sherpa-onnx-speaker-diarization'
// @ts-expect-error Missing types
export type { WebAssemblyModule as SpeakerDiarizationModule } from '@sherpaw/shared'

export { default as initSpeakerDiarizationModule } from './sherpa-onnx-wasm-main-speaker-diarization'
