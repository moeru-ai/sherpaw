import type { ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

import { sherpawAudioModels } from './src/models'

const modelRoutePrefix = '/__sherpaw-models/'
const modelArtifactNames = new Set(['preload.data', 'preload.js.metadata'])

function resolveModelArtifact(requestURL: string): string | undefined {
  const parts = decodeURIComponent(new URL(requestURL, 'http://localhost').pathname)
    .slice(modelRoutePrefix.length)
    .split('/')
  if (parts.length !== 2)
    return

  const [modelId, artifactName] = parts
  const model = sherpawAudioModels.find(candidate => candidate.id === modelId)
  if (!model || !artifactName || !modelArtifactNames.has(artifactName))
    return

  return resolve(
    import.meta.dirname,
    '../../models',
    model.id,
    'install/bin/wasm',
    artifactName,
  )
}

async function serveModelArtifact(
  request: Connect.IncomingMessage,
  response: ServerResponse,
  next: Connect.NextFunction,
) {
  if (!request.url?.startsWith(modelRoutePrefix)) {
    next()
    return
  }

  const artifactPath = resolveModelArtifact(request.url)
  if (!artifactPath) {
    response.statusCode = 404
    response.end()
    return
  }

  try {
    const artifact = await stat(artifactPath)
    response.statusCode = 200
    response.setHeader('Content-Length', artifact.size)
    response.setHeader(
      'Content-Type',
      artifactPath.endsWith('.metadata') ? 'application/json' : 'application/octet-stream',
    )
    createReadStream(artifactPath)
      .on('error', next)
      .pipe(response)
  }
  catch (error) {
    next(error)
  }
}

function localModelPlugin(): Plugin {
  return {
    name: 'sherpaw-testing-audio-local-models',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void serveModelArtifact(request, response, next)
      })
    },
  }
}

export default defineConfig({
  plugins: [localModelPlugin()],
  root: resolve(import.meta.dirname, 'app'),
  build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, 'dist'),
  },
})
