export * from './sherpa-onnx-speaker-diarization'
// @ts-expect-error Missing types
export { default as initSpeakerDiarizationModule } from './sherpa-onnx-wasm-main-speaker-diarization'
export type { WebAssemblyModule as SpeakerDiarizationModule } from '@sherpa-onnx-wasm/shared'
