import type { Plugin } from 'vite'

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/** Resolves model asset imports to the Hugging Face revisions pinned by this checkout. */
export function cloudflareModels(): Plugin {
  const prefix = '\0cloudflare-model:'
  return {
    name: 'cloudflare-models',
    enforce: 'pre',
    resolveId(source) {
      const match = source.match(/models\/huggingface\/(sherpaw-campplus-zh-en-advanced|sherpaw-eres2netv2-zh-cn)\/install\/bin\/wasm\/preload\.data\?url$/)
      if (match)
        return `${prefix}${match[1]}`
    },
    load(id) {
      if (!id.startsWith(prefix))
        return
      const model = id.slice(prefix.length)
      const revision = execFileSync('git', ['rev-parse', `HEAD:models/huggingface/${model}`], {
        cwd: resolve(import.meta.dirname, '../../..'),
        encoding: 'utf8',
      }).trim()
      if (!/^[a-f0-9]{40}$/.test(revision))
        throw new Error(`Missing pinned model revision: ${model}`)
      return `export default ${JSON.stringify(`https://huggingface.co/moeru-ai/${model}/resolve/${revision}/install/bin/wasm/preload.data`)}`
    },
  }
}
