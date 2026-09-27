import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, createServer } from 'vite'
import { expect, it } from 'vitest'

import { localModels } from '../../plugins/local-models'

it('serves model bytes under the configured base and rejects missing or escaped paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sandbox-models-'))
  const directory = join(root, 'models')

  await mkdir(directory)
  await writeFile(join(directory, 'preload.data'), new Uint8Array([1, 2, 3]))
  await writeFile(join(root, 'private.txt'), 'outside models')
  await symlink(join(root, 'private.txt'), join(directory, 'escape.data'))

  const server = await createServer({
    configFile: false,
    root,
    base: '/sandbox/',
    plugins: [localModels(directory)],
    server: { host: '127.0.0.1', port: 0 },
  })

  try {
    await server.listen()

    const url = `${server.resolvedUrls!.local[0]}__local-models/`
    const data = await fetch(`${url}preload.data`)

    expect(new Uint8Array(await data.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))

    expect((await fetch(`${url}missing.data`)).status).toBe(404)

    expect((await fetch(`${url}escape.data`)).status).toBe(403)

    expect((await fetch(`${url}..%2Fprivate.txt`)).status).toBe(403)
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('builds without a local model directory and emits only a rejecting async loader', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sandbox-model-build-'))
  const entry = join(root, 'entry.js')

  await writeFile(entry, 'export { fetchLocalModel } from "virtual:local-models"')

  try {
    const result = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      plugins: [localModels(join(root, 'missing-models'))],
      build: { lib: { entry, formats: ['es'] }, write: false, minify: false },
    })
    const output = Array.isArray(result) ? result[0]! : result

    if (!('output' in output))
      throw new Error('Expected one build output')

    expect(output.output).toHaveLength(1)

    const chunk = output.output[0]!

    if (chunk.type !== 'chunk')
      throw new Error('Expected JavaScript')

    expect(chunk.code).not.toContain(root)

    const loader = await import(`data:text/javascript,${encodeURIComponent(chunk.code)}`)

    await expect(loader.fetchLocalModel('preload.data')).rejects.toThrow('only available')
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
