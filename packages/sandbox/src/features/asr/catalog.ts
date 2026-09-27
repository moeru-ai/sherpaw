import catalog from '../../../../../models/asr-catalog.json'

export const asrModels = catalog.models
export type AsrModel = typeof asrModels[number]
