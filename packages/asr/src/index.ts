export * from './asr'
// @ts-expect-error Missing types
export { default as initASRModule } from './prebuilt/asr'
export type { WebAssemblyModule as ASRModule } from '@sherpaw/shared'
