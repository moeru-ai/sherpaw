export type BinaryData = ArrayBuffer | Uint8Array
export type PathUrlInput = string | URL

export interface ModelFileInput {
  filename: string
  source?: PathUrlInput | BinaryData
  data?: PathUrlInput | BinaryData
}

export type FlexibleModelInput = string | URL | ModelFileInput

export interface ResolvedModelFile {
  filename: string
  data: Uint8Array
}

export function toBytes(data: BinaryData): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  return new Uint8Array(data)
}

export async function fetchBytes(input: PathUrlInput): Promise<Uint8Array> {
  const url = input instanceof URL ? input.toString() : input
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText} (URL = ${url})`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

function basename(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] || path
}

export function normalizeModelInput(input: FlexibleModelInput): ModelFileInput & { source: PathUrlInput | BinaryData } {
  if (typeof input === 'string') {
    return { filename: basename(input), source: input }
  }
  if (input instanceof URL) {
    return { filename: basename(input.pathname), source: input }
  }

  const source = input.source ?? input.data
  if (source == null) {
    throw new Error('ModelFileInput requires either `source` or `data` to be provided')
  }

  if (!input.filename) {
    if (typeof source === 'string') {
      return { filename: basename(source), source }
    }
    if (source instanceof URL) {
      return { filename: basename(source.pathname), source }
    }
    throw new Error('When providing binary model data, `filename` is required to mount the file in the WASM filesystem')
  }

  return { filename: input.filename, source }
}

export async function resolveModelFile(input: FlexibleModelInput): Promise<ResolvedModelFile> {
  const normalized = normalizeModelInput(input)

  if (normalized.source instanceof URL || typeof normalized.source === 'string') {
    const data = await fetchBytes(normalized.source)
    return { filename: normalized.filename, data }
  }

  return {
    filename: normalized.filename,
    data: toBytes(normalized.source),
  }
}
