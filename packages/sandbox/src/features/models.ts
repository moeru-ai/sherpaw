import type { DataMetadata } from '@sherpaw/preloader'

import { fetchLocalModel } from 'virtual:local-models'

/** Sandbox policy: prefer local assets in dev; builds download the pinned remote version. */
export async function fetchModel(localPath: string, remoteUrl: string) {
  try {
    return await fetchLocalModel(localPath)
  }
  catch {
    const response = await fetch(remoteUrl)
    if (!response.ok)
      throw new Error(`Could not load model: HTTP ${response.status} (${remoteUrl})`)
    return response
  }
}

/** Load the shared Sherpaw preload layout used by KWS, Paraformer and X-ASR. */
export async function loadModelPack(model: string, revision: string) {
  const path = `${model}/install/bin/wasm/`
  const remote = `https://huggingface.co/moeru-ai/${model}/resolve/${revision}/install/bin/wasm/`
  const fetchFile = (file: string) => fetchModel(`huggingface/${path}${file}`, `${remote}${file}`)
  const [data, metadata] = await Promise.all([fetchFile('preload.data'), fetchFile('preload.js.metadata')])
  const pack = { data: await data.arrayBuffer(), metadata: await metadata.json() as DataMetadata }
  if (pack.data.byteLength !== pack.metadata.remote_package_size)
    throw new Error(`Incomplete model pack: ${model}`)
  return pack
}
