import type { DataMetadata } from '@sherpaw/preloader'

import type { BinarySource, MetadataSource } from '../types'

function isBlobLike(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

export async function resolveBinary(source: BinarySource): Promise<ArrayBuffer> {
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

  throw new TypeError('Unsupported binary source.')
}

export async function resolveMetadata(source: MetadataSource): Promise<DataMetadata> {
  if (typeof source === 'string') {
    return JSON.parse(source) as DataMetadata
  }

  if (isBlobLike(source)) {
    const text = await source.text()
    return JSON.parse(text) as DataMetadata
  }

  if (isArrayBufferLike(source) || isUint8Array(source)) {
    const text = new TextDecoder().decode(await resolveBinary(source))
    return JSON.parse(text) as DataMetadata
  }

  return source
}
