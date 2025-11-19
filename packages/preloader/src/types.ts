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

export interface VirtualFile {
  /** Filename or relative path under `parent` (e.g. `model.onnx` or `subdir/model.onnx`) */
  filename: string
  /** Content of the file. Can be ArrayBuffer, Uint8Array or a string (will be UTF-8 encoded). */
  data: Data
}

export interface VirtualData {
  files: VirtualFile[]
}
