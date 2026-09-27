import type { Plugin } from 'vite'

import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

const virtualId = 'virtual:local-models'
const resolvedId = `\0${virtualId}`
const endpoint = '/__local-models/'

/** Expose files from one model directory in dev, with a throwing stub in builds. */
export function localModels(directory: string): Plugin {
  let development = false
  let base = '/'
  return {
    name: 'sandbox-local-models',
    configResolved(config) {
      development = config.command === 'serve'
      base = config.base
    },
    resolveId(id) {
      if (id === virtualId)
        return resolvedId
    },
    load(id) {
      if (id !== resolvedId)
        return
      if (!development) {
        return `export async function fetchLocalModel() {
          throw new Error('Local models are only available through the Vite dev server')
        }`
      }
      return `export async function fetchLocalModel(path) {
        const response = await fetch(${JSON.stringify(`${base}${endpoint.slice(1)}`)} + path.split('/').map(encodeURIComponent).join('/'))
        if (!response.ok)
          throw new Error('Local model unavailable: ' + response.status)
        return response
      }`
    },
    configureServer(server) {
      const prefix = `${base}${endpoint.slice(1)}`
      /** Triggering workflow: fetchLocalModel -> dev HTTP request -> model directory read -> Response. */
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith(prefix))
          return next()
        try {
          const root = await realpath(directory)
          const path = decodeURIComponent(request.url.slice(prefix.length).split('?')[0]!)
          const file = await realpath(resolve(root, path))
          const inside = relative(root, file)
          if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
            response.statusCode = 403
            response.end('Model path is outside the local model directory')
            return
          }
          const bytes = await readFile(file)
          response.setHeader('Content-Type', file.endsWith('.metadata') ? 'application/json' : 'application/octet-stream')
          response.setHeader('Content-Length', bytes.length)
          response.end(bytes)
        }
        catch {
          response.statusCode = 404
          response.end('Local model unavailable')
        }
      })
    },
  }
}
