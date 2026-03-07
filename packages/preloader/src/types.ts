import type { WebAssemblyModule } from '@sherpaw/shared'

export type Filename = string
export type Data = ArrayBuffer | Uint8Array | string

export interface FileMetadata {
  filename: string
  start: number
  end: number
}

export interface DataMetadata {
  files: FileMetadata[]
  remote_package_size: number
}

interface BaseLoadDataOptions {
  module: WebAssemblyModule
  parent?: string | FS.FSNode
  dependencyId?: string
}

export interface LoadDataOptions extends BaseLoadDataOptions {
  metadata: DataMetadata
  data: Data
}

export interface LoadVirtualDataOptions<T extends Record<Filename, Data> = Record<Filename, Data>> extends BaseLoadDataOptions {
  /**
   * - **Filename**: Filename or relative path under `parent` (e.g. `model.onnx` or `subdir/model.onnx`)
   * - **Data**: Content of the file. Can be ArrayBuffer, Uint8Array or a string (will be UTF-8 encoded).
   */
  virtualData: T
}
