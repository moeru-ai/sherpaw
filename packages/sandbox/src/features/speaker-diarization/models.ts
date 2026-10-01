import type { DataMetadata } from '@sherpaw/preloader'
import type { DiarizationModelPacks, ModelPack } from '@sherpaw/speaker-diarization'

import { fetchLocalModel } from 'virtual:local-models'

const embedding = 'sherpaw-campplus-zh-en-advanced'
const embeddingRemote = `https://huggingface.co/moeru-ai/${embedding}/resolve/5fc23543ac94200ae77514cf1c40596c5d70f6e8/install/bin/wasm/`
const segmentationRemote = 'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx'
// Same file as the silero_vad_v5.onnx that the VAD tests download (SHA-256 6b99cbfd…).
const vadRemote = 'https://huggingface.co/csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad_v5.onnx'

async function fetchPack(fetchFile: (filename: string) => Promise<Response>): Promise<ModelPack> {
  const [data, metadata] = await Promise.all([fetchFile('preload.data'), fetchFile('preload.js.metadata')])

  if (!data.ok || !metadata.ok)
    throw new Error(`Could not load the embedding model (${data.status} / ${metadata.status}). Please try again.`)

  return { data: await data.arrayBuffer(), metadata: await metadata.json() as DataMetadata }
}

async function fetchOnnx(fetchModel: () => Promise<Response>, filename: string, name: string): Promise<ModelPack> {
  const response = await fetchModel()

  if (!response.ok)
    throw new Error(`Could not load the ${name} model (${response.status}). Please try again.`)

  const data = new Uint8Array(await response.arrayBuffer())

  // No pack is published for this model. A pack of one file is that file plus a manifest.
  return { data, metadata: { files: [{ filename, start: 0, end: data.length }], remote_package_size: data.length } }
}

function fetchEmbedding(): Promise<ModelPack> {
  return fetchPack(file => fetchLocalModel(`huggingface/${embedding}/install/bin/wasm/${file}`))
    .catch(() => fetchPack(file => fetch(`${embeddingRemote}${file}`)))
}

/** Sandbox policy: try local models in dev, then download the pinned HF models. */
export async function loadDiarizationModel(): Promise<DiarizationModelPacks> {
  const [segmentation, embeddingPack] = await Promise.all([
    fetchOnnx(() => fetchLocalModel('sherpa-onnx-pyannote-segmentation-3-0/model/normalized/speaker-segmentation.onnx'), '/speaker-segmentation.onnx', 'segmentation')
      .catch(() => fetchOnnx(() => fetch(segmentationRemote), '/speaker-segmentation.onnx', 'segmentation')),
    fetchEmbedding(),
  ])

  return { segmentation, embedding: embeddingPack }
}

/** The speaker tracker needs the embedding pack; the page segments speech with Silero VAD v5. */
export async function loadTrackerModels(): Promise<{ embedding: ModelPack, vad: ModelPack }> {
  const [embeddingPack, vad] = await Promise.all([fetchEmbedding(), fetchOnnx(() => fetch(vadRemote), '/silero-vad.onnx', 'VAD')])

  return { embedding: embeddingPack, vad }
}
