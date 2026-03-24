import type { DataMetadata } from '@sherpaw/preloader'

import type { BinarySource, FetchLike, MetadataSource, RemoteUrlSource } from '../types'

function isBlobLike(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function isRemoteUrlSource(value: unknown): value is RemoteUrlSource {
  return !!value
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'remote-url'
    && 'url' in value
}

function resolveFetch(fetcher?: FetchLike): FetchLike {
  const target = fetcher ?? globalThis.fetch
  if (!target) {
    throw new TypeError('fetch is required to resolve remote model sources.')
  }
  return target
}

async function fetchRemote(remote: RemoteUrlSource, fetcher?: FetchLike): Promise<Response> {
  const response = await resolveFetch(fetcher)(remote.url, remote.init)
  if (!response.ok) {
    throw new Error(`Failed to fetch remote model source: ${response.status} ${response.statusText}`.trim())
  }
  return response
}

export async function resolveBinary(source: BinarySource, fetcher?: FetchLike): Promise<ArrayBuffer> {
  if (isArrayBufferLike(source)) {
    return source
  }

  if (isUint8Array(source)) {
    const copy = new Uint8Array(source.byteLength)
    copy.set(source)
    return copy.buffer
  }

  if (isBlobLike(source)) {
    return await source.arrayBuffer()
  }

  if (isRemoteUrlSource(source)) {
    return await (await fetchRemote(source, fetcher)).arrayBuffer()
  }

  throw new TypeError('Unsupported binary source.')
}

export async function resolveMetadata(source: MetadataSource, fetcher?: FetchLike): Promise<DataMetadata> {
  if (typeof source === 'string') {
    return JSON.parse(source) as DataMetadata
  }

  if (isBlobLike(source)) {
    const text = await source.text()
    return JSON.parse(text) as DataMetadata
  }

  if (isArrayBufferLike(source) || isUint8Array(source)) {
    const text = new TextDecoder().decode(await resolveBinary(source, fetcher))
    return JSON.parse(text) as DataMetadata
  }

  if (isRemoteUrlSource(source)) {
    const text = await (await fetchRemote(source, fetcher)).text()
    return JSON.parse(text) as DataMetadata
  }

  return source
}
