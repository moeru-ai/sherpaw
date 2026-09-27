import type { DataMetadata } from '@sherpaw/preloader'

import { fetchLocalModel } from 'virtual:local-models'

const model = 'sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20'
const revision = '1770a4b22db32184c110ac43c601db17cc9c93f8'
const remote = `https://huggingface.co/moeru-ai/${model}/resolve/${revision}/install/bin/wasm/`

async function fetchPack(fetchFile: (filename: string) => Promise<Response>) {
  const [data, metadata] = await Promise.all([fetchFile('preload.data'), fetchFile('preload.js.metadata')])
  if (!data.ok || !metadata.ok)
    throw new Error(`无法加载模型 (${data.status} / ${metadata.status})，请重试。`)
  return { data: await data.arrayBuffer(), metadata: await metadata.json() as DataMetadata }
}

/** Sandbox policy: try a local pack in dev, then download the pinned HF model. */
export async function loadKWSModel() {
  try {
    return await fetchPack(file => fetchLocalModel(`huggingface/${model}/install/bin/wasm/${file}`))
  }
  catch {
    return fetchPack(file => fetch(`${remote}${file}`))
  }
}
