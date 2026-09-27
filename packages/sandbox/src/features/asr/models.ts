import type { AsrModel } from './catalog'

import { fetchModel, loadModelPack } from '../models'

/** Read the same published preload layout for Paraformer and X-ASR. */
export async function loadPackedWeights(model: string, revision: string) {
  const { data, metadata } = await loadModelPack(model, revision)
  const bytes = new Uint8Array(data)
  return metadata.files.map(file => ({ filename: file.filename, bytes: bytes.subarray(file.start, file.end) }))
}

/** Return normalized virtual filenames for every transducer backend. */
export async function loadTransducerWeights(model: AsrModel) {
  if ('pack' in model && model.pack)
    return loadPackedWeights(model.pack.model, model.pack.revision)
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
