import catalog from '../../../../../models/asr-catalog.json'

export const asrModels = catalog.models
export type AsrModel = typeof asrModels[number]

export interface ModelManifest extends AsrModel {
  modelBytes: number
  files: { path: string, bytes: number, sha256: string }[]
}
