import catalog from '../../../../../models/asr-catalog.json'

export const asrModels = catalog.models
export type AsrModel = typeof asrModels[number]

export interface ModelManifest extends AsrModel {
  modelBytes: number
  files: { path: string, bytes: number, sha256: string }[]
}

export type ModelBackend = 'cpu' | 'webgpu-encoder'

export interface ModelSnapshot {
  text: string
  decodedChunks: number
  gpuDispatches?: number
}

export type ModelRequest
  = | { id: number, kind: 'load', modelId: string, baseUrl: string, backend: ModelBackend }
    | { id: number, kind: 'accept', samples: Float32Array }
    | { id: number, kind: 'finish' }

export interface ModelReply {
  id: number
  status?: string
  error?: string
  snapshot?: ModelSnapshot
}
