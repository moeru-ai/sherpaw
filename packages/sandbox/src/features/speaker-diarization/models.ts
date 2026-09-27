import type { DataMetadata } from '@sherpaw/preloader'
import type { DiarizationModelPacks, ModelPack } from '@sherpaw/speaker-diarization'

import { fetchLocalModel } from 'virtual:local-models'

const embedding = 'sherpaw-campplus-zh-en-advanced'
const embeddingRemote = `https://huggingface.co/moeru-ai/${embedding}/resolve/5fc23543ac94200ae77514cf1c40596c5d70f6e8/install/bin/wasm/`
const segmentationRemote = 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx'

async function fetchPack(fetchFile: (filename: string) => Promise<Response>): Promise<ModelPack> {
  const [data, metadata] = await Promise.all([fetchFile('preload.data'), fetchFile('preload.js.metadata')])

  if (!data.ok || !metadata.ok)
    throw new Error(`Could not load the embedding model (${data.status} / ${metadata.status}). Please try again.`)

  return { data: await data.arrayBuffer(), metadata: await metadata.json() as DataMetadata }
}

async function fetchSegmentation(fetchModel: () => Promise<Response>): Promise<ModelPack> {
  const response = await fetchModel()

  if (!response.ok)
    throw new Error(`Could not load the segmentation model (${response.status}). Please try again.`)

  const data = new Uint8Array(await response.arrayBuffer())

  // No segmentation pack is published yet. A pack of one file is that file plus a manifest.
  return { data, metadata: { files: [{ filename: '/speaker-segmentation.onnx', start: 0, end: data.length }], remote_package_size: data.length } }
}

/** Sandbox policy: try local models in dev, then download the pinned HF models. */
export async function loadDiarizationModel(): Promise<DiarizationModelPacks> {
  const [segmentation, embeddingPack] = await Promise.all([
    fetchSegmentation(() => fetchLocalModel('sherpa-onnx-pyannote-segmentation-3-0/model/normalized/speaker-segmentation.onnx'))
      .catch(() => fetchSegmentation(() => fetch(segmentationRemote))),
    fetchPack(file => fetchLocalModel(`huggingface/${embedding}/install/bin/wasm/${file}`))
      .catch(() => fetchPack(file => fetch(`${embeddingRemote}${file}`))),
  ])

  return { segmentation, embedding: embeddingPack }
}
