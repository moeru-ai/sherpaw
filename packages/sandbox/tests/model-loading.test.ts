import { fetchLocalModel } from 'virtual:local-models'
import { afterEach, expect, it, vi } from 'vitest'

import { fetchModel, loadModelPack } from '../src/features/models'

vi.mock('virtual:local-models', () => ({ fetchLocalModel: vi.fn() }))
const remote = vi.fn<typeof fetch>()

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it('reads prepared weights without contacting HF', async () => {
  vi.stubGlobal('fetch', remote)
  vi.mocked(fetchLocalModel).mockResolvedValue(new Response('local weights'))
  expect(await (await fetchModel('model/encoder.onnx', 'https://example.com/encoder.onnx')).text()).toBe('local weights')
  expect(remote).not.toHaveBeenCalled()
})

it('loads pinned pack URLs when local models are unavailable (including builds)', async () => {
  vi.stubGlobal('fetch', remote)
  vi.mocked(fetchLocalModel).mockRejectedValue(new Error('Local models unavailable'))
  remote.mockImplementation(async url => String(url).endsWith('.metadata')
    ? Response.json({ files: [{ filename: '/encoder.onnx', start: 0, end: 3 }], remote_package_size: 3 })
    : new Response(new Uint8Array([1, 2, 3])))
  const pack = await loadModelPack('model', 'pinned-revision')
  expect(new Uint8Array(pack.data)).toEqual(new Uint8Array([1, 2, 3]))
  expect(remote.mock.calls.map(([url]) => url)).toEqual([
    'https://huggingface.co/moeru-ai/model/resolve/pinned-revision/install/bin/wasm/preload.data',
    'https://huggingface.co/moeru-ai/model/resolve/pinned-revision/install/bin/wasm/preload.js.metadata',
  ])
})

it('reports missing remote weights and rejects incomplete packs', async () => {
  vi.stubGlobal('fetch', remote)
  vi.mocked(fetchLocalModel).mockRejectedValue(new Error('Not local'))
  remote.mockResolvedValue(new Response('', { status: 404 }))
  await expect(fetchModel('missing', 'https://example.com/missing')).rejects.toThrow('HTTP 404')
  vi.mocked(fetchLocalModel).mockImplementation(async path => path.endsWith('.metadata')
    ? Response.json({ files: [], remote_package_size: 100 })
    : new Response(new Uint8Array([1])))
  await expect(loadModelPack('model', 'revision')).rejects.toThrow('Incomplete model pack')
})
