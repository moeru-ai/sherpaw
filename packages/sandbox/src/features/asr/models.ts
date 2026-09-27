import type { AsrModel } from './catalog'

import { fetchModel, loadModelPack } from '../models'

/** Return normalized virtual filenames for the native transducer and optional GPU encoder. */
export async function loadTransducerWeights(model: AsrModel) {
  if ('pack' in model && model.pack) {
    const { data, metadata } = await loadModelPack(model.pack.model, model.pack.revision)
    const bytes = new Uint8Array(data)
    return metadata.files.map(file => ({ filename: file.filename, bytes: bytes.subarray(file.start, file.end) }))
  }
  const remote = `https://huggingface.co/csukuangfj/${model.directory}/resolve/${model.revision}/`
  return Promise.all(Object.entries(model.weights).map(async ([role, file]) => ({
    filename: role === 'tokens' ? '/tokens.txt' : `/${role}.onnx`,
    bytes: new Uint8Array(await (await fetchModel(`${model.directory}/model/${file}`, `${remote}${file}`)).arrayBuffer()),
  })))
}

export async function loadParaformerFloatWeights(network: string) {
  const directory = 'sherpa-onnx-streaming-paraformer-bilingual-zh-en'
  const revision = '8e40c43232a1c5c66c82111efc5820d3accca11b'
  return new Uint8Array(await (await fetchModel(
    `${directory}/fp32/${network}.onnx`,
    `https://huggingface.co/csukuangfj/${directory}/resolve/${revision}/${network}.onnx`,
  )).arrayBuffer())
}
